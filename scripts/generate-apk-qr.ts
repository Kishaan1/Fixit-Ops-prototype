/**
 * Generates AND verifies the QR code for the latest FIXIT-AI.apk release, then
 * inserts the live download link + QR into README.md.
 *
 * Run it AFTER the private GitHub repository exists and the first release
 * (tag v1.0.0) has been published:
 *
 *   npm run android:qr -- <owner/repo>
 *
 * What it does:
 *   1. Encodes https://github.com/<owner/repo>/releases/latest/download/FIXIT-AI.apk
 *      into docs/qr/android-apk.png
 *   2. Decodes the PNG back with an independent QR reader and FAILS unless the
 *      decoded text matches the URL exactly — an unverified QR is never written
 *      into the README.
 *   3. Replaces the block between the fixit-apk-download markers in README.md
 *      with the live download link and QR image, so no placeholder link is ever
 *      committed. Re-running it after a repository rename keeps everything current.
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'
import sharp from 'sharp'
import jsQR from 'jsqr'

const MARKER_START = '<!-- fixit-apk-download:start -->'
const MARKER_END = '<!-- fixit-apk-download:end -->'

const repo = process.argv[2] ?? process.env.FIXIT_GITHUB_REPO
if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('Usage: npm run android:qr -- <owner/repo>')
  console.error('       e.g. npm run android:qr -- yourname/fixit-ai')
  console.error('Run it once the private repository exists and tag v1.0.0 has been pushed,')
  console.error('so the download link resolves to a real release asset.')
  process.exit(1)
}

const url = `https://github.com/${repo}/releases/latest/download/FIXIT-AI.apk`

// 1. Encode the stable "latest release" APK URL.
const outDir = path.resolve('docs/qr')
const outFile = path.join(outDir, 'android-apk.png')
mkdirSync(outDir, { recursive: true })
await QRCode.toFile(outFile, url, {
  width: 512,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#0b1220', light: '#ffffff' },
})

// 2. Verify: decode the PNG back and compare with the intended destination.
const { data, info } = await sharp(outFile).ensureAlpha().raw().toBuffer({ resolveWithObject: true })
const decoded = jsQR(new Uint8ClampedArray(data), info.width, info.height)
if (!decoded || decoded.data !== url) {
  throw new Error(
    `QR verification failed (decoded: ${decoded ? decoded.data : 'nothing'}). ` +
      'Not touching README.md — regenerate docs/qr/android-apk.png before publishing.',
  )
}
console.log(`[apk-qr] verified: docs/qr/android-apk.png decodes to ${url}`)

// 3. Patch the README download block between the markers.
const readmePath = path.resolve('README.md')
const readme = readFileSync(readmePath, 'utf8')
const startIdx = readme.indexOf(MARKER_START)
const endIdx = readme.indexOf(MARKER_END)
if (startIdx === -1 || endIdx === -1 || endIdx < startIdx) {
  throw new Error(`README.md is missing the ${MARKER_START} / ${MARKER_END} markers.`)
}

const block = [
  `**⬇️ [Download FIXIT AI for Android — FIXIT-AI.apk](${url})**`,
  ``,
  `The link always points at the **latest release** APK. Sign in to GitHub with an account that`,
  `has access to this private repository, open the link, and the APK downloads directly.`,
  `Previous versions remain available on the [releases page](https://github.com/${repo}/releases).`,
  ``,
  `<p align="center">`,
  `  <a href="${url}"><img src="docs/qr/android-apk.png" alt="Scan to download FIXIT AI for Android" width="220"></a>`,
  `</p>`,
  ``,
  `*Scan to download FIXIT AI for Android.*`,
].join('\n')

const updated = readme.slice(0, startIdx + MARKER_START.length) + '\n' + block + '\n' + readme.slice(endIdx)
writeFileSync(readmePath, updated)

console.log(`[apk-qr] README.md download block updated with the live link and QR`)
console.log(`[apk-qr] done — commit docs/qr/android-apk.png and README.md, then push`)
