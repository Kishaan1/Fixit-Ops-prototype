/**
 * Turnkey Google Sheets setup and doctor.
 *
 * Usage:
 *   npm run sheets:setup
 *
 * What it does:
 *   1. Creates .env from .env.example when it is missing.
 *   2. Generates a strong SESSION_SECRET and SHEETS_GATEWAY_SECRET if absent.
 *   3. If SHEETS_GATEWAY_URL is empty, prints the exact Apps Script deployment
 *      steps and stops. Nothing is written to Google until that URL exists.
 *   4. If the URL is present, pings the deployed Web App, refuses a gateway that
 *      points at a different spreadsheet, creates the master and current-month
 *      worksheets once, and prints the tab list.
 *
 * The running app never uses this script; it is a one-time setup helper and a
 * health check for the owner.
 */
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const SPREADSHEET_ID = '1QILuEi6NIlaBb3tYWqJ5EsRF3_MksxnN_eembEIuOYU'
const SPREADSHEET_URL = `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`
const ENV_PATH = path.resolve(process.cwd(), '.env')
const EXAMPLE_PATH = path.resolve(process.cwd(), '.env.example')

function readEnvFile(): string {
  if (existsSync(ENV_PATH)) return readFileSync(ENV_PATH, 'utf8')
  if (existsSync(EXAMPLE_PATH)) {
    const template = readFileSync(EXAMPLE_PATH, 'utf8')
    writeFileSync(ENV_PATH, template, 'utf8')
    console.log('[setup] Created .env from .env.example')
    return template
  }
  return ''
}

function getValue(source: string, key: string) {
  const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*)$`, 'm').exec(source)
  return match ? match[1].trim().replace(/^["']|["']$/g, '') : ''
}

function setValue(source: string, key: string, value: string) {
  const line = `${key}="${value}"`
  const pattern = new RegExp(`^\\s*${key}\\s*=.*$`, 'm')
  if (pattern.test(source)) return source.replace(pattern, line)
  const suffix = source.endsWith('\n') || source === '' ? '' : '\n'
  return `${source}${suffix}${line}\n`
}

function randomSecret(bytes = 32) {
  return randomBytes(bytes).toString('hex')
}

async function main() {
  let env = readEnvFile()

  if (!getValue(env, 'SESSION_SECRET') || getValue(env, 'SESSION_SECRET').includes('change-me')) {
    env = setValue(env, 'SESSION_SECRET', randomSecret(32))
    console.log('[setup] Generated SESSION_SECRET')
  }

  let gatewaySecret = getValue(env, 'SHEETS_GATEWAY_SECRET')
  if (!gatewaySecret) {
    gatewaySecret = randomSecret(32)
    env = setValue(env, 'SHEETS_GATEWAY_SECRET', gatewaySecret)
    console.log('[setup] Generated SHEETS_GATEWAY_SECRET')
  } else {
    console.log('[setup] SHEETS_GATEWAY_SECRET already set')
  }

  const gatewayUrl = getValue(env, 'SHEETS_GATEWAY_URL')
  if (!/^\s*SHEETS_GATEWAY_URL\s*=/m.test(env)) {
    env = setValue(env, 'SHEETS_GATEWAY_URL', '')
    console.log('[setup] Added an empty SHEETS_GATEWAY_URL placeholder to .env')
  }
  writeFileSync(ENV_PATH, env, 'utf8')

  console.log('')
  console.log('Spreadsheet:', SPREADSHEET_URL)
  console.log('Timezone:    Asia/Kolkata (fixed in code)')
  console.log('')

  if (!gatewayUrl) {
    console.log('Google Sheets is not connected yet. Complete this once:')
    console.log('')
    console.log(`  1. Open ${SPREADSHEET_URL}`)
    console.log('  2. Extensions → Apps Script')
    console.log('  3. Replace Code.gs with server/sheets/appsscript/Code.gs from this project')
    console.log('  4. Project Settings → Script Properties → add:')
    console.log('       GATEWAY_SECRET = the value now in .env (SHEETS_GATEWAY_SECRET)')
    console.log('       SPREADSHEET_ID = ' + SPREADSHEET_ID + '   (optional, defaults to this sheet)')
    console.log('  5. Deploy → New deployment → Web app')
    console.log('       Execute as: Me')
    console.log('       Who has access: Anyone')
    console.log('  6. Copy the /exec URL into .env as SHEETS_GATEWAY_URL')
    console.log('  7. Run: npm run sheets:setup   (creates the tabs)')
    console.log('  8. Run: npm run test:sheets    (real read/write acceptance test)')
    console.log('')
    console.log('The app will keep reporting "Google Sheets is not configured" until step 6.')
    return
  }

  // Import after .env is written so dotenv picks up the new values.
  const { gateway, ensureSheetsSchema } = await import('../server/sheets/runtime')

  console.log('[setup] Pinging the Apps Script gateway…')
  const ping = await gateway.ping()
  if (ping.spreadsheetId !== SPREADSHEET_ID) {
    console.error(
      `[setup] The gateway points at spreadsheet ${ping.spreadsheetId}, not ${SPREADSHEET_ID}.`,
    )
    console.error('[setup] Set SPREADSHEET_ID in the Apps Script Script Properties to the id above.')
    process.exitCode = 1
    return
  }

  console.log(`[setup] Connected to "${ping.spreadsheetName}" (${ping.timezone})`)
  if (ping.timezone !== 'Asia/Kolkata') {
    console.warn('[setup] ! The spreadsheet timezone is not Asia/Kolkata; the next schema sync fixes it.')
  }

  console.log('[setup] Creating any missing master and current-month worksheets…')
  const schema = await ensureSheetsSchema()
  console.log(`[setup] Master tabs: ${schema.masterTabs.join(', ')}`)
  console.log(`[setup] Month ${schema.currentMonth} tabs: ${schema.monthlyTabs.join(', ')}`)
  console.log('')
  console.log('[setup] Done. Run `npm run test:sheets` to prove real reads and writes.')
}

main().catch((err) => {
  console.error('[setup] Failed:', err instanceof Error ? err.message : err)
  console.error('[setup] Check SHEETS_GATEWAY_URL, the GATEWAY_SECRET script property, and that the')
  console.error('[setup] Web App is deployed with "Execute as: Me" and access "Anyone".')
  process.exitCode = 1
})
