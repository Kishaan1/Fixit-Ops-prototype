/**
 * ============================================================================
 * FIXIT AI — GOOGLE SHEETS GATEWAY (Google Apps Script Web App)
 * ============================================================================
 *
 * This single file is the complete gateway between the FIXIT AI Node server
 * and your Google Spreadsheet. It implements the exact request/response
 * protocol that server/sheets/gateway.ts expects (the same protocol as
 * scripts/fake-gateway.ts, the in-memory reference implementation).
 *
 * WHAT IT DOES
 *   • Master worksheets  : Users, Technicians, Customers, Devices, Spare
 *                          Parts, Suppliers, Settings, Sessions, ... shared
 *                          across every month — never duplicated.
 *   • Monthly worksheets : "November 2026", "November 2026 - Parts",
 *                          "November 2026 - Payments", "November 2026 -
 *                          Activity" — created automatically for every month
 *                          that receives a record.
 *   • Writes             : create / upsert / update / delete by unique ID.
 *                          Existing rows are updated in place, never
 *                          duplicated. Duplicate guards, a script lock for
 *                          simultaneous saves, and requestId replay make a
 *                          retried request safe.
 *   • Images             : photos are stored in Google Drive next to the
 *                          spreadsheet (folder "FIXIT AI Images").
 *   • Backups            : copies the whole spreadsheet into Google Drive.
 *   • Timestamps         : every DateTime cell is a real date shown as
 *                          DD-MM-YYYY HH:mm:ss IST (Asia/Kolkata).
 *   • Safety             : it NEVER calls sheet.clear(), so existing data is
 *                          always preserved. Formula-looking text (= + - @)
 *                          is stored as plain text, never executed.
 *
 * WHY YOUR PREVIOUS SCRIPT FAILED
 *   The old Code.gs called `ContentService.createText(...)`. That function
 *   does NOT exist in Apps Script — the correct function is
 *   `ContentService.createTextOutput(...)`. That single typo produced
 *   "TypeError: ContentService.createText is not a function" on every
 *   request, in every project it was pasted into. This file uses the correct
 *   function everywhere.
 *
 * DEPLOYMENT (5 minutes, no Google Cloud Console needed)
 *   1. Go to https://script.google.com and click "New project".
 *   2. Open Code.gs, select everything, delete it, and paste this whole file.
 *   3. Check the two constants below: SPREADSHEET_ID must be your spreadsheet
 *      and GATEWAY_SECRET must equal SHEETS_GATEWAY_SECRET in your .env.
 *   4. Click Deploy → New deployment → type "Web app":
 *        Execute as     : Me (your Google account)
 *        Who has access: Anyone
 *      Click Deploy and authorise the permissions when Google asks.
 *   5. Copy the Web app URL (…/macros/s/AKfy…/exec) into your .env as
 *      SHEETS_GATEWAY_URL, then restart the API server (npm run dev).
 *   6. Verify in a browser: open the URL plus
 *      ?secret=fixit-gateway-secret&action=ping — you must see JSON with
 *      "ok": true.
 *
 *   You can also select the `testGateway` function in the Apps Script editor
 *   and press Run to check the connection without deploying anything.
 * ============================================================================
 */

/* ====================== CONFIGURATION (EDIT HERE) ====================== */

// Your spreadsheet. Already set to "Data Storage spreadsheet".
const SPREADSHEET_ID = '1QILuEi6NIlaBb3tYWqJ5EsRF3_MksxnN_eembEIuOYU';

// Must equal SHEETS_GATEWAY_SECRET in the .env file of the app.
const GATEWAY_SECRET = 'fixit-gateway-secret';

const TIMEZONE = 'Asia/Kolkata';
const IMAGE_FOLDER_NAME = 'FIXIT AI Images';
const REGISTRY_KEY = 'FIXIT_MONTHLY_SPECS';
const REQUEST_CACHE_PREFIX = 'req:';

const MONTHS_ = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

// Matches "November 2026", "November 2026 - Parts", etc.
const MONTHLY_NAME_RE_ = new RegExp('^(' + MONTHS_.join('|') + ') (\\d{4})(?: - (.*))?$');

/* ========================= ENTRY POINTS ========================= */

/** GET is only for quick checks in a browser: ping and listMonths. */
function doGet(e) {
  try {
    const params = (e && e.parameter) || {};
    if (String(params.secret || '') !== GATEWAY_SECRET) {
      return failEnv_('UNAUTHORIZED', 'Unauthorized. Add ?secret=…&action=ping.');
    }
    if (params.action === 'ping') return handlePing_();
    if (params.action === 'listMonths') return handleListMonths_();
    return failEnv_('UNKNOWN_ACTION', 'Only ping and listMonths work over GET. Use POST.');
  } catch (err) {
    return errorEnv_(err);
  }
}

