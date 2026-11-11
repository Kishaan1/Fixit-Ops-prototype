/**
 * Live Google Sheets acceptance test — REAL reads and writes.
 *
 * Usage:
 *   1. Deploy server/sheets/appsscript/Code.gs as a Web App (Execute as: Me,
 *      access: Anyone) and set GATEWAY_SECRET inside it.
 *   2. Add SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET to .env.
 *   3. Run: npm run test:sheets
 *
 * The script refuses to run when the gateway is not configured, because a
 * SQLite-only check would not prove that the spreadsheet works. It creates
 * records with a unique "SHEETS-TEST" prefix, verifies each one by reading it
 * back through the gateway, and deletes everything it created at the end.
 */
import { prisma } from '../server/db'
import { monthKey, monthKeyMonthsAgo } from '../server/lib/dates'
import { publishReport, getPublicReport } from '../server/lib/report'
import type { GatewayTable } from '../server/sheets/gateway'
import { monthTabName } from '../server/sheets/schema'
import {
  ensureSheetsSchema,
  gateway,
  invalidateSheetsCache,
  runWithSheetsWrite,
  sheetsConfigured,
} from '../server/sheets/runtime'

const EXPECTED_SPREADSHEET_ID = '1QILuEi6NIlaBb3tYWqJ5EsRF3_MksxnN_eembEIuOYU'
const RUN = Date.now().toString(36).toUpperCase()
const PHONE_A = `90000${String(Date.now()).slice(-5)}`
const PHONE_B = `91000${String(Date.now()).slice(-5)}`
const PHONE_C = `92000${String(Date.now()).slice(-5)}`
const REPAIR_CODE = `SHEETS-TEST-${RUN}`
const SKU = `SHEETS-TEST-${RUN}`
const TINY_PNG =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg=='

const ids: Record<string, string> = {}
let failures = 0
let passes = 0
let skips = 0

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

function id(label: string) {
  const value = `sheets-test-${RUN}-${label}`
  ids[label] = value
  return value
}

