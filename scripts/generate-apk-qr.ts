/**
 * Generates the QR code that points at the latest FIXIT-AI.apk release asset.
 *
 * Run:  npx tsx scripts/generate-apk-qr.ts <owner/repo>
 * (or set FIXIT_GITHUB_REPO=<owner/repo>)
 *
 * The QR encodes the stable "latest release" download URL:
 *   https://github.com/<owner>/<repo>/releases/latest/download/FIXIT-AI.apk
 *
 * Re-run it whenever the repository moves — the README embeds docs/qr/android-apk.png.
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import QRCode from 'qrcode'

const repo = process.argv[2] ?? process.env.FIXIT_GITHUB_REPO
if (!repo || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) {
  console.error('Usage: npx tsx scripts/generate-apk-qr.ts <owner/repo>')
  console.error('       e.g. npx tsx scripts/generate-apk-qr.ts yourname/fixit-ai')
  process.exit(1)
}

const url = `https://github.com/${repo}/releases/latest/download/FIXIT-AI.apk`
const outDir = path.resolve('docs/qr')
const outFile = path.join(outDir, 'android-apk.png')

mkdirSync(outDir, { recursive: true })
await QRCode.toFile(outFile, url, {
  width: 512,
  margin: 2,
  errorCorrectionLevel: 'M',
  color: { dark: '#0b1220', light: '#ffffff' },
})

console.log(`[apk-qr] QR code → ${outFile}`)
console.log(`[apk-qr] encodes  ${url}`)
