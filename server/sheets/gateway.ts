import http from 'node:http'
import https from 'node:https'
import type { IncomingMessage } from 'node:http'
import type { ScalarType } from './schema'

export type GatewayTable = {
  key: string
  kind: 'master' | 'monthly'
  tab?: string
  suffix?: string
}

export type GatewayWriteOp = {
  mode: 'create' | 'upsert' | 'update' | 'delete'
  kind: 'master' | 'monthly'
  tab?: string
  suffix?: string
  monthKey?: string
  id: string
  idHeader: string
  headers: string[]
  types: ScalarType[]
  validations?: Record<string, string[]>
  data?: Record<string, unknown>
  /** Natural unique key used by an upsert (for example Phone or Email). */
  matchHeader?: string
  matchValue?: string
  /** Additional unique-column guards checked under the script lock. */
  uniqueChecks?: Array<{ header: string; value: string }>
}

export type GatewaySchema = {
  masters: Array<{
    tab: string
    headers: string[]
    types: ScalarType[]
    validations: Record<string, string[]>
  }>
  monthly: Array<{
    suffix: string
    headers: string[]
    types: ScalarType[]
    validations: Record<string, string[]>
  }>
}

export class SheetsGatewayError extends Error {
  code: string
  retryable: boolean
  constructor(message: string, code = 'SHEETS_GATEWAY_ERROR', retryable = false) {
    super(message)
    this.name = 'SheetsGatewayError'
    this.code = code
    this.retryable = retryable
  }
}

type GatewayEnvelope<T> = {
  ok: boolean
  result?: T
  error?: string
  code?: string
  retryable?: boolean
}

const RETRY_DELAYS = [400, 1200, 3000]

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

/* ------------------------------------------------------------------ */
/* Transport — POST with Apps Script redirect support                  */
/* ------------------------------------------------------------------ */

type GatewayHttpResponse = { status: number; body: string }

class GatewayTransportError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'GatewayTransportError'
  }
}

/**
 * POSTs JSON to the Apps Script Web App URL.
 *
 * Apps Script's contract (verified against the live endpoint):
 *   1. POST the JSON body to the /exec URL. Google stashes the whole request
 *      server-side and answers with a 302 redirect to
 *      script.googleusercontent.com/macros/echo?user_content_key=…
 *   2. That echo endpoint only allows GET/HEAD (a re-sent POST is a 405), so
 *      the redirect must be followed with a GET. Google then executes the
 *      stashed POST — including its original body — and returns its response.
 * Browsers do this automatically (they rewrite a redirected POST as GET); a
 * naive fetch() would lose the request. This transport follows the redirect
 * with a GET exactly like a browser.
 */
function postJson(
  url: string,
  payload: unknown,
  timeoutMs: number,
): Promise<GatewayHttpResponse> {
  const body = JSON.stringify(payload)

  const attempt = (target: string): Promise<GatewayHttpResponse> =>
    new Promise((resolve, reject) => {
      let parsed: URL
      try {
        parsed = new URL(target)
      } catch {
        reject(new GatewayTransportError(`The gateway URL is invalid: ${target}`))
        return
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      // One type shape is used for both protocols; the options below are
      // equally valid for plain HTTP and HTTPS.
      const transport = (parsed.protocol === 'http:' ? http : https) as unknown as typeof https
      const request = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'POST',
          headers: {
            'content-type': 'text/plain;charset=utf-8',
            'content-length': String(Buffer.byteLength(body)),
            // Never reuse a pooled socket across a redirect hop: after a 302
            // the server may discard the connection with this request's body
            // still in flight, which desynchronises keep-alive parsing.
            connection: 'close',
          },
        },
        (response: IncomingMessage) => {
          const status = response.statusCode ?? 0
          const location = response.headers.location
          if (status >= 300 && status < 400 && location) {
            response.resume()
            clearTimeout(timer)
            // Like a browser: the POST body was already delivered (Google
            // stashed it), so the redirect is followed with a plain GET.
            getFollow_(new URL(location, target).toString(), timeoutMs, 4)
              .then(resolve, reject)
            return
          }
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            clearTimeout(timer)
            resolve({ status, body: Buffer.concat(chunks).toString('utf8') })
          })
          response.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(new GatewayTransportError(err.message))
          })
        },
      )

      timer = setTimeout(() => {
        request.destroy(new GatewayTransportError('The gateway request timed out.'))
      }, timeoutMs)
      request.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err instanceof GatewayTransportError ? err : new GatewayTransportError(err.message))
      })
      request.end(body)
    })

  return attempt(url)
}

