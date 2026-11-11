/**
 * In-memory stand-in for server/sheets/appsscript/Code.gs.
 *
 * It implements the same request protocol as the real Apps Script gateway so
 * the Node engine, middleware and HTTP routes can be exercised without a
 * Google account. It is deliberately NOT part of the runtime: the production
 * server always talks to the deployed Web App.
 */
import http from 'node:http'

export type FakeRow = Record<string, unknown>

export type FakeTab = {
  name: string
  kind: 'master' | 'monthly'
  suffix: string
  monthKey: string
  headers: string[]
  types: string[]
  validations: Record<string, string[]>
  rows: FakeRow[]
}

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
]

export function fakeMonthTab(monthKey: string, suffix: string) {
  const [year, month] = monthKey.split('-').map(Number)
  return `${MONTHS[month - 1]} ${year}${suffix ? ` - ${suffix}` : ''}`
}

export function fakeMonthKeyNow() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(new Date())
  const year = parts.find((p) => p.type === 'year')?.value
  const month = parts.find((p) => p.type === 'month')?.value
  return `${year}-${month}`
}

function formatIst(date: Date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Kolkata',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date)
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? '00'
  return `${get('day')}-${get('month')}-${get('year')} ${get('hour')}:${get('minute')}:${get('second')}`
}

function normalize(value: unknown) {
  if (value === null || value === undefined) return ''
  if (value instanceof Date) return formatIst(value)
  const text = String(value)
  if (text.length > 1 && text[0] === "'" && '=+-@'.includes(text[1])) return text.slice(1)
  return text
}

