import 'dotenv/config'
import path from 'node:path'

function bool(v: string | undefined, fallback = false) {
  if (v === undefined || v === '') return fallback
  return v === 'true' || v === '1'
}

export const config = {
  port: Number(process.env.PORT || 4000),
  nodeEnv: process.env.NODE_ENV || 'development',
  isProd: process.env.NODE_ENV === 'production',
  databaseUrl: process.env.DATABASE_URL || 'file:./dev.db',
  sessionSecret: process.env.SESSION_SECRET || 'dev-only-insecure-secret-change-me',
  publicBaseUrl: (process.env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
  aiProvider: (process.env.AI_PROVIDER || 'gemini').toLowerCase(),
  geminiApiKey: process.env.GEMINI_API_KEY || '',
  geminiModel: process.env.GEMINI_MODEL || 'gemini-2.5-flash',
  uploadDir: path.resolve(process.cwd(), process.env.UPLOAD_DIR || 'server/uploads'),
  maxUploadMb: Number(process.env.MAX_UPLOAD_MB || 8),
  sheetsGatewayUrl: (process.env.SHEETS_GATEWAY_URL || '').trim(),
  sheetsGatewaySecret: process.env.SHEETS_GATEWAY_SECRET || '',
  sheetsTimezone: 'Asia/Kolkata',
  // Preview-harness only: shows the one-click demo login buttons on /login.
  // Never enabled in production; real accounts never use the demo password.
  demoLoginHints: bool(process.env.DEMO_LOGIN_HINTS, false),
  // Returning reset links in an API response is a development convenience only.
  // In production the link is written to the server log for an administrator to
  // deliver out-of-band until an email provider is configured.
  exposeResetTokens: bool(process.env.EXPOSE_RESET_TOKENS, process.env.NODE_ENV !== 'production'),
  allowedOrigins: [
    (process.env.PUBLIC_BASE_URL || 'http://localhost:5173').replace(/\/$/, ''),
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:5174',
    'http://127.0.0.1:5174',
    'http://localhost:5175',
    'http://127.0.0.1:5175',
    'http://localhost:4000',
    'http://127.0.0.1:4000',
  ],
}

export const AI_ENABLED = Boolean(config.geminiApiKey)
