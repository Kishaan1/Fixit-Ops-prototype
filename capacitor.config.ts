import type { CapacitorConfig } from '@capacitor/cli'

/**
 * Native shell configuration for the FIXIT AI Android app.
 *
 * The Android app is a thin native wrapper around the deployed FIXIT AI web app,
 * so every feature (login, Owner/Technician portals, Google Sheets sync, Drive
 * image uploads, QR reports) behaves exactly like the browser version — same
 * origin, same cookie session, no duplicated logic or database.
 *
 * CAP_SERVER_URL is the single build setting that points the app at the
 * production backend. It is read when `npx cap sync android` runs, locally and
 * in GitHub Actions, and must be the https:// origin of the production
 * deployment. The release workflow refuses to build without it.
 */
const serverUrl = process.env.CAP_SERVER_URL?.trim()

if (serverUrl && !serverUrl.startsWith('https://')) {
  throw new Error('CAP_SERVER_URL must be an https:// production URL.')
}

if (
  serverUrl &&
  /^https:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/i.test(serverUrl)
) {
  throw new Error('CAP_SERVER_URL must not point at a local/development address.')
}

if (!serverUrl) {
  console.warn(
    '[capacitor] CAP_SERVER_URL is not set — the Android app will load the bundled UI ' +
      'instead of the production server. Set it before building a release APK.',
  )
}

const config: CapacitorConfig = {
  appId: 'com.fixitai.app',
  appName: 'FIXIT AI',
  webDir: 'dist/client',
  // Remote-URL shell: the WebView loads the deployed FIXIT AI site directly.
  // offline.html (bundled) is shown automatically when the server is unreachable.
  ...(serverUrl ? { server: { url: serverUrl, errorPath: 'offline.html' } } : {}),
}

export default config