function toCell(value: unknown, type: string) {
  if (value === null || value === undefined || value === '') return ''
  if (type === 'DateTime') {
    return value instanceof Date ? formatIst(value) : formatIst(new Date(String(value)))
  }
  if (type === 'Int') return Math.trunc(Number(value)) || 0
  if (type === 'Float') return Number.isFinite(Number(value)) ? Number(value) : 0
  if (type === 'Boolean') return value === true || value === 'true' || value === 1
  const text = String(value)
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

export type FakeGateway = {
  tabs: Map<string, FakeTab>
  url: string
  listen: () => Promise<void>
  close: () => Promise<void>
  /** Simulates a Sheets write that Google rejects while reads keep working. */
  setFailWrites: (fail: boolean) => void
  /**
   * Simulates transient gateway failures. `when: 'before'` rejects before any
   * row is applied; `when: 'after'` applies the batch and stores its result,
   * then loses the response (the retry must replay the cached result).
   */
  failNextWrites: (count: number, when?: 'before' | 'after') => void
}

function fail(code: string, message: string) {
  const error = new Error(message) as Error & { code?: string }
  error.code = code
  return error
}

/**
 * Starts an in-memory gateway. Use `tabs` in tests to assert what was stored.
 * The caller is responsible for pointing SHEETS_GATEWAY_URL at `url` before
 * importing server/db.
 */
export function createFakeGateway(options: {
  port: number
  secret: string
  spreadsheetId?: string
  spreadsheetName?: string
}): FakeGateway {
  const { port, secret } = options
  const spreadsheetId = options.spreadsheetId ?? '1QILuEi6NIlaBb3tYWqJ5EsRF3_MksxnN_eembEIuOYU'
  const spreadsheetName = options.spreadsheetName ?? 'Data Storage spreadsheet'
  const tabs = new Map<string, FakeTab>()
  const images = new Map<string, { base64: string; mimeType: string }>()
  const requests = new Map<string, unknown>()
  const monthlySchemas = new Map<string, { headers: string[]; types: string[]; validations: Record<string, string[]> }>()
  let fileCounter = 0
  let failWrites = false
  let failNext = 0
  let failWhen: 'before' | 'after' = 'before'

  function getOrCreate(
    name: string,
    kind: 'master' | 'monthly',
    suffix: string,
    monthKey: string,
    headers: string[],
    types: string[],
    validations: Record<string, string[]>,
  ) {
    let tab = tabs.get(name)
    if (!tab) {
      tab = { name, kind, suffix, monthKey, headers, types, validations, rows: [] }
      tabs.set(name, tab)
    }
    return tab
  }

  function findRow(tab: FakeTab, idHeader: string, id: string) {
    return tab.rows.findIndex((row) => normalize(row[idHeader]) === String(id))
  }

  function findValue(tab: FakeTab, header: string, value: string) {
    return tab.rows.findIndex((row) => normalize(row[header]) === String(value))
  }

  function candidateTabs(op: Record<string, any>): FakeTab[] {
    if (op.kind === 'master') return tabs.has(op.tab) ? [tabs.get(op.tab)!] : []
    const list: FakeTab[] = []
    if (op.monthKey) {
      const name = fakeMonthTab(op.monthKey, op.suffix)
      if (tabs.has(name)) list.push(tabs.get(name)!)
    }
    for (const tab of tabs.values()) {
      if (tab.kind === 'monthly' && tab.suffix === op.suffix && !list.includes(tab)) list.push(tab)
    }
    return list
  }

  function applyOp(op: Record<string, any>) {
    const headers: string[] = op.headers
    const types: string[] = op.types
    const candidates = candidateTabs(op)
    let target: FakeTab | null = null
    let found = -1
    let month = ''

    for (const candidate of candidates) {
      const index = findRow(candidate, op.idHeader, op.id)
      if (index >= 0) {
        target = candidate
        found = index
        month = candidate.monthKey
        break
      }
    }

    if (found < 0 && op.mode === 'upsert' && op.matchHeader && op.matchValue !== undefined) {
      for (const candidate of candidates) {
        const index = findValue(candidate, op.matchHeader, op.matchValue)
        if (index >= 0) {
          target = candidate
          found = index
          month = candidate.monthKey
          break
        }
      }
    }

    if (op.mode === 'delete') {
      if (!target || found < 0) return { tab: op.tab || '', month, id: op.id, deleted: true }
      target.rows.splice(found, 1)
      return { tab: target.name, month, id: op.id, deleted: true }
    }
    if (op.mode === 'update' && (!target || found < 0)) {
      throw fail('NOT_FOUND', 'Record not found for update: ' + op.id)
    }
    if (op.mode === 'create' && target && found >= 0) {
      throw fail('DUPLICATE', 'Duplicate create blocked: ' + op.id)
    }

    if (Array.isArray(op.uniqueChecks)) {
      for (const check of op.uniqueChecks) {
        if (
          !check ||
          !check.header ||
          check.value === undefined ||
          check.value === null ||
          check.value === ''
        ) {
          continue
        }
        for (const candidate of candidates) {
          const index = findValue(candidate, check.header, check.value)
          if (index < 0) continue
          const isSelf = target === candidate && index === found
          if (!isSelf) throw fail('DUPLICATE', `Duplicate ${check.header} blocked`)
        }
      }
    }

    if (!target) {
      if (op.kind === 'master') {
        const existing = tabs.get(op.tab)
        if (!existing) throw new Error('Master tab not found: ' + op.tab)
        target = existing
      } else {
        const key = op.monthKey || fakeMonthKeyNow()
        month = key
        target = getOrCreate(
          fakeMonthTab(key, op.suffix),
          'monthly',
          op.suffix,
          key,
          headers,
          types,
          op.validations || {},
        )
      }
    }

    const values: FakeRow = {}
    headers.forEach((header, index) => {
      values[header] = toCell(op.data ? op.data[header] : null, types[index] || 'String')
    })
    if (op.data && op.data['Record Type'] !== undefined) {
      values['Record Type'] = op.data['Record Type']
    }

    let rowId = String(op.id)
    if (found >= 0) {
      const previous = target.rows[found]
      if (previous[op.idHeader]) {
        rowId = normalize(previous[op.idHeader])
        values[op.idHeader] = previous[op.idHeader]
      }
      target.rows[found] = values
    } else {
      target.rows.push(values)
    }
    return { tab: target.name, month, id: rowId, deleted: false }
  }

  function readTables(tables: Array<Record<string, any>>) {
    const response: Record<string, FakeRow[]> = {}
    // Google returns raw cells; the real gateway turns them back into JSON.
    const expose = (row: FakeRow): FakeRow => {
      const out: FakeRow = {}
      for (const [key, value] of Object.entries(row)) out[key] = normalize(value)
      return out
    }
    for (const table of tables) {
      if (table.kind === 'master') {
        const tab = tabs.get(table.tab)
        response[table.key] = tab
          ? tab.rows.map((row, i) => ({ ...expose(row), __row: i + 2, __tab: tab.name, __month: '' }))
          : []
      } else {
        const rows: FakeRow[] = []
        for (const tab of tabs.values()) {
          if (tab.kind !== 'monthly' || tab.suffix !== table.suffix) continue
          tab.rows.forEach((row, i) => {
            rows.push({ ...expose(row), __row: i + 2, __tab: tab.name, __month: tab.monthKey })
          })
        }
        response[table.key] = rows
      }
    }
    return { tables: response }
  }

  const server = http.createServer((req, res) => {
    let body = ''
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => {
      const reply = (value: unknown) => {
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify(value))
      }
      try {
        const input = JSON.parse(body || '{}')
        if (input.secret !== secret) {
          return reply({ ok: false, error: 'Unauthorized', code: 'UNAUTHORIZED' })
        }
        switch (input.action) {
          case 'ping':
            return reply({
              ok: true,
              result: {
                spreadsheetId,
                spreadsheetName,
                timezone: 'Asia/Kolkata',
                tabs: [...tabs.keys()],
                now: formatIst(new Date()),
              },
            })
          case 'ensureSchema': {
            for (const master of input.schema.masters) {
              getOrCreate(master.tab, 'master', '', '', master.headers, master.types, master.validations)
            }
            const current = fakeMonthKeyNow()
            for (const monthly of input.schema.monthly) {
              monthlySchemas.set(monthly.suffix, {
                headers: monthly.headers,
                types: monthly.types,
                validations: monthly.validations,
              })
              getOrCreate(
                fakeMonthTab(current, monthly.suffix),
                'monthly',
                monthly.suffix,
                current,
                monthly.headers,
                monthly.types,
                monthly.validations,
              )
            }
            return reply({
              ok: true,
              result: {
                spreadsheetId,
                spreadsheetName,
                timezone: 'Asia/Kolkata',
                currentMonth: current,
                masterTabs: [],
                monthlyTabs: [],
              },
            })
          }
          case 'readTables':
            return reply({ ok: true, result: readTables(input.tables || []) })
          case 'writeBatch': {
            if (failWrites) {
              return reply({
                ok: false,
                error: 'Simulated Google Sheets write failure.',
                code: 'GATEWAY_ERROR',
              })
            }
            const cached = requests.get(input.requestId)
            if (cached) return reply({ ok: true, result: cached })

            if (failNext > 0 && failWhen === 'before') {
              failNext -= 1
              return reply({
                ok: false,
                error: 'Simulated transient Google failure. Please retry.',
                code: 'GATEWAY_ERROR',
                retryable: true,
              })
            }
            // Like the real gateway, a monthly write creates every supporting
            // tab for that month before applying the operations.
            const months = new Set<string>()
            for (const op of input.ops) {
              if (op.kind === 'monthly' && op.monthKey) months.add(op.monthKey)
            }
            for (const key of months) {
              for (const [suffix, schema] of monthlySchemas) {
                getOrCreate(
                  fakeMonthTab(key, suffix),
                  'monthly',
                  suffix,
                  key,
                  schema.headers,
                  schema.types,
                  schema.validations,
                )
              }
            }
            const results: unknown[] = []
            for (const op of input.ops) results.push(applyOp(op))
            const result = { results, requestId: input.requestId }
            requests.set(input.requestId, result)
            if (failNext > 0 && failWhen === 'after') {
              failNext -= 1
              return reply({
                ok: false,
                error: 'Simulated lost response after the write was applied.',
                code: 'GATEWAY_ERROR',
                retryable: true,
              })
            }
            return reply({ ok: true, result })
          }
          case 'uploadImage': {
            const fileId = `drivefile${String(++fileCounter).padStart(20, '0')}`
            images.set(fileId, { base64: input.base64, mimeType: input.mimeType })
            return reply({
              ok: true,
              result: {
                fileId,
                name: input.filename,
                mimeType: input.mimeType,
                size: 1,
                url: 'https://drive.example/' + fileId,
                monthKey: input.monthKey,
              },
            })
          }
          case 'getImage': {
            const image = images.get(input.fileId)
            if (!image) return reply({ ok: false, error: 'Image not found', code: 'NOT_FOUND' })
            return reply({
              ok: true,
              result: {
                fileId: input.fileId,
                name: 'image.png',
                mimeType: image.mimeType,
                base64: image.base64,
                size: 1,
              },
            })
          }
          case 'backup':
            return reply({
              ok: true,
              result: {
                fileId: 'backup-1',
                name: 'Backup',
                url: 'https://drive.example/backup-1',
                createdAt: new Date().toISOString(),
              },
            })
          default:
            return reply({ ok: false, error: 'Unknown action', code: 'UNKNOWN_ACTION' })
        }
      } catch (err) {
        reply({
          ok: false,
          error: err instanceof Error ? err.message : String(err),
          code: (err as { code?: string } | null)?.code || 'GATEWAY_ERROR',
          retryable: false,
        })
      }
    })
  })

  return {
    tabs,
    url: `http://127.0.0.1:${port}`,
    listen: () => new Promise<void>((resolve) => server.listen(port, resolve)),
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    setFailWrites: (fail: boolean) => {
      failWrites = fail
    },
    failNextWrites: (count: number, when: 'before' | 'after' = 'before') => {
      failNext = count
      failWhen = when
    },
  }
}
