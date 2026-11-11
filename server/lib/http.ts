import type { NextFunction, Request, Response } from 'express'
import type { output, ZodTypeAny } from 'zod'
import { discardSheetsContext } from '../sheets/runtime'

export class HttpError extends Error {
  status: number
  code?: string
  details?: unknown

  constructor(status: number, message: string, options?: { code?: string; details?: unknown }) {
    super(message)
    this.status = status
    this.code = options?.code
    this.details = options?.details
  }
}

export function parse<T extends ZodTypeAny>(schema: T, input: unknown): output<T> {
  const result = schema.safeParse(input)
  if (!result.success) {
    throw new HttpError(400, 'Please check the highlighted fields.', {
      code: 'VALIDATION_ERROR',
      details: result.error.flatten(),
    })
  }
  return result.data
}

export function asyncRoute(
  handler: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next)
  }
}

export function notFound(_req: Request, res: Response) {
  res.status(404).json({ error: 'Not found' })
}

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  // A failed request must not leave partially staged Sheets writes behind.
  discardSheetsContext()
  if (err instanceof HttpError) {
    res.status(err.status).json({
      error: err.message,
      code: err.code,
      details: err.details,
    })
    return
  }
  const maybe = err as { code?: string; message?: string; name?: string; type?: string }
  if (maybe?.type === 'entity.parse.failed') {
    res.status(400).json({ error: 'The request body is not valid JSON.', code: 'BAD_JSON' })
    return
  }
  if (maybe?.code === 'LIMIT_FILE_SIZE' || maybe?.name === 'MulterError') {
    res.status(400).json({ error: 'The image could not be uploaded. Check the file type and size.' })
    return
  }
  if (maybe?.code === 'P2002' || maybe?.code === 'DUPLICATE') {
    res.status(409).json({
      error:
        maybe?.code === 'DUPLICATE' && maybe?.message
          ? maybe.message
          : 'A record with these unique details already exists.',
      code: 'CONFLICT',
    })
    return
  }
  if (maybe?.code === 'P2025' || maybe?.code === 'NOT_FOUND') {
    res.status(404).json({ error: 'The requested record was not found.', code: 'NOT_FOUND' })
    return
  }
  // Gateway problems are infrastructure failures, not bugs in the request.
  // Surface a clear, retryable message instead of a generic 500.
  const gatewayCodes = [
    'SHEETS_NOT_CONFIGURED',
    'SHEETS_UNREACHABLE',
    'SHEETS_BAD_RESPONSE',
    'SHEETS_REJECTED',
    'SHEETS_HTTP_ERROR',
    'SHEETS_GATEWAY_ERROR',
    'GATEWAY_ERROR',
  ]
  if (maybe?.code && gatewayCodes.includes(maybe.code)) {
    const notConfigured = maybe.code === 'SHEETS_NOT_CONFIGURED'
    res.status(notConfigured ? 503 : 502).json({
      error: notConfigured
        ? 'The Google Sheets database is not configured. Ask the owner to deploy the Apps Script gateway and set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET.'
        : 'Google Sheets did not confirm the save, so nothing was reported as saved. Please retry.',
      code: maybe.code,
      details: { message: maybe.message },
    })
    return
  }
  console.error('[api] unhandled error', err)
  res.status(500).json({ error: 'Something went wrong on the server. Please try again.', code: 'INTERNAL' })
}

export function param(req: Request, name: string): string {
  const value = (req.params as Record<string, string | string[] | undefined>)[name]
  if (Array.isArray(value)) return value[0] ?? ''
  return value ?? ''
}

export function round2(n: number) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100
}

export function toNumber(v: unknown, fallback = 0) {
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : fallback
}

export function jsonArray(value: string | null | undefined): unknown[] {
  if (!value) return []
  try {
    const parsed = JSON.parse(value)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

export function normalizePhone(input: string) {
  const digits = input.replace(/\D/g, '')
  // Keep the last 10 digits for Indian mobiles; store longer international numbers intact.
  return digits.length > 10 ? digits : digits
}

export function paginationDefaults(query: Record<string, unknown>) {
  const page = Math.max(1, Number(query.page) || 1)
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 25))
  return { page, pageSize, skip: (page - 1) * pageSize }
}
