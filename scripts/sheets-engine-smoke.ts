/**
 * Fast offline check of the Google Sheets engine.
 *
 * It runs against the in-memory gateway in scripts/fake-gateway.ts, so it
 * verifies the Node side (schema, staged writes, reads, relations, cascades,
 * monthly tabs) without a Google account. It does NOT prove the real
 * spreadsheet works -- run `npm run test:sheets` for that.
 */
import { createFakeGateway, fakeMonthKeyNow, fakeMonthTab } from './fake-gateway'

const PORT = 4789
const SECRET = 'smoke-secret'
process.env.SHEETS_GATEWAY_URL = `http://127.0.0.1:${PORT}`
process.env.SHEETS_GATEWAY_SECRET = SECRET

let failed = 0
function check(condition: unknown, message: string) {
  if (!condition) {
    failed += 1
    console.error('  FAIL — ' + message)
    return
  }
  console.log('  pass — ' + message)
}

function shiftMonth(key: string, delta: number) {
  const [year, month] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

async function main() {
  const gateway = createFakeGateway({ port: PORT, secret: SECRET })
  await gateway.listen()
  const tabs = gateway.tabs

  const { prisma } = await import('../server/db')
  const db = prisma as unknown as Record<string, any>
  const { ensureSheetsSchema, invalidateSheetsCache, runWithSheetsWrite } = await import(
    '../server/sheets/runtime'
  )

  console.log('\n[smoke] schema')
  const schema = await ensureSheetsSchema()
  check(Boolean(schema), 'schema initialised')
  const month = fakeMonthKeyNow()
  check(tabs.has(fakeMonthTab(month, '')), 'main monthly tab created')
  check(tabs.has(fakeMonthTab(month, 'Payments')), 'payments tab created')
  check(tabs.has('Customers'), 'customers master tab created')
  check(tabs.get('Customers')!.headers.includes('Customer ID'), 'customer headers built')

  console.log('\n[smoke] customer create + read back')
  const customer = await runWithSheetsWrite(() =>
    db.customer.create({ data: { id: 'cust-1', name: 'Smoke Customer', phone: '+919800000001' } }),
  )
  invalidateSheetsCache()
  const storedCustomer = await db.customer.findUnique({ where: { id: 'cust-1' } })
  check(storedCustomer?.name === 'Smoke Customer', 'customer name read back')
  check(storedCustomer?.phone === '+919800000001', 'guarded phone text read back unchanged')
  check(tabs.get('Customers')!.rows.length === 1, 'one customer row stored')
  check(customer.id === 'cust-1', 'created id returned')

  console.log('\n[smoke] idempotent upsert by phone')
  const first = await runWithSheetsWrite(() =>
    db.customer.upsert({
      where: { phone: '+919800000002' },
      create: { name: 'One', phone: '+919800000002' },
      update: { name: 'One' },
    }),
  )
  await runWithSheetsWrite(() =>
    db.customer.upsert({
      where: { phone: '+919800000002' },
      create: { name: 'Two', phone: '+919800000002' },
      update: { name: 'Two' },
    }),
  )
  invalidateSheetsCache()
  const upserts = await db.customer.findMany({ where: { phone: '+919800000002' } })
  check(upserts.length === 1, 'upsert did not duplicate the row')
  check(upserts[0].id === first.id, 'upsert kept the stable ID')
  check(upserts[0].name === 'Two', 'upsert updated the row')

  console.log('\n[smoke] repair create, update and relation include')
  await runWithSheetsWrite(() =>
    db.device.create({
      data: { id: 'dev-1', customerId: 'cust-1', category: 'Smartphone', brand: 'Smoke', model: 'One' },
    }),
  )
  const repair = await runWithSheetsWrite(() =>
    db.repair.create({
      data: {
        id: 'rep-1',
        code: 'SMOKE-1',
        customerId: 'cust-1',
        deviceId: 'dev-1',
        problem: 'Smoke test',
        status: 'NEW_REQUEST',
      },
    }),
  )
  await runWithSheetsWrite(() =>
    db.repair.update({
      where: { id: repair.id },
      data: { status: 'REPAIR_IN_PROGRESS', confirmedFault: 'Fault' },
    }),
  )
  invalidateSheetsCache()
  const repairs = await db.repair.findMany({
    where: { code: 'SMOKE-1' },
    include: { customer: true, device: true },
  })
  check(repairs.length === 1, 'repair update did not duplicate')
  check(repairs[0].confirmedFault === 'Fault', 'repair update stored')
  check(repairs[0].customer?.name === 'Smoke Customer', 'customer relation resolved')

  console.log('\n[smoke] transaction rollback and cascade delete')
  const beforeParts = await db.sparePart.count()
  let rolledBack = false
  await runWithSheetsWrite(async () => {
    try {
      await db.$transaction(async (tx: any) => {
        await tx.sparePart.create({ data: { id: 'part-rollback', sku: 'ROLLBACK', name: 'Never', category: 'Test' } })
        throw new Error('rollback')
      })
    } catch {
      rolledBack = true
    }
  })
  invalidateSheetsCache()
  check(rolledBack, 'transaction error surfaced')
  check((await db.sparePart.count()) === beforeParts, 'rolled-back part was not written')

  await runWithSheetsWrite(() => db.repair.delete({ where: { id: 'rep-1' } }))
  invalidateSheetsCache()
  check((await db.repair.count({ where: { id: 'rep-1' } })) === 0, 'repair deleted')

  console.log('\n[smoke] monthly payments and previous month')
  await runWithSheetsWrite(() =>
    db.device.create({
      data: { id: 'dev-2', customerId: 'cust-1', category: 'Laptop', brand: 'Smoke', model: 'Two' },
    }),
  )
  const repair2 = await runWithSheetsWrite(() =>
    db.repair.create({
      data: {
        id: 'rep-2',
        code: 'SMOKE-2',
        customerId: 'cust-1',
        deviceId: 'dev-2',
        problem: 'Payments',
        status: 'COMPLETED',
        completedAt: new Date(),
      },
    }),
  )
  await runWithSheetsWrite(() =>
    db.payment.create({ data: { id: 'pay-1', repairId: repair2.id, amount: 500, method: 'CASH', paidAt: new Date() } }),
  )
  await runWithSheetsWrite(() =>
    db.payment.create({
      data: {
        id: 'pay-2',
        repairId: repair2.id,
        amount: 200,
        method: 'UPI',
        paidAt: new Date('2026-10-05T12:00:00+05:30'),
      },
    }),
  )
  invalidateSheetsCache()
  const payments = await db.payment.findMany({ where: { repairId: repair2.id } })
  check(payments.length === 2, 'both payments read back across monthly tabs')
  const repairWithPayments = await db.repair.findUnique({
    where: { id: repair2.id },
    include: { payments: true },
  })
  check(
    repairWithPayments.payments.reduce((sum: number, p: any) => sum + p.amount, 0) === 700,
    'payments relation totals 700',
  )

  console.log('\n[smoke] automatic new-month rollover')
  const previousMonth = shiftMonth(month, -1)
  const nextMonth = shiftMonth(month, 1)
  const currentRepairRows = tabs.get(fakeMonthTab(month, ''))!.rows.length
  const previousPaymentRows = tabs.get(fakeMonthTab(previousMonth, 'Payments'))?.rows.length ?? 0

  const nextRepair = await runWithSheetsWrite(() =>
    db.repair.create({
      data: {
        id: 'rep-next',
        code: 'SMOKE-NEXT',
        customerId: 'cust-1',
        deviceId: 'dev-2',
        problem: 'Next month rollover',
        status: 'NEW_REQUEST',
        // A save made just after midnight on the 1st is timestamped in the new
        // month, so the row must land in that month's tab.
        createdAt: new Date(`${nextMonth}-02T00:30:00+05:30`),
      },
    }),
  )
  invalidateSheetsCache()
  const suffixes = ['', 'Parts', 'Payments', 'Activity']
  check(
    suffixes.every((suffix) => tabs.has(fakeMonthTab(nextMonth, suffix))),
    'all monthly tabs were created automatically',
  )
  const nextMain = tabs.get(fakeMonthTab(nextMonth, ''))!
  check(
    nextMain.rows.some((row) => String(row['Repair ID']) === nextRepair.id),
    'the new repair landed in the new month tab',
  )
  check(
    tabs.get(fakeMonthTab(month, ''))!.rows.length === currentRepairRows,
    'the current month tab was not changed by the rollover',
  )
  check(
    (tabs.get(fakeMonthTab(previousMonth, 'Payments'))?.rows.length ?? 0) === previousPaymentRows,
    'the previous month tab was not changed by the rollover',
  )

  await runWithSheetsWrite(() =>
    db.repair.update({
      where: { id: nextRepair.id },
      data: { problem: 'Next month rollover updated' },
    }),
  )
  invalidateSheetsCache()
  const nextRows = tabs.get(fakeMonthTab(nextMonth, ''))!.rows.filter(
    (row) => String(row['Repair ID']) === nextRepair.id,
  )
  check(nextRows.length === 1, 'updating a new-month repair did not duplicate it')
  check(
    String(nextRows[0]?.['Problem'] ?? '').includes('updated'),
    'the new-month repair update was stored',
  )

  console.log('\n[smoke] image round trip')
  const { gateway: client } = await import('../server/sheets/runtime')
  const uploaded = await client.uploadImage({
    base64: 'aGVsbG8=',
    mimeType: 'image/png',
    filename: 'smoke.png',
    monthKey: month,
  })
  const fetched = await client.getImage(uploaded.fileId)
  check(fetched.base64 === 'aGVsbG8=', 'image data round-tripped')

  await gateway.close()
  await db.$disconnect()
  console.log(failed ? `\n[smoke] ${failed} check(s) failed` : '\n[smoke] all checks passed')
  if (failed) process.exitCode = 1
}

main().catch((err) => {
  console.error('[smoke] crashed', err)
  process.exitCode = 1
})