function shiftMonth(key: string, delta: number) {
  const [year, month] = key.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1 + delta, 1))
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`
}

async function step(name: string, fn: () => Promise<string | void>) {
  process.stdout.write(`\n[test] ${name}\n`)
  invalidateSheetsCache()
  try {
    const note = await fn()
    passes += 1
    console.log(`  PASS${note ? ` — ${note}` : ''}`)
  } catch (err) {
    failures += 1
    console.error(`  FAIL — ${err instanceof Error ? err.message : String(err)}`)
  }
}

async function readMonthly(suffix: string) {
  const table: GatewayTable = { key: `live-${suffix}`, kind: 'monthly', suffix }
  const response = await gateway.readTables([table])
  return response.tables[table.key] ?? []
}

async function cleanup() {
  invalidateSheetsCache()
  try {
    await runWithSheetsWrite(async () => {
      const repairs = await prisma.repair.findMany({
        where: { code: { startsWith: REPAIR_CODE } },
      })
      for (const repair of repairs) await prisma.repair.delete({ where: { id: repair.id } })
      const devices = await prisma.device.findMany({ where: { id: ids.device } })
      for (const device of devices) await prisma.device.delete({ where: { id: device.id } })
      const customers = await prisma.customer.findMany({
        where: { id: { in: [ids.customerA, ids.customerB, ids.customerC, ids.upsertCustomer] } },
      })
      for (const customer of customers) await prisma.customer.delete({ where: { id: customer.id } })
      const parts = await prisma.sparePart.findMany({ where: { id: ids.part } })
      for (const part of parts) await prisma.sparePart.delete({ where: { id: part.id } })
    })
  } catch (err) {
    console.warn(`[test] cleanup warning: ${err instanceof Error ? err.message : String(err)}`)
  }

  invalidateSheetsCache()
  for (const model of ['repair', 'device', 'customer', 'sparePart'] as const) {
    const delegate = (prisma as any)[model]
    const value = ids[model === 'repair' ? 'repair' : model === 'sparePart' ? 'part' : model === 'customer' ? 'customerA' : 'device']
    if (!value) continue
    const found = await delegate.findFirst({ where: { id: value } })
    if (found) console.warn(`[test] cleanup warning: ${model} ${value} is still in the spreadsheet`)
  }
}

async function main() {
  if (!sheetsConfigured()) {
    console.error(
      '[test] Google Sheets is not configured, so no real spreadsheet write can be tested.\n' +
        '[test] Deploy server/sheets/appsscript/Code.gs and set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET.',
    )
    process.exit(1)
  }

  console.log('[test] Google Sheets live acceptance test')
  console.log('[test] No SQLite or mock data is used — every check reads the real spreadsheet.')

  await step('1. Gateway health, spreadsheet identity and IST timezone', async () => {
    const ping = await gateway.ping()
    assert(
      ping.spreadsheetId === EXPECTED_SPREADSHEET_ID,
      `The gateway points at spreadsheet ${ping.spreadsheetId}, not ${EXPECTED_SPREADSHEET_ID}.`,
    )
    // "Asia/Calcutta" is Google's name for the same IST zone as Asia/Kolkata.
    assert(
      ping.timezone === 'Asia/Kolkata' || ping.timezone === 'Asia/Calcutta',
      `Spreadsheet timezone is ${ping.timezone}, expected Asia/Kolkata (IST).`,
    )
    return `${ping.spreadsheetName} · ${ping.timezone} (IST)`
  })

  await step('2. Automatic schema and monthly worksheets', async () => {
    await ensureSheetsSchema()
    const ping = await gateway.ping()
    const month = monthKey(new Date())
    const required = ['', 'Parts', 'Payments', 'Activity'].map((suffix) => monthTabName(month, suffix))
    for (const tab of required) assert(ping.tabs.includes(tab), `Missing automatically-created tab: ${tab}`)
    for (const tab of ['Customers', 'Users', 'Technicians', 'Spare Parts', 'Settings', 'Audit Log']) {
      assert(ping.tabs.includes(tab), `Missing master tab: ${tab}`)
    }
    return required.join(', ')
  })

  await step('3. Customer create is read back from the spreadsheet', async () => {
    const customer = await runWithSheetsWrite(() =>
      prisma.customer.create({
        data: { id: id('customerA'), name: 'Sheets Test Customer', phone: PHONE_A },
      }),
    )
    invalidateSheetsCache()
    const stored = await prisma.customer.findUnique({ where: { id: customer.id } })
    assert(stored, 'The customer could not be read back from Google Sheets.')
    assert(stored?.phone === PHONE_A, `Stored phone is ${stored?.phone}, expected ${PHONE_A}.`)
    return `id ${customer.id}`
  })

  await step('4. Concurrent duplicate phone is blocked (one row only)', async () => {
    const attempt = (label: string) =>
      runWithSheetsWrite(() =>
        prisma.customer.create({
          data: { id: id(label), name: `Concurrent ${label}`, phone: PHONE_B },
        }),
      )
    const results = await Promise.allSettled([attempt('customerB'), attempt('customerC')])
    const fulfilled = results.filter((r) => r.status === 'fulfilled').length
    assert(fulfilled === 1, `Expected exactly one save to win, but ${fulfilled} succeeded.`)
    invalidateSheetsCache()
    const rows = await prisma.customer.findMany({ where: { phone: PHONE_B } })
    assert(rows.length === 1, `Expected one row for the duplicate phone, found ${rows.length}.`)
    ids.customerB = rows[0]?.id ?? ''
    return 'second save rejected by the script lock'
  })

  await step('5. Upsert by natural key is idempotent (same ID, no duplicate)', async () => {
    const first = await runWithSheetsWrite(() =>
      prisma.customer.upsert({
        where: { phone: PHONE_C },
        create: { id: id('upsertCustomer'), name: 'Upsert First', phone: PHONE_C },
        update: { name: 'Upsert First' },
      }),
    )
    await runWithSheetsWrite(() =>
      prisma.customer.upsert({
        where: { phone: PHONE_C },
        create: { name: 'Upsert Second', phone: PHONE_C },
        update: { name: 'Upsert Second' },
      }),
    )
    invalidateSheetsCache()
    const rows = await prisma.customer.findMany({ where: { phone: PHONE_C } })
    assert(rows.length === 1, `Expected one row after two upserts, found ${rows.length}.`)
    assert(rows[0].id === first.id, 'The upsert changed the stable customer ID.')
    assert(rows[0].name === 'Upsert Second', `The upsert did not update the row (name ${rows[0].name}).`)
    return `stable id ${first.id}`
  })

  await step('6. Device and repair create, then update by ID without duplication', async () => {
    const customer = await prisma.customer.findUnique({ where: { id: ids.customerA } })
    assert(customer, 'Test customer disappeared before the repair test.')
    const device = await runWithSheetsWrite(() =>
      prisma.device.create({
        data: {
          id: id('device'),
          customerId: customer!.id,
          category: 'Smartphone',
          brand: 'SheetsTest',
          model: 'LiveRunner',
        },
      }),
    )
    const repair = await runWithSheetsWrite(() =>
      prisma.repair.create({
        data: {
          id: id('repair'),
          code: REPAIR_CODE,
          customerId: customer!.id,
          deviceId: device.id,
          status: 'NEW_REQUEST',
          priority: 'NORMAL',
          problem: 'Live spreadsheet acceptance test',
          warrantyDays: 30,
        },
      }),
    )
    await runWithSheetsWrite(() =>
      prisma.repair.update({
        where: { id: repair.id },
        data: { status: 'REPAIR_IN_PROGRESS', confirmedFault: 'Test fault' },
      }),
    )
    invalidateSheetsCache()
    const rows = await prisma.repair.findMany({ where: { code: REPAIR_CODE } })
    assert(rows.length === 1, `Expected one repair row, found ${rows.length}.`)
    assert(rows[0].id === repair.id, 'Updating the repair changed its ID.')
    assert(rows[0].confirmedFault === 'Test fault', 'The repair update was not stored.')
    return `repair ${repair.code}`
  })

  await step('7. Inventory stock and movement are stored in the monthly Parts tab', async () => {
    const part = await runWithSheetsWrite(() =>
      prisma.sparePart.create({
        data: {
          id: id('part'),
          sku: SKU,
          name: 'Sheets Test Part',
          category: 'Testing',
          quantity: 5,
          minStock: 1,
          purchasePrice: 100,
          sellingPrice: 150,
        },
      }),
    )
    await runWithSheetsWrite(async () => {
      await prisma.sparePart.update({ where: { id: part.id }, data: { quantity: 3 } })
      await prisma.inventoryTransaction.create({
        data: {
          id: id('inventory'),
          partId: part.id,
          type: 'OUT',
          quantity: -2,
          unitCost: 100,
          note: 'Live test stock movement',
        },
      })
    })
    invalidateSheetsCache()
    const stored = await prisma.sparePart.findUnique({ where: { id: part.id } })
    assert(stored?.quantity === 3, `Stored stock is ${stored?.quantity}, expected 3.`)
    const movements = await readMonthly('Parts')
    const movement = movements.find((row) => row['Inventory ID'] === ids.inventory)
    assert(movement, 'The inventory movement is missing from the Parts tab.')
    assert(
      movement!.__month === monthKey(new Date()),
      `Movement landed in ${movement!.__month}, expected ${monthKey(new Date())}.`,
    )
    return `stock 3 · ${movement!.__tab}`
  })

  await step('8. Quotation and payment land in the monthly Payments tab; outstanding is correct', async () => {
    await runWithSheetsWrite(async () => {
      await prisma.quotation.create({
        data: {
          id: id('quotation'),
          repairId: ids.repair,
          version: 1,
          status: 'APPROVED',
          customerTotal: 1000,
          partsTotal: 400,
          labourCharge: 600,
        },
      })
      await prisma.payment.create({
        data: {
          id: id('payment'),
          repairId: ids.repair,
          amount: 400,
          method: 'UPI',
          reference: `TEST-${RUN}`,
          paidAt: new Date(),
        },
      })
    })
    invalidateSheetsCache()
    const repair = await prisma.repair.findUnique({
      where: { id: ids.repair },
      include: { payments: true, quotations: { orderBy: { version: 'desc' }, take: 1 } },
    })
    assert(repair, 'The repair could not be read back for the payment check.')
    const quoted = repair!.quotations[0]?.customerTotal ?? 0
    const paid = repair!.payments.reduce((sum, p) => sum + p.amount, 0)
    assert(quoted === 1000, `Quoted total is ${quoted}, expected 1000.`)
    assert(paid === 400, `Paid total is ${paid}, expected 400.`)
    assert(quoted - paid === 600, 'Outstanding amount is not quoted minus paid.')
    const payments = await readMonthly('Payments')
    const payment = payments.find((row) => row['Payment ID'] === ids.payment)
    assert(payment, 'The payment is missing from the monthly Payments tab.')
    assert(payment!.__month === monthKey(new Date()), `Payment landed in ${payment!.__month}.`)
    return `${payment!.__tab} · outstanding 600`
  })

  await step('9. Activity trail is stored, and a Drive image round-trips', async () => {
    await runWithSheetsWrite(() =>
      prisma.repairActivity.create({
        data: {
          id: id('activity'),
          repairId: ids.repair,
          type: 'NOTE',
          note: 'Live test activity',
        },
      }),
    )
    invalidateSheetsCache()
    const activities = await readMonthly('Activity')
    const activity = activities.find((row) => row['Activity ID'] === ids.activity)
    assert(activity, 'The repair activity is missing from the Activity tab.')
    assert(activity!.__month === monthKey(new Date()), `Activity landed in ${activity!.__month}.`)

    const image = await gateway.uploadImage({
      base64: TINY_PNG,
      mimeType: 'image/png',
      filename: `${SKU}.png`,
      monthKey: monthKey(new Date()),
    })
    assert(image.fileId, 'Drive did not return a file ID.')
    const fetched = await gateway.getImage(image.fileId)
    assert(fetched.base64 === TINY_PNG, 'The image read back from Drive does not match the upload.')
    return `activity + Drive file ${image.fileId}`
  })

  await step('10. Previous-month rows stay in their own tab, QR report publishes, backup is created', async () => {
    const previous = monthKeyMonthsAgo(1)
    const previousDate = new Date(`${previous}-05T12:00:00.000+05:30`)
    await runWithSheetsWrite(() =>
      prisma.payment.create({
        data: {
          id: id('previousPayment'),
          repairId: ids.repair,
          amount: 100,
          method: 'CASH',
          paidAt: previousDate,
          notes: 'Previous-month preservation test',
        },
      }),
    )
    invalidateSheetsCache()
    const payments = await readMonthly('Payments')
    const previousPayment = payments.find((row) => row['Payment ID'] === ids.previousPayment)
    assert(previousPayment, 'The previous-month payment could not be read back.')
    assert(
      previousPayment!.__month === previous,
      `Previous-month payment landed in ${previousPayment!.__month}, expected ${previous}.`,
    )
    const current = payments.find((row) => row['Payment ID'] === ids.payment)
    assert(current && current.__month === monthKey(new Date()), 'The current-month tab changed unexpectedly.')

    await runWithSheetsWrite(async () => {
      await prisma.repair.update({
        where: { id: ids.repair },
        data: { status: 'COMPLETED', completedAt: new Date() },
      })
    })
    const report = await runWithSheetsWrite(() => publishReport(ids.repair))
    invalidateSheetsCache()
    const publicReport = await getPublicReport(report.token)
    assert(publicReport, 'The published QR report could not be read with its token.')
    assert(publicReport!.snapshot.repair.code === REPAIR_CODE, 'The public report has the wrong repair.')

    const backup = await gateway.backup()
    assert(backup.fileId, 'The backup did not return a Drive file ID.')
    return `${previousPayment!.__tab} preserved · report + backup ${backup.fileId}`
  })

  await step('11. New month tabs are created automatically and older months stay intact', async () => {
    const currentMonth = monthKey(new Date())
    const next = shiftMonth(currentMonth, 1)
    const previousMonth = monthKeyMonthsAgo(1)
    const previousTab = monthTabName(previousMonth, 'Payments')
    const beforeCurrent = (await readMonthly('')).filter((row) => row.__month === currentMonth).length
    const beforePayments = await readMonthly('Payments')
    const beforePrevious = beforePayments.filter((row) => row.__tab === previousTab).length

    const nextRepair = await runWithSheetsWrite(() =>
      prisma.repair.create({
        data: {
          id: id('nextRepair'),
          code: `${REPAIR_CODE}-NEXT`,
          customerId: ids.customerA,
          deviceId: ids.device,
          problem: 'Next month rollover',
          status: 'NEW_REQUEST',
          createdAt: new Date(`${next}-02T00:30:00+05:30`),
        },
      }),
    )
    await runWithSheetsWrite(() =>
      prisma.payment.create({
        data: {
          id: id('nextPayment'),
          repairId: nextRepair.id,
          amount: 10,
          method: 'CASH',
          paidAt: new Date(`${next}-03T10:00:00+05:30`),
        },
      }),
    )
    invalidateSheetsCache()

    const ping = await gateway.ping()
    for (const suffix of ['', 'Parts', 'Payments', 'Activity']) {
      const name = monthTabName(next, suffix)
      assert(ping.tabs.includes(name), `The new month tab "${name}" was not created automatically.`)
    }
    const repairRows = (await readMonthly('')).filter((row) => row['Repair ID'] === nextRepair.id)
    assert(repairRows.length === 1, `Expected one new-month repair row, found ${repairRows.length}.`)
    assert(
      repairRows[0].__month === next,
      `The rollover repair landed in ${repairRows[0].__month}, expected ${next}.`,
    )
    const paymentRows = (await readMonthly('Payments')).filter(
      (row) => row['Payment ID'] === ids.nextPayment,
    )
    assert(paymentRows.length === 1, 'The new-month payment is missing.')
    assert(paymentRows[0].__month === next, `The rollover payment landed in ${paymentRows[0].__month}.`)

    const afterCurrent = (await readMonthly('')).filter((row) => row.__month === currentMonth).length
    assert(afterCurrent === beforeCurrent, `The current month changed (${beforeCurrent} -> ${afterCurrent}).`)
    const afterPayments = await readMonthly('Payments')
    const afterPrevious = afterPayments.filter((row) => row.__tab === previousTab).length
    assert(afterPrevious === beforePrevious, `The previous month changed (${beforePrevious} -> ${afterPrevious}).`)

    await runWithSheetsWrite(() =>
      prisma.repair.update({
        where: { id: nextRepair.id },
        data: { problem: 'Next month rollover updated' },
      }),
    )
    invalidateSheetsCache()
    const updated = (await readMonthly('')).filter((row) => row['Repair ID'] === nextRepair.id)
    assert(updated.length === 1, `Updating the rollover repair duplicated it (${updated.length} rows).`)
    assert(updated[0].__month === next, 'The updated rollover repair moved to another month.')
    return `${monthTabName(next, '')} created automatically`
  })

  await cleanup()

  console.log(`\n[test] ${passes} passed, ${failures} failed, ${skips} skipped`)
  if (failures > 0) {
    console.error('[test] The spreadsheet is NOT verified. Do not treat this run as complete.')
    process.exitCode = 1
  } else {
    console.log('[test] All live Google Sheets checks passed against the real spreadsheet.')
  }
}

main()
  .catch((err) => {
    console.error('[test] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