/** POST is what the Node server uses. Body: JSON with secret + action. */
function doPost(e) {
  try {
    let payload = {};
    try {
      const body = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
      payload = JSON.parse(body);
    } catch (parseErr) {
      return failEnv_('BAD_REQUEST', 'The request body is not valid JSON.');
    }

    if (String(payload.secret || '') !== GATEWAY_SECRET) {
      return failEnv_('UNAUTHORIZED', 'Unauthorized.');
    }

    switch (payload.action) {
      case 'ping': return handlePing_();
      case 'ensureSchema': return handleEnsureSchema_(payload);
      case 'readTables': return handleReadTables_(payload);
      case 'writeBatch': return handleWriteBatch_(payload);
      case 'uploadImage': return handleUploadImage_(payload);
      case 'getImage': return handleGetImage_(payload);
      case 'backup': return handleBackup_();
      case 'listMonths': return handleListMonths_();
      default:
        return failEnv_('UNKNOWN_ACTION', 'Unknown action: ' + payload.action);
    }
  } catch (err) {
    return errorEnv_(err);
  }
}

/* ========================= RESPONSE HELPERS ========================= */

/**
 * The ONLY correct way to answer. ContentService.createTextOutput — note the
 * full name — was mistyped as createText in the previous script, which broke
 * every request.
 */
function json_(value) {
  return ContentService.createTextOutput(JSON.stringify(value))
    .setMimeType(ContentService.MimeType.JSON);
}

function ok_(result) {
  return json_({ ok: true, result: result });
}

function failEnv_(code, message, retryable) {
  return json_({ ok: false, error: message, code: code, retryable: retryable === true });
}

function errorEnv_(err) {
  const message = err && err.message ? String(err.message) : String(err);
  const code = err && err.code ? String(err.code) : 'GATEWAY_ERROR';
  return json_({ ok: false, error: message, code: code, retryable: false });
}

/** Error used inside the batch engine; carries a machine-readable code. */
function fail_(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function openSpreadsheet_() {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (err) {
    throw fail_(
      'SPREADSHEET_NOT_FOUND',
      'The gateway cannot open spreadsheet ' + SPREADSHEET_ID +
        '. Open the spreadsheet with the account that owns this script once, then redeploy.'
    );
  }
}

/* ========================= ACTION: ping ========================= */

function handlePing_() {
  const ss = openSpreadsheet_();
  return ok_({
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetName: ss.getName(),
    timezone: ss.getSpreadsheetTimeZone() || TIMEZONE,
    tabs: ss.getSheets().map(function (s) { return s.getName(); }),
    now: formatIst_(new Date()),
  });
}

/* ==================== ACTION: ensureSchema ==================== */
/**
 * Creates every master worksheet and the current month's worksheets with the
 * exact headers the Node server expects. Idempotent: existing tabs and rows
 * are never cleared. When a tab exists with different (older) headers, the
 * columns are realigned BY NAME so no data is lost — columns the sheet
 * already had but the schema does not know are kept at the right side.
 */
function handleEnsureSchema_(payload) {
  const schema = payload.schema || {};
  const masters = Array.isArray(schema.masters) ? schema.masters : [];
  const monthly = Array.isArray(schema.monthly) ? schema.monthly : [];

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return failEnv_('GATEWAY_BUSY', 'Another Sheets operation is running. The server retries automatically.', true);
  }
  try {
    const ss = openSpreadsheet_();
    try { ss.setSpreadsheetTimeZone(TIMEZONE); } catch (tzErr) {}
    try { ss.setSpreadsheetLocale('en_IN'); } catch (localeErr) {}

    const masterTabs = [];
    for (let i = 0; i < masters.length; i++) {
      const spec = masters[i];
      if (!spec || !spec.tab || !Array.isArray(spec.headers) || !spec.headers.length) continue;
      ensureTab_(ss, spec.tab, 'master', spec);
      masterTabs.push(spec.tab);
    }

    const current = monthKeyNow_();
    const monthlyTabs = [];
    for (let i = 0; i < monthly.length; i++) {
      const spec = monthly[i];
      if (!spec || spec.suffix === undefined || !Array.isArray(spec.headers) || !spec.headers.length) continue;
      const name = monthTabName_(current, spec.suffix);
      ensureTab_(ss, name, 'monthly', spec);
      monthlyTabs.push(name);
    }
    saveMonthlyRegistry_(monthly);

    return ok_({
      spreadsheetId: SPREADSHEET_ID,
      spreadsheetName: ss.getName(),
      timezone: TIMEZONE,
      currentMonth: current,
      masterTabs: masterTabs,
      monthlyTabs: monthlyTabs,
    });
  } finally {
    lock.releaseLock();
  }
}

