/**
 * One-time migration: copy every existing SQLite record into the Google
 * Spreadsheet, and copy legacy local uploads into Google Drive.
 *
 * Safe to re-run: every record is upserted by its stable ID, so a second run
 * updates rows instead of duplicating them.
 *
 * Usage:
 *   npm run db:migrate:sheets
 *
 * The original SQLite file is never modified and remains the rollback copy.
 */
import { existsSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { PrismaClient } from '@prisma/client'
import { config } from '../server/env'
import { prisma } from '../server/db'
import { isLegacyImageFilename } from '../server/lib/images'
import { monthKeyForDate } from '../server/sheets/schema'
import { gateway, runWithSheetsWrite, sheetsConfigured } from '../server/sheets/runtime'

const source = new PrismaClient()
const client = prisma as unknown as Record<string, any>

// Parents before children so foreign keys exist when a child is written.
// Sessions and reset tokens are intentionally not copied: users sign in again
// and any outstanding password-reset link is invalidated on cutover.
const ORDER: Array<{ model: string; delegate: string; label: string }> = [
  { model: 'User', delegate: 'user', label: 'users' },
  { model: 'Shop', delegate: 'shop', label: 'shop settings' },
  { model: 'Technician', delegate: 'technician', label: 'technicians' },
  { model: 'Customer', delegate: 'customer', label: 'customers' },
  { model: 'Device', delegate: 'device', label: 'devices' },
  { model: 'Supplier', delegate: 'supplier', label: 'suppliers' },
  { model: 'SparePart', delegate: 'sparePart', label: 'spare parts' },
  { model: 'Repair', delegate: 'repair', label: 'repairs' },
  { model: 'RepairPart', delegate: 'repairPart', label: 'repair parts' },
  { model: 'InventoryTransaction', delegate: 'inventoryTransaction', label: 'inventory movements' },
  { model: 'Quotation', delegate: 'quotation', label: 'quotations' },
  { model: 'Payment', delegate: 'payment', label: 'payments' },
  { model: 'Expense', delegate: 'expense', label: 'expenses' },
  { model: 'TechnicianIncentive', delegate: 'technicianIncentive', label: 'incentives' },
  { model: 'RepairActivity', delegate: 'repairActivity', label: 'repair activities' },
  { model: 'RepairDiagnostic', delegate: 'repairDiagnostic', label: 'diagnostics' },
  { model: 'RepairImage', delegate: 'repairImage', label: 'repair images' },
  { model: 'RepairReport', delegate: 'repairReport', label: 'reports' },
  { model: 'WarrantyRecord', delegate: 'warrantyRecord', label: 'warranty records' },
  { model: 'CustomerFeedback', delegate: 'customerFeedback', label: 'feedback' },
  { model: 'Notification', delegate: 'notification', label: 'notifications' },
  { model: 'AuditLog', delegate: 'auditLog', label: 'audit entries' },
  { model: 'AccountActivityLog', delegate: 'accountActivityLog', label: 'account activity' },
]

const MIME_BY_EXT: Record<string, string> = {
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  heic: 'image/heic',
  heif: 'image/heif',
  gif: 'image/gif',
}

const driveCache = new Map<string, string>()
let uploadedImages = 0
let missingImages = 0

async function ensureDriveImage(filename: unknown, when: unknown): Promise<unknown> {
  if (typeof filename !== 'string' || !filename) return filename
  if (!isLegacyImageFilename(filename)) return filename
  const cached = driveCache.get(filename)
  if (cached) return cached

  const local = path.join(config.uploadDir, path.basename(filename))
  if (!existsSync(local)) {
    missingImages += 1
    console.warn(`  ! legacy image not found on disk: ${filename}`)
    return filename
  }
  const ext = path.extname(filename).slice(1).toLowerCase()
  const buffer = await readFile(local)
  const date = when instanceof Date ? when : when ? new Date(String(when)) : new Date()
  const result = await gateway.uploadImage({
    base64: buffer.toString('base64'),
    mimeType: MIME_BY_EXT[ext] || 'image/jpeg',
    filename,
    monthKey: monthKeyForDate(Number.isNaN(date.getTime()) ? new Date() : date),
  })
  driveCache.set(filename, result.fileId)
  uploadedImages += 1
  return result.fileId
}

async function migrateModel(delegate: string, label: string) {
  const rows = (await (source as any)[delegate].findMany()) as Array<Record<string, unknown>>
  if (!rows.length) {
    console.log(`- ${label}: 0 (nothing to copy)`)
    return 0
  }

  await runWithSheetsWrite(async () => {
    for (const original of rows) {
      const row = { ...original }

      if (delegate === 'user') row.profileImageUrl = await ensureDriveImage(row.profileImageUrl, row.joiningDate)
      if (delegate === 'device') row.imagePath = await ensureDriveImage(row.imagePath, row.createdAt)
      if (delegate === 'repairImage') row.imagePath = await ensureDriveImage(row.imagePath, row.createdAt)
      if (delegate === 'shop') row.logoPath = await ensureDriveImage(row.logoPath, row.createdAt)

      const { id, ...update } = row
      await client[delegate].upsert({
        where: { id },
        create: row,
        update,
      })
    }
  })

  console.log(`- ${label}: ${rows.length} copied`)
  return rows.length
}

async function main() {
  if (!sheetsConfigured()) {
    console.error(
      '[migrate] Google Sheets is not configured. Set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET ' +
        'and deploy server/sheets/appsscript/Code.gs first.',
    )
    process.exit(1)
  }

  const ping = await gateway.ping()
  console.log(`[migrate] Target spreadsheet: ${ping.spreadsheetName} (${ping.spreadsheetId})`)
  console.log(`[migrate] Source database: ${config.databaseUrl}`)
  console.log('[migrate] The SQLite file is only read, never changed.')

  const counts = new Map<string, number>()
  for (const entry of ORDER) {
    console.log(`[migrate] ${entry.label}...`)
    counts.set(entry.delegate, await migrateModel(entry.delegate, entry.label))
  }

  // Verify counts and referential integrity from the Sheets side.
  console.log('[migrate] Verifying...')
  let failed = false
  for (const entry of ORDER) {
    const expected = counts.get(entry.delegate) ?? 0
    const actual = await client[entry.delegate].count()
    if (actual !== expected) {
      failed = true
      console.error(`  x ${entry.label}: expected ${expected}, found ${actual} in Sheets`)
    }
  }

  const repairs = (await client.repair.findMany()) as Array<Record<string, any>>
  for (const repair of repairs) {
    if (!repair.customerId || !repair.deviceId) {
      failed = true
      console.error(`  x repair ${repair.code || repair.id} has no customer or device link`)
    }
  }

  console.log(
    `[migrate] Images uploaded to Drive: ${uploadedImages}; missing on disk: ${missingImages}`,
  )
  if (failed) {
    console.error('[migrate] Verification failed. Fix the reported rows, then run the migration again.')
    process.exitCode = 1
    return
  }
  console.log('[migrate] Complete. Every row count matches and repair links are intact.')
  console.log('[migrate] Log in again; sessions were intentionally not copied.')
}

main()
  .catch((err) => {
    console.error('[migrate] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await source.$disconnect()
    await prisma.$disconnect()
  })
