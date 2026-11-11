/**
 * Bakes the production server URL into the bundled offline fallback page.
 *
 * Runs after `npm run build` and before `npx cap sync android`. The offline page
 * (client/public/offline.html → dist/client/offline.html) is shown by Capacitor
 * when the remote server is unreachable; its retry button needs the absolute
 * server URL because the page itself is served from the app's local origin.
 *
 * Run:  CAP_SERVER_URL=https://your-deployment npm run build && npx tsx scripts/finalize-offline-page.ts
 */
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const PLACEHOLDER = '__CAP_SERVER_URL__'
const file = path.resolve('dist/client/offline.html')
const serverUrl = process.env.CAP_SERVER_URL?.trim()

if (!existsSync(file)) {
  throw new Error('dist/client/offline.html is missing — run `npm run build` first.')
}

if (serverUrl) {
  if (!serverUrl.startsWith('https://')) {
    throw new Error('CAP_SERVER_URL must be an https:// production URL.')
  }
  const html = readFileSync(file, 'utf8')
  if (!html.includes(PLACEHOLDER)) {
    throw new Error('offline.html no longer contains the __CAP_SERVER_URL__ placeholder.')
  }
  writeFileSync(file, html.replaceAll(PLACEHOLDER, serverUrl))
  console.log(`[offline-page] retry target set to ${serverUrl}`)
} else {
  console.warn(
    '[offline-page] CAP_SERVER_URL is not set — the retry button will only reload ' +
      'this page. Set CAP_SERVER_URL before building a release APK.',
  )
}