/** Creates the tab when missing, then aligns and styles it. */
function ensureTab_(ss, name, kind, spec) {
  let sheet = ss.getSheetByName(name);
  let isNew = false;
  if (!sheet) {
    sheet = ss.insertSheet(name);
    isNew = true;
  }
  const aligned = alignTab_(sheet, spec.headers, spec.types);
  if (isNew || aligned.changed) {
    styleTab_(sheet, aligned.headers, spec.types, spec.validations, kind);
  }
  return sheet;
}

/* ==================== ACTION: readTables ==================== */

function handleReadTables_(payload) {
  const ss = openSpreadsheet_();
  const tables = Array.isArray(payload.tables) ? payload.tables : [];
  const out = {};
  for (let i = 0; i < tables.length; i++) {
    const table = tables[i];
    if (!table || !table.key) continue;
    if (table.kind === 'master') {
      out[table.key] = readMasterTab_(ss, table.tab);
    } else {
      const suffix = table.suffix === undefined ? '' : String(table.suffix);
      out[table.key] = readMonthlyTabs_(ss, suffix);
    }
  }
  return ok_({ tables: out });
}

function readMasterTab_(ss, tabName) {
  if (!tabName) return [];
  const sheet = ss.getSheetByName(String(tabName));
  return sheet ? readSheetRows_(sheet, '') : [];
}

/** Collects rows from every monthly worksheet with this suffix. */
function readMonthlyTabs_(ss, suffix) {
  const rows = [];
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const parsed = parseMonthlyName_(sheets[i].getName());
    if (!parsed || parsed.suffix !== suffix) continue;
    const tabRows = readSheetRows_(sheets[i], parsed.monthKey);
    for (let r = 0; r < tabRows.length; r++) rows.push(tabRows[r]);
  }
  return rows;
}

/**
 * Turns a worksheet into records keyed by header name, plus the metadata the
 * Node engine needs: __row (sheet row number), __tab and __month. Rows that
 * are completely empty are skipped.
 */
function readSheetRows_(sheet, monthKey) {
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];

  const rawHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  const headers = [];
  for (let i = 0; i < rawHeaders.length; i++) {
    headers.push(rawHeaders[i] === null || rawHeaders[i] === undefined ? '' : String(rawHeaders[i]).trim());
  }
  while (headers.length && headers[headers.length - 1] === '') headers.pop();
  if (!headers.length) return [];

  const values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  const rows = [];
  for (let i = 0; i < values.length; i++) {
    if (rowIsEmpty_(values[i])) continue;
    const record = { __row: i + 2, __tab: sheet.getName(), __month: monthKey || '' };
    for (let c = 0; c < headers.length; c++) {
      record[headers[c]] = normalize_(values[i][c]);
    }
    rows.push(record);
  }
  return rows;
}

/* ==================== ACTION: writeBatch ==================== */
/**
 * Applies a batch of write operations under the script lock, so simultaneous
 * saves cannot race each other. The requestId is replayed from cache when the
 * Node server retries a request whose response was lost — a retry can never
 * write the same row twice. If any operation fails, nothing is flushed.
 */
function handleWriteBatch_(payload) {
  const ops = Array.isArray(payload.ops) ? payload.ops : [];
  const requestId = String(payload.requestId || '');

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(20000)) {
    return failEnv_('GATEWAY_BUSY', 'Another Sheets write is running. The server retries automatically.', true);
  }
  try {
    const requestCache = CacheService.getScriptCache();
    if (requestId) {
      const cached = requestCache.get(REQUEST_CACHE_PREFIX + requestId);
      if (cached) return ok_(JSON.parse(cached)); // replay: already applied
    }

    registerOpSpecs_(ops);
    const ss = openSpreadsheet_();
    const store = {}; // tab name -> in-memory snapshot for this batch
    const results = [];
    for (let i = 0; i < ops.length; i++) {
      results.push(applyOp_(ss, store, ops[i]));
    }

    // Make sure every monthly worksheet for each touched month exists
    // ("November 2026", "- Parts", "- Payments", "- Activity").
    createSiblingTabs_(ss, ops);

    for (const name in store) flushTab_(store[name]);
    SpreadsheetApp.flush();

    const result = { results: results, requestId: requestId };
    if (requestId) {
      try {
        requestCache.put(REQUEST_CACHE_PREFIX + requestId, JSON.stringify(result), 21600);
      } catch (cacheErr) {}
    }
    return ok_(result);
  } finally {
    lock.releaseLock();
  }
}

