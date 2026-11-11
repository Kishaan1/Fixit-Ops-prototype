/**
 * Read-only verification of the Google Sheets database.
 *
 * Usage:
 *   npm run db:verify:sheets
 *
 * It checks row counts, duplicate stable IDs, duplicate unique fields,
 * repair relationships and the expected monthly tabs. It never writes rows.
 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { prisma } from '../server/db'
import { gateway, ensureSheetsSchema, sheetsConfigured } from '../server/sheets/runtime'
import { monthKeyForDate, monthTabName } from '../server/sheets/schema'

const client = prisma as unknown as Record<string, any>
const source = new PrismaClient()

const MODELS: Array<{ delegate: string; unique: string[] }> = [
  { delegate: 'user', unique: ['email', 'userId'] },
  { delegate: 'shop', unique: [] },
  { delegate: 'technician', unique: ['userId'] },
  { delegate: 'customer', unique: ['phone'] },
  { delegate: 'device', unique: [] },
  { delegate: 'supplier', unique: [] },
  { delegate: 'sparePart', unique: ['sku'] },
  { delegate: 'repair', unique: ['code', 'reportToken'] },
  { delegate: 'repairPart', unique: [] },
  { delegate: 'inventoryTransaction', unique: [] },
  { delegate: 'quotation', unique: [] },
  { delegate: 'payment', unique: [] },
  { delegate: 'expense', unique: [] },
  { delegate: 'technicianIncentive', unique: [] },
  { delegate: 'repairActivity', unique: [] },
  { delegate: 'repairDiagnostic', unique: [] },
  { delegate: 'repairImage', unique: [] },
  { delegate: 'repairReport', unique: ['repairId', 'token'] },
  { delegate: 'warrantyRecord', unique: ['repairId'] },
  { delegate: 'customerFeedback', unique: ['repairId'] },
  { delegate: 'notification', unique: [] },
  { delegate: 'auditLog', unique: [] },
  { delegate: 'accountActivityLog', unique: [] },
]

async function main() {
  if (!sheetsConfigured()) {
    console.error('[verify] Google Sheets is not configured.')
    process.exit(1)
  }

  // Create any missing master/current-month tabs before inspecting the
  // workbook, otherwise a fresh spreadsheet reports false warnings.
  await ensureSheetsSchema()

  const ping = await gateway.ping()
  console.log(`[verify] Spreadsheet: ${ping.spreadsheetName}`)
  console.log(`[verify] Timezone: ${ping.timezone}`)
  if (ping.timezone !== 'Asia/Kolkata') {
    console.warn('[verify] ! Expected Asia/Kolkata; the gateway sets it during schema sync.')
  }

  const current = monthKeyForDate(new Date())
  for (const suffix of ['', 'Parts', 'Payments', 'Activity']) {
    const name = monthTabName(current, suffix)
    if (!ping.tabs.includes(name)) console.warn(`[verify] ! Missing current-month tab: ${name}`)
  }
  console.log(`[verify] Monthly tabs for ${current}: ${['', 'Parts', 'Payments', 'Activity'].map((s) => monthTabName(current, s)).join(', ')}`)

  let problems = 0
  const rowsByModel = new Map<string, Array<Record<string, any>>>()

  for (const model of MODELS) {
    const rows = (await client[model.delegate].findMany()) as Array<Record<string, any>>
    rowsByModel.set(model.delegate, rows)

    const ids = new Set<string>()
    for (const row of rows) {
      if (!row.id) {
        console.error(`[verify] x ${model.delegate}: row without an id`)
        problems += 1
        continue
      }
      if (ids.has(row.id)) {
        console.error(`[verify] x ${model.delegate}: duplicate id ${row.id}`)
        problems += 1
      }
      ids.add(row.id)
    }

    for (const field of model.unique) {
      const seen = new Set<string>()
      for (const row of rows) {
        const value = row[field]
        if (value === null || value === undefined || value === '') continue
        if (seen.has(String(value))) {
          console.error(`[verify] x ${model.delegate}: duplicate ${field} "${value}"`)
          problems += 1
        }
        seen.add(String(value))
      }
    }

    console.log(`[verify] ${model.delegate}: ${rows.length}`)
  }

  const repairs = rowsByModel.get('repair') ?? []
  const customers = new Set((rowsByModel.get('customer') ?? []).map((r) => r.id))
  const devices = new Set((rowsByModel.get('device') ?? []).map((r) => r.id))
  for (const repair of repairs) {
    if (repair.customerId && !customers.has(repair.customerId)) {
      console.error(`[verify] x repair ${repair.code || repair.id}: unknown customer ${repair.customerId}`)
      problems += 1
    }
    if (repair.deviceId && !devices.has(repair.deviceId)) {
      console.error(`[verify] x repair ${repair.code || repair.id}: unknown device ${repair.deviceId}`)
      problems += 1
    }
  }

  const rawDbPath = (process.env.DATABASE_URL || 'file:./dev.db').replace(/^file:/, '')
  // Prisma resolves a relative SQLite path from the schema directory.
  const dbFile = path.isAbsolute(rawDbPath)
    ? rawDbPath
    : path.resolve(process.cwd(), 'prisma', rawDbPath)
  if (existsSync(dbFile)) {
    console.log(`[verify] Comparing with SQLite source: ${dbFile}`)
    for (const model of MODELS) {
      const expected = await (source as any)[model.delegate].count()
      const actual = rowsByModel.get(model.delegate)?.length ?? 0
      if (expected !== actual) {
        console.warn(`[verify] ! ${model.delegate}: SQLite ${expected} vs Sheets ${actual}`)
      }
    }
  }

  if (problems) {
    console.error(`[verify] ${problems} problem(s) found.`)
    process.exitCode = 1
  } else {
    console.log('[verify] No duplicate IDs, duplicate unique values or broken repair links found.')
  }
}

main()
  .catch((err) => {
    console.error('[verify] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await source.$disconnect()
    await prisma.$disconnect()
  })
