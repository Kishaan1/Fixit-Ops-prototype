import { existsSync } from 'node:fs'
import path from 'node:path'
import express from 'express'
import cookieParser from 'cookie-parser'
import helmet from 'helmet'
import { config } from './env'
import { prisma } from './db'
import { gateway, runWithSheetsWrite, sheetsConfigured } from './sheets/runtime'
import { ensureSheetsSchema } from './sheets/runtime'
import { sheetsMiddleware } from './sheets/middleware'
import { sessionMiddleware } from './lib/auth'
import { errorHandler, notFound } from './lib/http'
import { authRouter } from './routes/auth'
import { customersRouter } from './routes/customers'
import { techniciansRouter } from './routes/technicians'
import { repairsRouter } from './routes/repairs'
import { partsRouter } from './routes/parts'
import { analyticsRouter } from './routes/analytics'
import { reportsRouter, publicRouter } from './routes/reports'
import { notificationsRouter } from './routes/notifications'
import { settingsRouter } from './routes/settings'
import { aiRouter } from './routes/ai'
import { uploadsRouter } from './routes/uploads'

const app = express()

app.disable('x-powered-by')
app.set('trust proxy', 1)
app.use(
  helmet({
    // The SPA uses inline styles from charts; CSP is handled at the reverse proxy in production.
    contentSecurityPolicy: false,
    crossOriginResourcePolicy: { policy: 'same-site' },
  }),
)
app.use(express.json({ limit: '1mb' }))
app.use(cookieParser())
app.use(sheetsMiddleware)
app.use(sessionMiddleware)

// Lightweight CSRF defence for state-changing requests: browsers send Origin on
// cross-site fetch/XHR. Same-origin API calls from the SPA are allow-listed.
app.use((req, res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.headers.origin
  if (!origin) return next()
  try {
    const clean = new URL(origin).origin
    if (config.allowedOrigins.includes(clean)) return next()
  } catch {
    /* fall through */
  }
  res.status(403).json({ error: 'Request origin is not allowed.', code: 'BAD_ORIGIN' })
})

app.get('/api/health', async (_req, res) => {
  if (!sheetsConfigured()) {
    res.status(503).json({
      ok: false,
      database: 'google-sheets',
      demoLoginHints: config.demoLoginHints,
      error:
        'Google Sheets is not configured. Set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET, then deploy the Apps Script gateway.',
    })
    return
  }
  try {
    const ping = await gateway.ping()
    res.json({
      ok: true,
      database: 'google-sheets',
      demoLoginHints: config.demoLoginHints,
      spreadsheet: {
        id: ping.spreadsheetId,
        name: ping.spreadsheetName,
        timezone: ping.timezone,
        tabs: ping.tabs.length,
      },
      aiConfigured: Boolean(config.geminiApiKey),
      time: new Date().toISOString(),
    })
  } catch (err) {
    res.status(503).json({
      ok: false,
      database: 'google-sheets',
      demoLoginHints: config.demoLoginHints,
      error: err instanceof Error ? err.message : 'Google Sheets unavailable.',
    })
  }
})

app.use('/api/auth', authRouter)
app.use('/api/customers', customersRouter)
app.use('/api/technicians', techniciansRouter)
app.use('/api/repairs', repairsRouter)
app.use('/api/parts', partsRouter)
app.use('/api/analytics', analyticsRouter)
app.use('/api/reports', reportsRouter)
app.use('/api/notifications', notificationsRouter)
app.use('/api/settings', settingsRouter)
app.use('/api/ai', aiRouter)
app.use('/api/uploads', uploadsRouter)
app.use('/api/public', publicRouter)
app.use('/api', notFound)

const clientDir = path.resolve(process.cwd(), 'dist/client')
if (existsSync(clientDir)) {
  app.use(express.static(clientDir, { index: false, maxAge: '1h' }))
  app.get(/^(?!\/api).*/, (_req, res) => {
    res.sendFile(path.join(clientDir, 'index.html'))
  })
} else {
  app.get('/', (_req, res) => {
    res
      .status(200)
      .type('text/plain')
      .send('FIXIT AI API is running. Start the frontend with `npm run dev:web` (Vite) or build with `npm run build`.')
  })
}

app.use((_req, res) => {
  res.status(404).json({ error: 'Not found' })
})
app.use(errorHandler)

const server = app.listen(config.port, () => {
  console.log(`[api] FIXIT AI listening on http://localhost:${config.port}`)
  console.log(`[api] AI provider: ${config.geminiApiKey ? `${config.aiProvider} (${config.geminiModel})` : 'not configured — manual mode enabled'}`)
  console.log(`[api] Public report base: ${config.publicBaseUrl}`)
  console.log(
    sheetsConfigured()
      ? '[api] Database: Google Sheets (Apps Script gateway)'
      : '[api] Database: Google Sheets — NOT CONFIGURED. Set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET.',
  )

  // Create/verify master and current-month tabs as soon as the API is up, so
  // the owner can open the spreadsheet and see the structure immediately.
  if (sheetsConfigured()) {
    ensureSheetsSchema()
      .then((result) => {
        const schema = result as { spreadsheetName?: string; currentMonth?: string }
        console.log(
          `[api] Sheets schema ready: ${schema.spreadsheetName ?? 'spreadsheet'} · ${schema.currentMonth ?? ''}`,
        )
      })
      .catch((err) => {
        console.error('[api] Google Sheets schema check failed:', err instanceof Error ? err.message : err)
      })
  }
})

const cleanup = setInterval(() => {
  if (!sheetsConfigured()) return
  runWithSheetsWrite(() =>
    prisma.session.deleteMany({ where: { expiresAt: { lt: new Date() } } }),
  ).catch(() => {})
}, 6 * 60 * 60 * 1000)
cleanup.unref()

async function shutdown() {
  server.close()
  await prisma.$disconnect()
  process.exit(0)
}
process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)

export default app