/** Applies one operation against the in-memory tab snapshots. */
function applyOp_(ss, store, op) {
  if (!op || !op.idHeader) throw fail_('BAD_OP', 'Invalid write operation.');
  const opSpec = {
    headers: Array.isArray(op.headers) ? op.headers : [],
    types: Array.isArray(op.types) ? op.types : [],
    validations: op.validations || {},
  };
  const candidates = candidateTabs_(ss, store, op, opSpec);

  let target = null;
  let found = -1;
  let month = '';

  // 1. Find the row by its unique ID across every candidate worksheet.
  for (let i = 0; i < candidates.length; i++) {
    const index = findRowIndex_(candidates[i], op.idHeader, op.id);
    if (index >= 0) {
      target = candidates[i];
      found = index;
      month = candidates[i].monthKey;
      break;
    }
  }

  // 2. Upsert fallback: find by natural key (for example Phone or Email).
  if (
    found < 0 &&
    op.mode === 'upsert' &&
    op.matchHeader &&
    op.matchValue !== undefined &&
    op.matchValue !== null
  ) {
    for (let i = 0; i < candidates.length; i++) {
      const index = findRowIndex_(candidates[i], op.matchHeader, op.matchValue);
      if (index >= 0) {
        target = candidates[i];
        found = index;
        month = candidates[i].monthKey;
        break;
      }
    }
  }

  // 3. Delete (idempotent — deleting a missing row still reports success).
  if (op.mode === 'delete') {
    if (!target || found < 0) {
      return { tab: op.tab || '', month: month, id: String(op.id), deleted: true };
    }
    target.rows.splice(found, 1);
    target.dirty = true;
    return { tab: target.name, month: month, id: String(op.id), deleted: true };
  }

  if (op.mode === 'update' && (!target || found < 0)) {
    throw fail_('NOT_FOUND', 'Record not found for update: ' + op.id);
  }
  if (op.mode === 'create' && target && found >= 0) {
    throw fail_('DUPLICATE', 'Duplicate create blocked: ' + op.id);
  }

  // 4. Unique-column guards, checked under the script lock.
  if (Array.isArray(op.uniqueChecks)) {
    for (let i = 0; i < op.uniqueChecks.length; i++) {
      const check = op.uniqueChecks[i];
      if (!check || !check.header || check.value === undefined || check.value === null || check.value === '') continue;
      for (let j = 0; j < candidates.length; j++) {
        const index = findRowIndex_(candidates[j], check.header, check.value);
        if (index < 0) continue;
        const isSelf = target === candidates[j] && index === found;
        if (!isSelf) throw fail_('DUPLICATE', 'Duplicate ' + check.header + ' blocked');
      }
    }
  }

  // 5. No existing row — resolve the worksheet to write into.
  if (!target) {
    if (op.kind === 'master') {
      if (!op.tab) throw fail_('BAD_OP', 'Master operation is missing its worksheet name.');
      target = loadOrCreate_(ss, store, op.tab, 'master', '', '', opSpec, true);
    } else {
      const key = op.monthKey || monthKeyNow_();
      month = key;
      target = loadOrCreate_(ss, store, monthTabName_(key, op.suffix || ''), 'monthly', op.suffix || '', key, opSpec, true);
    }
  }

  // 6. Build the row. Existing unknown columns keep their values.
  const row = found >= 0
    ? target.rows[found].slice()
    : new Array(target.headers.length).fill('');
  const data = op.data || {};
  for (let i = 0; i < target.headers.length; i++) {
    const header = target.headers[i];
    if (Object.prototype.hasOwnProperty.call(data, header)) {
      row[i] = toCell_(data[header], targetType_(header, opSpec));
    }
  }

  // Keep the original ID cell exactly as it was stored.
  let rowId = String(op.id);
  if (found >= 0) {
    const idCol = target.colOf[op.idHeader];
    const previous = idCol === undefined ? '' : target.rows[found][idCol];
    if (previous !== '' && previous !== null && previous !== undefined) {
      rowId = normalize_(previous);
      row[idCol] = previous;
    }
  }

  if (found >= 0) target.rows[found] = row;
  else target.rows.push(row);
  target.dirty = true;
  return { tab: target.name, month: month, id: rowId, deleted: false };
}