/** Redirect continuation: GET hops only, like a browser after a 302. */
function getFollow_(
  target: string,
  timeoutMs: number,
  redirectsLeft: number,
): Promise<GatewayHttpResponse> {
  const attempt = (next: string): Promise<GatewayHttpResponse> =>
    new Promise((resolve, reject) => {
      let parsed: URL
      try {
        parsed = new URL(next)
      } catch {
        reject(new GatewayTransportError(`The gateway redirect URL is invalid: ${next}`))
        return
      }

      let timer: ReturnType<typeof setTimeout> | undefined
      const transport = (parsed.protocol === 'http:' ? http : https) as unknown as typeof https
      const request = transport.request(
        {
          hostname: parsed.hostname,
          port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
          path: `${parsed.pathname}${parsed.search}`,
          method: 'GET',
          headers: { connection: 'close' },
        },
        (response: IncomingMessage) => {
          const status = response.statusCode ?? 0
          const location = response.headers.location
          if (status >= 300 && status < 400 && location) {
            response.resume()
            if (redirectsLeft <= 0) {
              reject(new GatewayTransportError('The gateway redirected too many times.'))
              return
            }
            clearTimeout(timer)
            getFollow_(new URL(location, next).toString(), timeoutMs, redirectsLeft - 1)
              .then(resolve, reject)
            return
          }
          const chunks: Buffer[] = []
          response.on('data', (chunk: Buffer) => chunks.push(chunk))
          response.on('end', () => {
            clearTimeout(timer)
            resolve({ status, body: Buffer.concat(chunks).toString('utf8') })
          })
          response.on('error', (err: Error) => {
            clearTimeout(timer)
            reject(new GatewayTransportError(err.message))
          })
        },
      )

      timer = setTimeout(() => {
        request.destroy(new GatewayTransportError('The gateway request timed out.'))
      }, timeoutMs)
      request.on('error', (err: Error) => {
        clearTimeout(timer)
        reject(err instanceof GatewayTransportError ? err : new GatewayTransportError(err.message))
      })
      request.end()
    })

  return attempt(target)
}

export class SheetsGateway {
  private url: string
  private secret: string

  constructor(url: string, secret: string) {
    this.url = url.replace(/\/$/, '')
    this.secret = secret
  }

  get configured() {
    return Boolean(this.url && this.secret)
  }

  private async call<T>(
    action: string,
    payload: Record<string, unknown> = {},
    options: { requestId?: string } = {},
  ): Promise<T> {
    if (!this.configured) {
      throw new SheetsGatewayError(
        'Google Sheets is not configured. Set SHEETS_GATEWAY_URL and SHEETS_GATEWAY_SECRET.',
        'SHEETS_NOT_CONFIGURED',
      )
    }

    let lastError: unknown
    for (let attempt = 0; attempt <= RETRY_DELAYS.length; attempt += 1) {
      try {
        const response = await postJson(
          this.url,
          {
            secret: this.secret,
            action,
            requestId: options.requestId,
            ...payload,
          },
          60_000,
        )

        const text = response.body
        let envelope: GatewayEnvelope<T>
        try {
          envelope = JSON.parse(text) as GatewayEnvelope<T>
        } catch {
          throw new SheetsGatewayError(
            `The Google Sheets gateway returned an unreadable response (HTTP ${response.status}).`,
            'SHEETS_BAD_RESPONSE',
            response.status >= 500,
          )
        }

        if (!(response.status >= 200 && response.status < 300)) {
          throw new SheetsGatewayError(
            envelope.error || `Google Sheets gateway failed (HTTP ${response.status}).`,
            envelope.code || 'SHEETS_HTTP_ERROR',
            response.status >= 500,
          )
        }
        if (!envelope.ok) {
          throw new SheetsGatewayError(
            envelope.error || 'Google Sheets rejected the request.',
            envelope.code || 'SHEETS_REJECTED',
            // Apps Script reports transient Google failures in a normal 200
            // response, so trust its explicit retryable flag as well.
            envelope.retryable === true,
          )
        }
        return envelope.result as T
      } catch (err) {
        lastError = err
        const retryable =
          err instanceof SheetsGatewayError
            ? err.retryable
            : err instanceof Error &&
              (err.name === 'GatewayTransportError' ||
                err.name === 'AbortError' ||
                err.name === 'TypeError')
        if (!retryable || attempt >= RETRY_DELAYS.length) break
        await sleep(RETRY_DELAYS[attempt])
      }
    }

    if (lastError instanceof SheetsGatewayError) throw lastError
    throw new SheetsGatewayError(
      lastError instanceof Error
        ? `Could not reach the Google Sheets gateway: ${lastError.message}`
        : 'Could not reach the Google Sheets gateway.',
      'SHEETS_UNREACHABLE',
      true,
    )
  }

  ping() {
    return this.call<{
      spreadsheetId: string
      spreadsheetName: string
      timezone: string
      tabs: string[]
      now: string
    }>('ping')
  }

  ensureSchema(schema: GatewaySchema) {
    return this.call<{
      spreadsheetId: string
      spreadsheetName: string
      timezone: string
      currentMonth: string
      masterTabs: string[]
      monthlyTabs: string[]
    }>('ensureSchema', { schema })
  }

  readTables(tables: GatewayTable[]) {
    const requestId = `read-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    return this.call<{ tables: Record<string, Array<Record<string, unknown>>> }>(
      'readTables',
      { tables },
      { requestId },
    )
  }

  writeBatch(ops: GatewayWriteOp[], requestId: string) {
    return this.call<{
      results: Array<{ tab: string; month: string; id: string; deleted: boolean }>
      requestId: string
    }>('writeBatch', { ops }, { requestId })
  }

  uploadImage(input: {
    base64: string
    mimeType: string
    filename: string
    monthKey: string
  }) {
    const requestId = `img-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    return this.call<{
      fileId: string
      name: string
      mimeType: string
      size: number
      url: string
      monthKey: string
    }>('uploadImage', input, { requestId })
  }

  getImage(fileId: string) {
    return this.call<{
      fileId: string
      name: string
      mimeType: string
      base64: string
      size: number
    }>('getImage', { fileId })
  }

  backup() {
    const requestId = `backup-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    return this.call<{ fileId: string; name: string; url: string; createdAt: string }>(
      'backup',
      {},
      { requestId },
    )
  }

  listMonths() {
    return this.call<{ months: string[] }>('listMonths')
  }
}
