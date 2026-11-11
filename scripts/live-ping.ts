// POST-through-302 check against the REAL Apps Script /exec URL.
// Uses the same transport as the server (server/sheets/gateway.ts), so a
// success here means every server write will reach doPost correctly.
import 'dotenv/config'
import { SheetsGateway } from '../server/sheets/gateway'

const url = process.env.SHEETS_GATEWAY_URL || ''
const secret = process.env.SHEETS_GATEWAY_SECRET || ''

async function main() {
  if (!url || !secret) {
    console.error('[live-ping] SHEETS_GATEWAY_URL / SHEETS_GATEWAY_SECRET missing from .env')
    process.exit(1)
  }
  console.log('[live-ping] POSTing ping through the real /exec URL + 302 redirect')
  const gateway = new SheetsGateway(url, secret)
  const ping = await gateway.ping()
  console.log('[live-ping] spreadsheet :', ping.spreadsheetName, `(${ping.spreadsheetId})`)
  console.log('[live-ping] timezone    :', ping.timezone)
  console.log('[live-ping] now (IST)   :', ping.now)
  console.log('[live-ping] tabs        :', ping.tabs.join(', '))
  console.log('[live-ping] PASS — the POST transport works end to end')
}

main().catch((err) => {
  console.error('[live-ping] FAIL —', err instanceof Error ? `${err.message} (${err.name})` : err)
  process.exit(1)
})