/** Worksheets that may contain the row: master tab or every month's tab. */
function candidateTabs_(ss, store, op, opSpec) {
  const list = [];
  if (op.kind === 'master') {
    if (op.tab) {
      const tab = loadOrCreate_(ss, store, String(op.tab), 'master', '', '', opSpec, false);
      if (tab) list.push(tab);
    }
    return list;
  }
  const suffix = op.suffix === undefined ? '' : String(op.suffix);
  if (op.monthKey) {
    let name = '';
    try { name = monthTabName_(String(op.monthKey), suffix); } catch (monthErr) {}
    if (name) {
      const specific = loadOrCreate_(ss, store, name, 'monthly', suffix, String(op.monthKey), opSpec, false);
      if (specific) list.push(specific);
    }
  }
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const parsed = parseMonthlyName_(sheets[i].getName());
    if (!parsed || parsed.suffix !== suffix) continue;
    const tab = loadOrCreate_(ss, store, sheets[i].getName(), 'monthly', suffix, parsed.monthKey, opSpec, false);
    if (tab && list.indexOf(tab) < 0) list.push(tab);
  }
  return list;
}

/** Finds a row by header + value across the tab snapshot. */
function findRowIndex_(tab, header, value) {
  const col = tab.colOf[header];
  if (col === undefined) return -1;
  const needle = String(value);
  for (let i = 0; i < tab.rows.length; i++) {
    if (normalize_(tab.rows[i][col]) === needle) return i;
  }
  return -1;
}

/* ==================== TAB SNAPSHOTS ==================== */

/**
 * Loads a worksheet into the batch store (or creates it when `create` is
 * true). The snapshot keeps rows as arrays aligned with the header row, so
 * the whole tab can be flushed back in one write after the batch succeeds.
 */
function loadOrCreate_(ss, store, name, kind, suffix, monthKey, spec, create) {
  const existing = store[name];
  if (existing) return existing;

  let sheet = ss.getSheetByName(name);
  let isNew = false;
  if (!sheet) {
    if (!create) return null;
    sheet = ss.insertSheet(name);
    isNew = true;
  }

  const aligned = alignTab_(sheet, spec.headers, spec.types);
  if (isNew || aligned.changed) {
    styleTab_(sheet, aligned.headers, spec.types, spec.validations, kind);
  }

  const headers = aligned.headers;
  const colOf = {};
  for (let i = 0; i < headers.length; i++) {
    if (headers[i] !== '' && colOf[headers[i]] === undefined) colOf[headers[i]] = i;
  }

  const tab = {
    name: name,
    kind: kind,
    suffix: suffix,
    monthKey: monthKey,
    sheet: sheet,
    headers: headers,
    colOf: colOf,
    spec: spec,
    rows: [],
    prevRows: 0,
    dirty: false,
  };

  const lastRow = sheet.getLastRow();
  if (lastRow > 1 && headers.length) {
    const data = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    let end = data.length;
    while (end > 0 && rowIsEmpty_(data[end - 1])) end--;
    tab.rows = data.slice(0, end);
  }
  tab.prevRows = tab.rows.length;

  store[name] = tab;
  return tab;
}

/** Writes a dirty snapshot back to the worksheet in one operation. */
function flushTab_(tab) {
  if (!tab || !tab.dirty) return;
  const sheet = tab.sheet;
  const width = tab.headers.length;
  if (!width) return;

  const rows = tab.rows;
  const needed = rows.length + 1;
  if (needed > sheet.getMaxRows()) {
    sheet.insertRowsAfter(sheet.getMaxRows(), needed - sheet.getMaxRows());
  }

  if (rows.length) {
    sheet.getRange(2, 1, rows.length, width).setValues(rows);
    refreshDateFormats_(tab);
  }
  const excess = tab.prevRows - rows.length;
  if (excess > 0) {
    sheet.getRange(2 + rows.length, 1, excess, width).clearContent();
  }
}

/** Keeps IST timestamps displayed as DD-MM-YYYY HH:mm:ss after writes. */
function refreshDateFormats_(tab) {
  try {
    for (let i = 0; i < tab.headers.length; i++) {
      const type = targetType_(tab.headers[i], tab.spec || { headers: [], types: [] });
      if (type === 'DateTime') {
        tab.sheet.getRange(2, i + 1, tab.rows.length, 1).setNumberFormat('dd-MM-yyyy HH:mm:ss');
      }
    }
  } catch (formatErr) {
    // Display formatting only — never fail a data write for it.
  }
}

