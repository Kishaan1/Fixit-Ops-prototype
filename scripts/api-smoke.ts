/**
 * Full HTTP smoke test against the real Express app, backed by the in-memory
 * gateway in scripts/fake-gateway.ts.
 *
 * This checks the pieces the engine test cannot reach: session cookies, the
 * request-scoped write context, flush-before-response, the "no false success"
 * failure path, and route validation. It still does NOT test Google Sheets;
 * use `npm run test:sheets` for the live spreadsheet.
 */
import { createFakeGateway, fakeMonthKeyNow, fakeMonthTab } from './fake-gateway'

const API_PORT = 4110
const GATEWAY_PORT = 4790
const SECRET = 'api-smoke-secret'
const PASSWORD = 'Smoke-Test-Password-123'
const PHONE_OK = '+919811112222'
const PHONE_FAIL = '+919833334444'
const PHONE_RETRY = '+919844445555'
const PHONE_LOST = '+919855556666'

process.env.SHEETS_GATEWAY_URL = `http://127.0.0.1:${GATEWAY_PORT}`
process.env.SHEETS_GATEWAY_SECRET = SECRET
process.env.PORT = String(API_PORT)
process.env.PUBLIC_BASE_URL = `http://127.0.0.1:${API_PORT}`
process.env.SESSION_SECRET = 'api-smoke-session-secret-0123456789abcdef'
process.env.EXPOSE_RESET_TOKENS = 'false'

