/**
 * Production initialisation for the Google Sheets database.
 *
 * Creates ONLY the login accounts and the shop Settings row:
 *   • 1 OWNER account (login ID: OWNER)
 *   • 2 TECHNICIAN accounts (login IDs: TECH01, TECH02) + Technician master rows
 *
 * Every account receives a strong random temporary password that is printed
 * to this console exactly ONCE — it is never stored anywhere in plaintext;
 * the sheet keeps only the bcrypt-style hash. Each account must choose its
 * own new password at first login (mustChangePassword = true), enforced by
 * the app's first-login change screen.
 *
 * NO demo data is created: customers, devices, spare parts, suppliers,
 * payments and repairs stay empty so the owner can enter real records.
 *
 * Run: npm run db:seed
 */
import { randomBytes } from 'node:crypto'
import { prisma } from '../server/db'
import { hashPassword } from '../server/lib/auth'
import { runWithSheetsWrite, sheetsConfigured } from '../server/sheets/runtime'

/** Typeable alphabet without look-alikes (0/O, 1/l/I) plus safe symbols. */
const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const LOWER = 'abcdefghijkmnpqrstuvwxyz'
const DIGITS = '23456789'
const SYMBOLS = '!@#$%^&*'
const ALL = UPPER + LOWER + DIGITS + SYMBOLS

function pick(alphabet: string) {
  return alphabet[randomBytes(1)[0] % alphabet.length]
}

/** 16-character password guaranteed to satisfy the app policy (letters+number). */
function tempPassword() {
  const chars = [pick(UPPER), pick(UPPER), pick(LOWER), pick(LOWER), pick(DIGITS), pick(DIGITS), pick(SYMBOLS)]
  while (chars.length < 16) chars.push(pick(ALL))
  // Fisher–Yates shuffle with cryptographic randomness.
  for (let i = chars.length - 1; i > 0; i--) {
    const j = randomBytes(1)[0] % (i + 1)
    ;[chars[i], chars[j]] = [chars[j], chars[i]]
  }
  return chars.join('')
}

async function seed() {
  if (!sheetsConfigured()) {
    console.error(
      '[seed] Google Sheets is not configured. Set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET in .env, then retry.',
    )
    process.exitCode = 1
    return
  }

  const existing = await prisma.user.count()
  if (existing > 0) {
    console.log(`[seed] The spreadsheet already has ${existing} user account(s) — nothing to initialise.`)
    return
  }

  const accounts = [
    {
      userId: 'OWNER',
      email: 'owner@fixit.local',
      name: 'Shop Owner',
      role: 'OWNER',
      technician: false,
    },
    {
      userId: 'TECH01',
      email: 'tech1@fixit.local',
      name: 'Technician One',
      role: 'TECHNICIAN',
      technician: true,
    },
    {
      userId: 'TECH02',
      email: 'tech2@fixit.local',
      name: 'Technician Two',
      role: 'TECHNICIAN',
      technician: true,
    },
  ]

  const passwords: Record<string, string> = {}
  for (const account of accounts) passwords[account.userId] = tempPassword()

  await runWithSheetsWrite(async () => {
    // Settings master row — every value is editable later in Settings.
    await prisma.shop.upsert({ where: { id: 'shop' }, create: { id: 'shop' }, update: {} })
    console.log('[seed] Settings row ready (edit shop details in Settings after logging in).')

    for (const account of accounts) {
      const user = await prisma.user.create({
        data: {
          userId: account.userId,
          email: account.email,
          name: account.name,
          role: account.role,
          passwordHash: hashPassword(passwords[account.userId]),
          mustChangePassword: true,
        },
      })
      if (account.technician) {
        await prisma.technician.create({ data: { userId: user.id } })
      }
    }
  })

  console.log('')
  console.log('================================================================')
  console.log('  INITIAL LOGIN CREDENTIALS — shown once, copy them now')
  console.log('================================================================')
  for (const account of accounts) {
    const portal = account.role === 'OWNER' ? 'Owner portal' : 'Technician portal'
    console.log(`  ${portal}`)
    console.log(`    User ID / email : ${account.userId}  (${account.email})`)
    console.log(`    Temp password   : ${passwords[account.userId]}`)
    console.log('')
  }
  console.log('  • Every account must choose a NEW password at first login.')
  console.log('  • Passwords are stored only as hashes in the spreadsheet.')
  console.log('  • Names/emails are placeholders — edit them under Settings/Profile.')
  console.log('  • If a temporary password is lost, use the login page recovery flow.')
  console.log('================================================================')
  console.log('[seed] Done — owner and two technician accounts created in Google Sheets.')
}

seed()
  .catch((err) => {
    console.error('[seed] failed', err)
    process.exitCode = 1
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
