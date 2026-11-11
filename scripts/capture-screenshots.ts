/**
 * Documentation screenshot harvester (local UI preview harness only).
 *
 * Boots headless Chrome against the running preview server (scripts/ui-preview-server.ts,
 * in-memory gateway — the real spreadsheet is never touched) and captures every page of
 * the Owner and Technician portals plus the public QR report into docs/screenshots/.
 *
 * Run:  npx tsx scripts/capture-screenshots.ts
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const BASE = process.env.PREVIEW_BASE_URL || 'http://localhost:4000'
const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.resolve('docs/screenshots')

// Preview-harness demo accounts (fake gateway only — never used against the real sheet).
const OWNER_ID = 'OWNER01'
const TECH_ID = 'TECH01'
const DEMO_PASS = 'Fixit@12345'
const TECH_TEMP_PASS = 'Preview#Temp9'
const TECH_NEW_PASS = 'Preview#Fresh7'

const captured: string[] = []

async function main() {
  mkdirSync(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars'],
  })

  const page = await browser.newPage()
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 })
  page.setDefaultTimeout(60_000)

  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  /** Open a route inside the authenticated shell and wait for the layout + data. */
  async function goto(url: string, settleMs = 1600) {
    await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' })
    // Sidebar present => the authed layout rendered.
    if (!url.startsWith('/r/') && !url.startsWith('/login') && !url.startsWith('/forgot')) {
      await page.waitForFunction(() => Boolean(document.querySelector('a[href="/dashboard"]')))
    }
    await sleep(settleMs)
  }

  async function shot(name: string, fullPage = true) {
    await page.screenshot({ path: path.join(OUT, `${name}.png`), fullPage })
    captured.push(`${name}.png`)
    console.log(`  [shot] ${name}.png`)
  }

  /** Click a button whose visible text starts with `label` (tab bars, modals, headers). */
  async function clickButtonByText(label: string) {
    const ok = await page.evaluate((text) => {
      const btns = Array.from(document.querySelectorAll('button'))
      const target = btns.find((b) => (b.textContent ?? '').trim().startsWith(text))
      if (!target) return false
      target.click()
      return true
    }, label)
    if (!ok) throw new Error(`Button not found: ${label}`)
    await sleep(1000)
  }

  async function login(identifier: string, password: string, portal: 'OWNER' | 'TECHNICIAN') {
    await page.goto(`${BASE}/login`, { waitUntil: 'domcontentloaded' })
    await page.waitForFunction(() => Boolean(document.querySelector('#identifier')))
    if (portal === 'TECHNICIAN') {
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button'))
        btns.find((b) => (b.textContent ?? '').includes('Technician Login'))?.click()
      })
      await page.waitForFunction(() => Boolean(document.querySelector('#identifier')) && document.body.innerText.includes('Technician Sign In'))
    }
    await page.type('#identifier', identifier)
    await page.type('#password', password)
    await page.evaluate(() => (document.querySelector('form') as HTMLFormElement).requestSubmit())
    await page.waitForFunction(() => location.pathname === '/dashboard', { timeout: 45_000 })
    await sleep(1800)
  }

  async function logout() {
    await page.evaluate(async () => {
      await fetch('/api/auth/logout', { method: 'POST', credentials: 'include' })
    })
    await sleep(600)
  }

  /** JSON GET in the browser session (cookies included). */
  async function api<T>(url: string): Promise<T> {
    return page.evaluate(async (u) => {
      const res = await fetch(u, { credentials: 'include' })
      return (await res.json()) as unknown
    }, url) as Promise<T>
  }

  // ---------------------------------------------------------------- logged-out pages
  console.log('[capture] logged-out pages')
  await goto('/login', 1800)
  await shot('login-owner', false)

  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll('button'))
    btns.find((b) => (b.textContent ?? '').includes('Technician Login'))?.click()
  })
  await sleep(1200)
  await shot('login-technician', false)

  await goto('/forgot-password', 1200)
  await shot('forgot-password', false)

  // ---------------------------------------------------------------- owner portal
  console.log('[capture] owner portal')
  await login(OWNER_ID, DEMO_PASS, 'OWNER')

  await goto('/dashboard', 2200)
  await shot('dashboard-owner')

  await goto('/repairs', 1800)
  await shot('repairs-list')

  await goto('/repairs/new', 1800)
  await shot('new-repair-wizard')

  await goto('/diagnostics', 1800)
  await shot('ai-diagnostics')

  const repairs = await api<{ items: Array<{ id: string; code: string }> }>('/api/repairs?pageSize=10')
  const repair = repairs.items.find((r) => r.code) ?? repairs.items[0]
  if (!repair) throw new Error('No demo repair found in preview data')
  console.log(`[capture] repair ${repair.code} (${repair.id})`)

  await goto(`/repairs/${repair.id}`, 1800)
  await shot('repair-detail-overview')
  for (const [tab, name] of [
    ['Diagnosis', 'repair-detail-diagnosis'],
    ['Parts', 'repair-detail-parts'],
    ['Quotation', 'repair-detail-quotation'],
    ['Payments', 'repair-detail-payments'],
    ['QR report', 'repair-detail-report'],
    ['Activity', 'repair-detail-activity'],
  ] as const) {
    await clickButtonByText(tab)
    await shot(name)
  }

  await goto('/customers', 1800)
  await shot('customers-list')

  const customers = await api<{ items: Array<{ id: string; name: string }> }>('/api/customers?pageSize=10')
  const customer = customers.items[0]
  if (!customer) throw new Error('No demo customer found in preview data')
  await goto(`/customers/${customer.id}`, 1800)
  await shot('customer-detail')

  await goto('/owner/technicians', 1800)
  await shot('technician-accounts')
  await clickButtonByText('Add New Technician')
  await shot('technician-create-modal')
  await page.keyboard.press('Escape')
  await sleep(800)

  await goto('/technicians', 1800)
  await shot('technician-profiles')

  const techs = await api<{ items?: Array<{ id: string; userId?: string; user?: { userId?: string } }> }>('/api/technicians')
  const techList = techs.items ?? []
  const techRow = techList.find((t) => t.user?.userId === TECH_ID) ?? techList.find((t) => t.userId === TECH_ID) ?? techList[0]
  if (techRow) {
    await goto(`/technicians/${techRow.id}`, 1800)
    await shot('technician-detail')
  }

  await goto('/owner/password-requests', 1800)
  await shot('password-requests')

  await goto('/parts', 1800)
  await shot('spare-parts')

  await goto('/inventory', 1800)
  await shot('inventory')

  await goto('/reports', 1800)
  await shot('qr-reports')

  // Public QR report page — uses the token the harness actually published.
  const reportsList = await api<{ items: Array<{ token: string }> }>('/api/reports')
  const published = reportsList.items.find((r) => r.token)
  if (!published) throw new Error('No published report found in preview data')
  await goto(`/r/${published.token}`, 2200)
  await shot('public-report', false)

  await goto('/analytics', 2400)
  await shot('analytics')

  await goto('/settings', 1800)
  await shot('settings-shop')
  await clickButtonByText('Expenses')
  await shot('settings-expenses')
  await clickButtonByText('Audit log')
  await shot('settings-audit')
  await clickButtonByText('Data & demo')
  await shot('settings-data')

  await goto('/profile', 1800)
  await shot('profile')

  // Owner resets TECH01's password => mandatory first-login change dialog.
  console.log('[capture] resetting preview technician password for the mandatory dialog')
  const reset = await api<{ ok?: boolean }>(`/api/technicians/${techRow!.id}/reset-password`).catch(() => ({ ok: false }))
  if (!reset.ok) {
    const res = await page.evaluate(async (id, pw) => {
      const r = await fetch(`/api/technicians/${id}/reset-password`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ temporaryPassword: pw }),
      })
      return (await r.json()) as { ok?: boolean }
    }, techRow!.id, TECH_TEMP_PASS)
    if (!res.ok) throw new Error('Password reset failed on preview harness')
  }
  await logout()

  // ---------------------------------------------------------------- technician portal
  console.log('[capture] technician portal')
  await login(TECH_ID, TECH_TEMP_PASS, 'TECHNICIAN')
  await page.waitForFunction(() => document.body.innerText.includes('Mandatory Password Update'))
  await sleep(900)
  await shot('mandatory-password-dialog', false)

  await page.type('#mand-curr', TECH_TEMP_PASS)
  await page.type('#mand-new', TECH_NEW_PASS)
  await page.type('#mand-cnew', TECH_NEW_PASS)
  await page.evaluate(() => {
    const forms = Array.from(document.querySelectorAll('form'))
    forms[forms.length - 1].requestSubmit()
  })
  await sleep(1800)

  await goto('/dashboard', 2200)
  await shot('dashboard-technician')

  await goto('/repairs', 1800)
  await shot('repairs-technician')

  await logout()
  await browser.close()

  console.log(`\n[capture] ${captured.length} screenshots written to ${OUT}`)
  for (const f of captured) console.log(`    ${f}`)
}

main().catch((err) => {
  console.error('[capture] failed:', err)
  process.exit(1)
})