let failed = 0
function check(condition: unknown, message: string) {
  if (!condition) {
    failed += 1
    console.error('  FAIL — ' + message)
    return
  }
  console.log('  pass — ' + message)
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// The gateway stores a leading apostrophe to stop Sheets from treating a
// value like "+91…" as a formula. Strip it when inspecting raw rows directly.
function cellText(value: unknown) {
  return String(value ?? '').replace(/^'([=+\-@])/, '$1')
}

function cookieFrom(response: Response) {
  const header = response.headers.getSetCookie?.().find((value) => value.startsWith('fixit_session='))
  return header ? header.split(';')[0] : ''
}

async function request(
  path: string,
  options: { method?: string; body?: unknown; cookie?: string } = {},
) {
  const headers: Record<string, string> = {}
  if (options.body !== undefined) headers['content-type'] = 'application/json'
  if (options.cookie) headers.cookie = options.cookie
  const response = await fetch(`http://127.0.0.1:${API_PORT}${path}`, {
    method: options.method ?? 'GET',
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  })
  const text = await response.text()
  let json: any = null
  try {
    json = JSON.parse(text)
  } catch {
    json = text
  }
  return { status: response.status, json, response }
}

async function main() {
  const gateway = createFakeGateway({ port: GATEWAY_PORT, secret: SECRET })
  await gateway.listen()
  const tabs = gateway.tabs

  // Seed one owner and the shop settings directly through the engine.
  const { prisma } = await import('../server/db')
  const db = prisma as unknown as Record<string, any>
  const { hashPassword } = await import('../server/lib/auth')
  const { ensureSheetsSchema, runWithSheetsWrite } = await import('../server/sheets/runtime')
  await ensureSheetsSchema()
  await runWithSheetsWrite(async () => {
    await db.shop.upsert({
      where: { id: 'shop' },
      create: { id: 'shop', name: 'Smoke Repair Lab', taxRate: 0, ownerApprovalThreshold: 0 },
      update: {},
    })
    await db.user.create({
      data: {
        id: 'smoke-owner',
        email: 'smoke-owner@fixit.local',
        name: 'Smoke Owner',
        role: 'OWNER',
        passwordHash: hashPassword(PASSWORD),
      },
    })
    const techUser = await db.user.create({
      data: {
        id: 'smoke-tech-user',
        userId: 'SMOKETECH',
        email: 'smoke-tech@fixit.local',
        name: 'Smoke Technician',
        role: 'TECHNICIAN',
        passwordHash: hashPassword(PASSWORD),
      },
    })
    await db.technician.create({
      data: {
        id: 'smoke-tech',
        userId: techUser.id,
        specialization: 'Mobile',
        active: true,
      },
    })
  })

  // Importing the app starts the listener.
  await import('../server/index')

  let ready = false
  for (let attempt = 0; attempt < 50 && !ready; attempt += 1) {
    try {
      const health = await request('/api/health')
      ready = health.status === 200
    } catch {
      await sleep(100)
    }
  }
  if (!ready) throw new Error('The API did not start listening.')

  console.log('\n[api] health')
  const health = await request('/api/health')
  check(health.status === 200, 'health returns 200')
  check(health.json.ok === true, 'health reports ok')
  check(health.json.database === 'google-sheets', 'health reports the Sheets database')
  check(health.json.spreadsheet?.id === gatewayUrlId(), 'health reports the target spreadsheet')

  console.log('\n[api] login stores only a hashed session id')
  const login = await request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'smoke-owner@fixit.local', password: PASSWORD, portal: 'OWNER' },
  })
  check(login.status === 200, `login returns 200 (got ${login.status})`)
  const cookie = cookieFrom(login.response)
  check(Boolean(cookie), 'login sets the session cookie')
  const cookieToken = cookie.split('=')[1] ?? ''
  const sessionRows = tabs.get('Sessions')?.rows ?? []
  check(sessionRows.length === 1, 'login wrote exactly one session row before responding')
  const storedId = String(sessionRows[0]?.['Session ID'] ?? '')
  check(storedId.length === 64, 'stored session id is a SHA-256 hash')
  check(storedId !== cookieToken, 'the cookie token itself is not stored')

  console.log('\n[api] authenticated reads')
  const me = await request('/api/auth/me', { cookie })
  check(me.status === 200 && me.json.user?.role === 'OWNER', 'session is accepted on /me')
  const customersBefore = await request('/api/customers', { cookie })
  check(customersBefore.status === 200, 'customer list returns 200')

  console.log('\n[api] customer create flushes before the response')
  const created = await request('/api/customers', {
    method: 'POST',
    cookie,
    body: { name: 'HTTP Smoke Customer', phone: PHONE_OK },
  })
  check(created.status === 201, `customer create returns 201 (got ${created.status})`)
  const customerRows = tabs.get('Customers')?.rows ?? []
  check(customerRows.length === 1, 'the row exists in the spreadsheet when the response arrives')
  check(cellText(customerRows[0]?.['Phone']) === PHONE_OK.replace(/\D/g, ''), 'the stored phone matches')
  const fetched = await request(`/api/customers/${created.json.customer.id}`, { cookie })
  check(fetched.status === 200 && fetched.json.customer?.name === 'HTTP Smoke Customer', 'read back by ID')

  console.log('\n[api] parts and analytics')
  const part = await request('/api/parts', {
    method: 'POST',
    cookie,
    body: {
      name: 'Smoke LCD',
      sku: 'SMOKE-LCD',
      category: 'Display',
      quality: 'Compatible',
      purchasePrice: 1000,
      sellingPrice: 1500,
      quantity: 2,
      minStock: 1,
    },
  })
  check(part.status === 201, `part create returns 201 (got ${part.status})`)
  check((tabs.get('Spare Parts')?.rows ?? []).length === 1, 'part is stored before the response')
  const overview = await request('/api/analytics/overview', { cookie })
  check(overview.status === 200, 'owner overview returns 200')
  check(overview.json.kpis?.outstanding === 0, 'outstanding is zero with no quotations')
  check(Boolean(overview.json.monthlyComparison?.current), 'monthly comparison is included')
  const historical = await request('/api/analytics/overview?month=2026-01', { cookie })
  check(historical.status === 200, 'owner can request a historical month')
  check(
    historical.json.monthlyComparison?.current?.month === '2026-01' &&
      historical.json.monthlyComparison?.previous?.month === '2025-12',
    'historical month comparison follows the selected month',
  )

  console.log('\n[api] backup writes an audit entry')
  const backup = await request('/api/settings/backup', { method: 'POST', cookie })
  check(
    (backup.status === 200 || backup.status === 201) && Boolean(backup.json.backup?.fileId),
    'backup returns a Drive file id',
  )
  check((tabs.get('Audit Log')?.rows ?? []).some((row) => row['Action']?.toString().includes('BACKUP')), 'audit entry stored')

  console.log('\n[api] a rejected write is never reported as success')
  const before = (tabs.get('Customers')?.rows ?? []).length
  gateway.setFailWrites(true)
  const rejected = await request('/api/customers', {
    method: 'POST',
    cookie,
    body: { name: 'Must Not Persist', phone: PHONE_FAIL },
  })
  gateway.setFailWrites(false)
  check(rejected.status === 502, `write failure returns 502 (got ${rejected.status})`)
  check(rejected.json.code === 'GATEWAY_ERROR', 'the failure code is reported')
  const after = (tabs.get('Customers')?.rows ?? []).length
  check(after === before, 'no row was stored for the rejected request')
  check(
    !(tabs.get('Customers')?.rows ?? []).some(
      (row) => cellText(row['Phone']) === PHONE_FAIL.replace(/\D/g, ''),
    ),
    'the rejected phone is absent',
  )

  console.log('\n[api] transient gateway failures are retried without duplicates')
  const rowsBeforeRetry = (tabs.get('Customers')?.rows ?? []).length
  gateway.failNextWrites(1, 'before')
  const retried = await request('/api/customers', {
    method: 'POST',
    cookie,
    body: { name: 'Retried Customer', phone: PHONE_RETRY },
  })
  check(retried.status === 201, `retry after a rejected attempt succeeds (got ${retried.status})`)
  check(
    (tabs.get('Customers')?.rows ?? []).filter(
      (row) => cellText(row['Phone']) === PHONE_RETRY.replace(/\D/g, ''),
    ).length === 1,
    'the retried save stored exactly one row',
  )

  gateway.failNextWrites(1, 'after')
  const replayed = await request('/api/customers', {
    method: 'POST',
    cookie,
    body: { name: 'Lost Response Customer', phone: PHONE_LOST },
  })
  check(replayed.status === 201, `a lost response is retried successfully (got ${replayed.status})`)
  check(
    (tabs.get('Customers')?.rows ?? []).filter(
      (row) => cellText(row['Phone']) === PHONE_LOST.replace(/\D/g, ''),
    ).length === 1,
    'the replayed request did not duplicate the row',
  )
  check(
    (tabs.get('Customers')?.rows ?? []).length === rowsBeforeRetry + 2,
    'only the two retried customers were added',
  )

  console.log('\n[api] duplicate submission is rejected, not stored twice')
  const duplicateBody = { name: 'Duplicate Click', phone: '+919866667777' }
  const [firstSave, secondSave] = await Promise.all([
    request('/api/customers', { method: 'POST', cookie, body: duplicateBody }),
    request('/api/customers', { method: 'POST', cookie, body: duplicateBody }),
  ])
  const saved = [firstSave.status, secondSave.status].filter((status) => status === 201).length
  const conflicts = [firstSave.status, secondSave.status].filter((status) => status === 409).length
  check(saved === 1 && conflicts === 1, `one save wins and one is rejected (${firstSave.status}/${secondSave.status})`)
  check(
    (tabs.get('Customers')?.rows ?? []).filter(
      (row) => cellText(row['Phone']) === '919866667777',
    ).length === 1,
    'the double click stored a single customer row',
  )

  console.log('\n[api] duplicate repair submission creates one repair')
  const repairBody = {
    customerId: created.json.customer.id,
    device: { category: 'Smartphone', brand: 'Smoke', model: 'Double Click' },
    problem: 'Duplicate submission smoke test',
    priority: 'NORMAL',
    clientRequestId: 'api-smoke-repair-key-0001',
  }
  const repairFirst = await request('/api/repairs', { method: 'POST', cookie, body: repairBody })
  check(repairFirst.status === 201, `first repair save returns 201 (got ${repairFirst.status})`)
  const repairSecond = await request('/api/repairs', { method: 'POST', cookie, body: repairBody })
  check(repairSecond.status === 200, `repeat save returns the same repair (got ${repairSecond.status})`)
  check(
    repairSecond.json.repair?.id === repairFirst.json.repair?.id,
    'the repeated save returned the original repair ID',
  )
  const monthlyTab = tabs.get(fakeMonthTab(fakeMonthKeyNow(), ''))
  const storedRepairs = (monthlyTab?.rows ?? []).filter(
    (row) => String(row['Repair ID']) === repairFirst.json.repair?.id,
  )
  check(storedRepairs.length === 1, 'only one repair row was stored')
  check(
    (tabs.get('Devices')?.rows ?? []).filter(
      (row) => String(row['Device ID']) === storedRepairs[0]?.['Device ID'],
    ).length === 1,
    'only one device row was stored',
  )

  console.log('\n[api] technician portal is limited to technician data')
  const techLogin = await request('/api/auth/login', {
    method: 'POST',
    body: { identifier: 'SMOKETECH', password: PASSWORD, portal: 'TECHNICIAN' },
  })
  check(techLogin.status === 200, `technician login returns 200 (got ${techLogin.status})`)
  const techCookie = cookieFrom(techLogin.response)
  check(Boolean(techCookie), 'technician receives a session cookie')
  const techMe = await request('/api/auth/me', { cookie: techCookie })
  check(techMe.json.user?.role === 'TECHNICIAN', 'technician session reports the technician role')

  const ownerOnly = [
    ['GET', '/api/analytics/overview'],
    ['GET', '/api/settings'],
    ['GET', '/api/settings/audit'],
    ['POST', '/api/settings/backup'],
    ['GET', '/api/settings/expenses'],
  ] as const
  for (const [method, path] of ownerOnly) {
    const denied = await request(path, { method, cookie: techCookie })
    check(denied.status === 403, `${method} ${path} is blocked for a technician (got ${denied.status})`)
  }
  const techPart = await request('/api/parts', {
    method: 'POST',
    cookie: techCookie,
    body: {
      name: 'Technician Part',
      sku: 'TECH-BLOCKED',
      category: 'Display',
      quality: 'Compatible',
      purchasePrice: 10,
      sellingPrice: 20,
      quantity: 1,
      minStock: 1,
    },
  })
  check(techPart.status === 403, `technician cannot create parts (got ${techPart.status})`)
  check(
    !(tabs.get('Spare Parts')?.rows ?? []).some((row) => cellText(row['SKU']) === 'TECH-BLOCKED'),
    'the blocked part was not stored',
  )
  const techCustomers = await request('/api/customers', { cookie: techCookie })
  check(techCustomers.status === 200, 'technician customer list loads')
  check(
    Array.isArray(techCustomers.json.items) && techCustomers.json.items.length === 0,
    'technician sees no customers without assigned repairs',
  )

  const techParts = await request('/api/parts', { cookie: techCookie })
  check(techParts.status === 200, 'technician can read the spare-parts list')
  check(
    Array.isArray(techParts.json.items) &&
      techParts.json.items.length > 0 &&
      techParts.json.items.every((row: Record<string, unknown>) => !('purchasePrice' in row)),
    'technician parts list omits the owner-only purchase cost',
  )
  const techCatalog = await request('/api/parts/catalog', { cookie: techCookie })
  check(techCatalog.status === 200, 'technician can read the parts catalog')
  check(
    Array.isArray(techCatalog.json.items) &&
      techCatalog.json.items.every((row: Record<string, unknown>) => !('purchasePrice' in row)),
    'technician parts catalog omits the owner-only purchase cost',
  )
  const ownerParts = await request('/api/parts', { cookie })
  check(
    Array.isArray(ownerParts.json.items) &&
      ownerParts.json.items.every((row: Record<string, unknown>) => 'purchasePrice' in row),
    'owner parts list still includes the purchase cost',
  )

  const techId = techMe.json.user?.technicianId
  check(Boolean(techId), 'technician session exposes its technician id')
  if (techId) {
    const techPerf = await request(`/api/technicians/${techId}/performance`, { cookie: techCookie })
    check(techPerf.status === 200, 'technician can read their own performance')
    check(
      techPerf.json.summary &&
        !('revenue' in techPerf.json.summary) &&
        !('partsCost' in techPerf.json.summary) &&
        !('grossProfit' in techPerf.json.summary),
      'technician performance omits shop revenue, cost and profit',
    )
    const ownerPerf = await request(`/api/technicians/${techId}/performance`, { cookie })
    check(
      ownerPerf.status === 200 && 'revenue' in ownerPerf.json.summary,
      'owner performance still includes financial figures',
    )
  }

  console.log('\n[api] logout deletes the session')
  const logout = await request('/api/auth/logout', { method: 'POST', cookie })
  check(logout.status === 200, 'logout returns 200')
  check(
    !(tabs.get('Sessions')?.rows ?? []).some((row) => cellText(row['Session ID']) === storedId),
    'the owner session row is removed before the response',
  )
  const afterLogout = await request('/api/auth/me', { cookie })
  check(afterLogout.status === 200 && afterLogout.json.user === null, 'the old cookie no longer authenticates')

  const techLogout = await request('/api/auth/logout', { method: 'POST', cookie: techCookie })
  check(techLogout.status === 200, 'technician logout returns 200')
  check(
    !(tabs.get('Sessions')?.rows ?? []).some((row) => cellText(row['User Record ID']) === 'smoke-tech-user'),
    'the technician session row is removed before the response',
  )

  await gateway.close()
  await db.$disconnect()
  console.log(failed ? `\n[api] ${failed} check(s) failed` : '\n[api] all checks passed')
  // The app server and its timers keep the process alive; the smoke test is done.
  process.exit(failed ? 1 : 0)
}

function gatewayUrlId() {
  return '1QILuEi6NIlaBb3tYWqJ5EsRF3_MksxnN_eembEIuOYU'
}

main().catch((err) => {
  console.error('[api] crashed', err)
  process.exitCode = 1
  process.exit(1)
})
