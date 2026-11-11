/**
 * Renders the FIXIT AI brand icon and splash source images with headless Chrome
 * (puppeteer-core) into assets/. The results are consumed by
 * `npx capacitor-assets generate --android`, which produces every density
 * (mipmap-*, drawable-*) inside the Android project.
 *
 * Run:  npx tsx scripts/generate-brand-assets.ts
 */
import { mkdirSync } from 'node:fs'
import path from 'node:path'
import puppeteer from 'puppeteer-core'

const CHROME = process.env.CHROME_PATH || 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const OUT = path.resolve('assets')

function document_(body: string, transparent: boolean): string {
  return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  html, body { width: 100%; height: 100%; }
  body {
    background: ${transparent ? 'transparent' : 'linear-gradient(140deg, #0b1220 0%, #101b31 60%, #0e2233 100%)'};
    display: flex;
    align-items: center;
    justify-content: center;
    overflow: hidden;
  }
</style>
</head>
<body>${body}</body>
</html>`
}

/** The FIXIT AI monogram: gradient-bordered rounded square with a gradient "F". */
function mark(size: number): string {
  const border = Math.round(size * 0.045)
  const radius = Math.round(size * 0.24)
  const font = Math.round(size * 0.54)
  return `
  <div style="width:${size}px;height:${size}px;border-radius:${radius}px;
       background:linear-gradient(135deg,#22d3ee 0%,#6366f1 55%,#8b5cf6 100%);
       display:flex;align-items:center;justify-content:center;
       box-shadow:0 ${Math.round(size * 0.03)}px ${Math.round(size * 0.09)}px rgba(0,0,0,0.35);">
    <div style="width:${size - border * 2}px;height:${size - border * 2}px;
         border-radius:${Math.max(radius - border, 4)}px;
         background:linear-gradient(160deg,#0d1a2e 0%,#0a1424 100%);
         display:flex;align-items:center;justify-content:center;">
      <span style="font-family:'Segoe UI',system-ui,sans-serif;font-weight:800;font-size:${font}px;
           line-height:1;letter-spacing:-${Math.round(font * 0.05)}px;
           background:linear-gradient(120deg,#e8f6ff 0%,#22d3ee 60%,#818cf8 100%);
           -webkit-background-clip:text;background-clip:text;color:transparent;">F</span>
    </div>
  </div>`
}

function wordmark(size: number): string {
  const font = Math.round(size * 0.055)
  return `
  <div style="margin-top:${Math.round(size * 0.05)}px;
       font-family:'Segoe UI',system-ui,sans-serif;font-weight:800;font-size:${font}px;
       letter-spacing:${Math.round(font * 0.04)}px;color:#f1f5f9;">
    FIXIT&nbsp;<span style="background:linear-gradient(90deg,#22d3ee,#8b5cf6);
      -webkit-background-clip:text;background-clip:text;color:transparent;">AI</span>
  </div>
  <div style="margin-top:${Math.round(size * 0.02)}px;
       font-family:'Segoe UI',system-ui,sans-serif;font-size:${Math.round(size * 0.026)}px;
       letter-spacing:${Math.round(size * 0.008)}px;color:#64748b;text-transform:uppercase;">
    Repair Shop Management
  </div>`
}

interface Shot {
  name: string
  width: number
  height: number
  html: string
  transparent: boolean
}

const ICON = 1024
const SPLASH = 2732

const shots: Shot[] = [
  // Complete legacy/Play Store icon (background included).
  { name: 'icon.png', width: ICON, height: ICON, html: mark(Math.round(ICON * 0.62)), transparent: false },
  // Logo alone on transparency (used with a solid background color).
  { name: 'icon-only.png', width: ICON, height: ICON, html: mark(Math.round(ICON * 0.72)), transparent: true },
  // Adaptive icon foreground: logo confined to the centre safe zone (~55%).
  { name: 'icon-foreground.png', width: ICON, height: ICON, html: mark(Math.round(ICON * 0.55)), transparent: true },
  // Adaptive icon background: full-bleed brand gradient.
  {
    name: 'icon-background.png',
    width: ICON,
    height: ICON,
    html: `<div style="width:100%;height:100%;background:linear-gradient(140deg,#0b1220 0%,#101b31 60%,#0e2233 100%);"></div>`,
    transparent: false,
  },
  // Splash screens (light + dark variants share the dark brand look).
  { name: 'splash.png', width: SPLASH, height: SPLASH, html: `${mark(Math.round(SPLASH * 0.16))}${wordmark(SPLASH)}`, transparent: false },
  { name: 'splash-dark.png', width: SPLASH, height: SPLASH, html: `${mark(Math.round(SPLASH * 0.16))}${wordmark(SPLASH)}`, transparent: false },
]

async function main() {
  if (!(await import('node:fs')).existsSync(CHROME)) {
    throw new Error(`Chrome not found at ${CHROME} — set CHROME_PATH to your Chrome executable.`)
  }
  mkdirSync(OUT, { recursive: true })

  const browser = await puppeteer.launch({
    executablePath: CHROME,
    headless: true,
    args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-device-scale-factor=1', '--hide-scrollbars'],
  })

  const page = await browser.newPage()
  for (const shot of shots) {
    await page.setViewport({ width: shot.width, height: shot.height, deviceScaleFactor: 1 })
    await page.setContent(document_(shot.html, shot.transparent), { waitUntil: 'load' })
    const file = path.join(OUT, shot.name)
    await page.screenshot({ path: file, omitBackground: shot.transparent })
    console.log(`[brand-assets] wrote ${shot.name} (${shot.width}x${shot.height})`)
  }

  await browser.close()
  console.log(`[brand-assets] done → ${OUT}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