/* ==================== TAB ALIGNMENT (DATA-SAFE) ==================== */

/**
 * Guarantees the worksheet has every schema header, in schema order, without
 * losing anything:
 *   • fast path — headers already match: nothing is written;
 *   • otherwise — rows are remapped BY COLUMN NAME into the schema order and
 *     any extra columns the sheet already had are appended on the right.
 * Returns { headers, changed }.
 */
function alignTab_(sheet, headers, types) {
  const spec = Array.isArray(headers) ? headers.map(String) : [];
  const lastCol = Math.max(sheet.getLastColumn(), 1);
  const lastRow = sheet.getLastRow();

  const raw = sheet.getRange(1, 1, 1, lastCol).getValues()[0] || [];
  const current = [];
  for (let i = 0; i < raw.length; i++) {
    current.push(raw[i] === null || raw[i] === undefined ? '' : String(raw[i]).trim());
  }
  while (current.length && current[current.length - 1] === '') current.pop();

  if (current.length === spec.length) {
    let same = true;
    for (let i = 0; i < spec.length; i++) {
      if (current[i] !== spec[i]) { same = false; break; }
    }
    if (same) return { headers: current, changed: false };
  }

  const final = spec.slice();
  const seen = {};
  for (let i = 0; i < final.length; i++) seen[final[i]] = true;
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== '' && !seen[current[i]]) {
      final.push(current[i]);
      seen[current[i]] = true;
    }
  }

  const indexOf = {};
  for (let i = 0; i < current.length; i++) {
    if (current[i] !== '' && indexOf[current[i]] === undefined) indexOf[current[i]] = i;
  }

  const matrix = [final];
  if (lastRow > 1 && current.length) {
    const data = sheet.getRange(2, 1, lastRow - 1, current.length).getValues();
    for (let r = 0; r < data.length; r++) {
      const newRow = [];
      for (let c = 0; c < final.length; c++) {
        const col = indexOf[final[c]];
        newRow.push(col === undefined ? '' : data[r][col]);
      }
      matrix.push(newRow);
    }
  }

  sheet.getRange(1, 1, matrix.length, final.length).setValues(matrix);
  return { headers: final, changed: true };
}

/** One-time premium look: frozen bold header, tab colour, formats, dropdowns. */
function styleTab_(sheet, headers, types, validations, kind) {
  try {
    const width = headers.length;
    if (!width) return;
    sheet.setFrozenRows(1);
    sheet.getRange(1, 1, 1, width)
      .setFontWeight('bold')
      .setBackground('#0f172a')
      .setFontColor('#ffffff')
      .setFontSize(10);
    sheet.setTabColor(kind === 'monthly' ? '#64748b' : '#0891b2');

    const dataRows = Math.max(sheet.getMaxRows() - 1, 1);
    for (let i = 0; i < width; i++) {
      if (types && types[i] === 'DateTime') {
        sheet.getRange(2, i + 1, dataRows, 1).setNumberFormat('dd-MM-yyyy HH:mm:ss');
      }
    }

    if (validations) {
      for (const header in validations) {
        const values = validations[header];
        if (!Array.isArray(values) || !values.length) continue;
        const idx = headers.indexOf(header);
        if (idx < 0) continue;
        const rule = SpreadsheetApp.newDataValidation()
          .requireValueInList(values)
          .setAllowInvalid(true)
          .build();
        sheet.getRange(2, idx + 1, dataRows, 1).setDataValidation(rule);
      }
    }

    for (let c = 1; c <= width; c++) sheet.autoSizeColumn(c);
  } catch (styleErr) {
    // Styling must never break data operations.
  }
}

/** Creates every monthly worksheet for each month touched by the batch. */
function createSiblingTabs_(ss, ops) {
  const months = {};
  for (let i = 0; i < ops.length; i++) {
    const op = ops[i];
    if (op && op.kind === 'monthly' && op.monthKey) months[String(op.monthKey)] = true;
  }
  if (!Object.keys(months).length) return;

  const registry = loadMonthlyRegistry_();
  for (const key in months) {
    for (const suffix in registry) {
      const spec = registry[suffix];
      let name = '';
      try { name = monthTabName_(key, suffix); } catch (monthErr) { continue; }
      if (!name || ss.getSheetByName(name)) continue;
      try {
        const sheet = ss.insertSheet(name);
        const aligned = alignTab_(sheet, spec.headers, spec.types);
        styleTab_(sheet, aligned.headers, spec.types, spec.validations, 'monthly');
      } catch (createErr) {}
    }
  }
}

/* ==================== SCHEMA REGISTRY ==================== */

/** Remembers the monthly worksheet layouts between requests. */
function loadMonthlyRegistry_() {
  try {
    const raw = PropertiesService.getScriptProperties().getProperty(REGISTRY_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (registryErr) {
    return {};
  }
}

function saveMonthlyRegistry_(monthly) {
  try {
    const registry = loadMonthlyRegistry_();
    let changed = false;
    for (let i = 0; i < monthly.length; i++) {
      const spec = monthly[i];
      if (!spec || spec.suffix === undefined || !Array.isArray(spec.headers) || !spec.headers.length) continue;
      registry[String(spec.suffix)] = {
        headers: spec.headers,
        types: Array.isArray(spec.types) ? spec.types : [],
        validations: spec.validations || {},
      };
      changed = true;
    }
    if (changed) {
      PropertiesService.getScriptProperties().setProperty(REGISTRY_KEY, JSON.stringify(registry));
    }
  } catch (saveErr) {
    // Registry is an optimisation — writes still work without it.
  }
}

/** Learns monthly layouts straight from write operations, just in case. */
function registerOpSpecs_(ops) {
  try {
    const registry = loadMonthlyRegistry_();
    let changed = false;
    for (let i = 0; i < ops.length; i++) {
      const op = ops[i];
      if (!op || op.kind !== 'monthly' || !Array.isArray(op.headers) || !op.headers.length) continue;
      const suffix = String(op.suffix === undefined ? '' : op.suffix);
      if (registry[suffix] === undefined) {
        registry[suffix] = {
          headers: op.headers,
          types: Array.isArray(op.types) ? op.types : [],
          validations: op.validations || {},
        };
        changed = true;
      }
    }
    if (changed) {
      PropertiesService.getScriptProperties().setProperty(REGISTRY_KEY, JSON.stringify(registry));
    }
  } catch (regErr) {}
}

/* ==================== VALUE HELPERS ==================== */

/** Cell -> protocol string. Dates become IST "DD-MM-YYYY HH:mm:ss". */
function normalize_(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return formatIst_(value);
  const text = String(value);
  if (text.length > 1 && text.charAt(0) === "'" && '=+-@'.indexOf(text.charAt(1)) >= 0) {
    return text.substring(1);
  }
  return text;
}

/**
 * Protocol value -> cell. DateTime values arrive as ISO strings and are
 * written as real date cells (shown in IST via the column number format).
 * Strings that could be mistaken for formulas are stored as text.
 */
function toCell_(value, type) {
  if (value === null || value === undefined || value === '') return '';
  if (type === 'DateTime') {
    const date = value instanceof Date ? value : new Date(String(value));
    if (isNaN(date.getTime())) return String(value); // keep raw text if unparseable
    return date;
  }
  if (type === 'Int') {
    const n = Math.trunc(Number(value));
    return isNaN(n) ? 0 : n;
  }
  if (type === 'Float') {
    const f = Number(value);
    return isFinite(f) ? f : 0;
  }
  if (type === 'Boolean') {
    return value === true || value === 'true' || value === 1;
  }
  const text = String(value);
  return /^[=+\-@]/.test(text) ? "'" + text : text;
}

/** Type of a header according to the operation's schema. */
function targetType_(header, spec) {
  const idx = spec && Array.isArray(spec.headers) ? spec.headers.indexOf(header) : -1;
  return idx >= 0 && spec.types && spec.types[idx] ? spec.types[idx] : 'String';
}

function formatIst_(date) {
  return Utilities.formatDate(date, TIMEZONE, 'dd-MM-yyyy HH:mm:ss');
}

function monthKeyNow_() {
  return Utilities.formatDate(new Date(), TIMEZONE, 'yyyy-MM');
}

/** "2026-11" + "Parts" -> "November 2026 - Parts" (matches schema.ts). */
function monthTabName_(monthKey, suffix) {
  const parts = String(monthKey || '').split('-');
  const year = Number(parts[0]);
  const month = Number(parts[1]);
  if (!year || !month || month < 1 || month > 12) {
    throw fail_('BAD_MONTH', 'Invalid month key: ' + monthKey);
  }
  return MONTHS_[month - 1] + ' ' + year + (suffix ? ' - ' + suffix : '');
}

/** "November 2026 - Parts" -> { monthKey: "2026-11", suffix: "Parts" }. */
function parseMonthlyName_(name) {
  const match = MONTHLY_NAME_RE_.exec(String(name));
  if (!match) return null;
  const idx = MONTHS_.indexOf(match[1]);
  return {
    monthKey: match[2] + '-' + String(idx + 1).padStart(2, '0'),
    suffix: match[3] || '',
  };
}

function rowIsEmpty_(row) {
  for (let i = 0; i < row.length; i++) {
    const v = row[i];
    if (v !== '' && v !== null && v !== undefined) return false;
  }
  return true;
}

/* ==================== ACTION: uploadImage ==================== */

function handleUploadImage_(payload) {
  const base64 = String(payload.base64 || '');
  const mimeType = String(payload.mimeType || 'image/jpeg');
  const filename = String(payload.filename || 'image');
  const monthKey = String(payload.monthKey || monthKeyNow_());
  if (!base64) return failEnv_('BAD_REQUEST', 'The image payload is empty.');

  const bytes = Utilities.base64Decode(base64);
  const blob = Utilities.newBlob(bytes, mimeType, filename);
  const file = imageFolder_().createFile(blob);
  try {
    file.setDescription('FIXIT AI image — month ' + monthKey);
  } catch (descErr) {}

  return ok_({
    fileId: file.getId(),
    name: file.getName(),
    mimeType: mimeType,
    size: file.getSize(),
    url: file.getUrl(),
    monthKey: monthKey,
  });
}

/** Images live next to the spreadsheet, in a dedicated folder. */
function imageFolder_() {
  let folder = null;
  try {
    const parents = DriveApp.getFileById(SPREADSHEET_ID).getParents();
    folder = parents.hasNext() ? parents.next() : null;
  } catch (parentErr) {}
  if (!folder) folder = DriveApp.getRootFolder();
  const found = folder.getFoldersByName(IMAGE_FOLDER_NAME);
  return found.hasNext() ? found.next() : folder.createFolder(IMAGE_FOLDER_NAME);
}

/* ==================== ACTION: getImage ==================== */

function handleGetImage_(payload) {
  const fileId = String(payload.fileId || '');
  if (!fileId) return failEnv_('BAD_REQUEST', 'Missing image id.');
  let file = null;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (findErr) {
    return failEnv_('NOT_FOUND', 'Image not found.');
  }
  const blob = file.getBlob();
  const bytes = blob.getBytes();
  return ok_({
    fileId: fileId,
    name: file.getName(),
    mimeType: blob.getContentType(),
    base64: Utilities.base64Encode(bytes),
    size: bytes.length,
  });
}

/* ==================== ACTION: backup ==================== */

function handleBackup_() {
  const name = 'FIXIT AI Backup — ' + formatIst_(new Date());
  let parent = null;
  try {
    const parents = DriveApp.getFileById(SPREADSHEET_ID).getParents();
    parent = parents.hasNext() ? parents.next() : null;
  } catch (parentErr) {}
  const copy = parent
    ? DriveApp.getFileById(SPREADSHEET_ID).makeCopy(name, parent)
    : DriveApp.getFileById(SPREADSHEET_ID).makeCopy(name);
  return ok_({
    fileId: copy.getId(),
    name: name,
    url: copy.getUrl(),
    createdAt: new Date().toISOString(),
  });
}

/* ==================== ACTION: listMonths ==================== */

function handleListMonths_() {
  const ss = openSpreadsheet_();
  const found = {};
  const sheets = ss.getSheets();
  for (let i = 0; i < sheets.length; i++) {
    const parsed = parseMonthlyName_(sheets[i].getName());
    if (parsed) found[parsed.monthKey] = true;
  }
  const months = Object.keys(found);
  months.sort(function (a, b) { return a < b ? 1 : a > b ? -1 : 0; });
  return ok_({ months: months });
}

/* ==================== EDITOR SELF-TEST ==================== */

/** Select this in the Apps Script editor and press Run (no deploy needed). */
function testGateway() {
  const ss = openSpreadsheet_();
  Logger.log('Connected to spreadsheet: ' + ss.getName());
  Logger.log('Worksheets: ' + ss.getSheets().map(function (s) { return s.getName(); }).join(', '));
  Logger.log('Current month key: ' + monthKeyNow_());
  Logger.log('Example tab name: ' + monthTabName_(monthKeyNow_(), 'Parts'));
  Logger.log('If you can read these lines, the gateway code is valid.');
}
