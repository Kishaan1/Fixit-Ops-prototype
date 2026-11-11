// Raw debug of the Apps Script POST -> 302 -> echo flow.
// Prints every hop's status, headers and the first bytes of the body so we
// can see exactly what Google expects at the echo endpoint.
import http from 'node:http'
import https from 'node:https'
import 'dotenv/config'

const url = process.env.SHEETS_GATEWAY_URL || ''
const secret = process.env.SHEETS_GATEWAY_SECRET || ''
const body = JSON.stringify({ secret, action: 'ping' })

function request(
  target: string,
  method: string,
  extraHeaders: Record<string, string>,
  bodyText?: string,
): Promise<{ status: number; headers: Record<string, string | string[] | undefined>; body: string }> {
  const parsed = new URL(target)
  return new Promise((resolve, reject) => {
    const transport = parsed.protocol === 'http:' ? http : https
    const headers: Record<string, string> = { ...extraHeaders }
    if (bodyText !== undefined) headers['content-length'] = String(Buffer.byteLength(bodyText))
    const req = transport.request(
      {
        hostname: parsed.hostname,
        port: parsed.port || (parsed.protocol === 'http:' ? 80 : 443),
        path: `${parsed.pathname}${parsed.search}`,
        method,
        headers,
      },
      (res) => {
        const chunks: Buffer[] = []
        res.on('data', (c: Buffer) => chunks.push(c))
        res.on('end', () =>
          resolve({
            status: res.statusCode ?? 0,
            headers: res.headers,
            body: Buffer.concat(chunks).toString('utf8'),
          }),
        )
      },
    )
    req.on('error', reject)
    if (bodyText !== undefined) req.write(bodyText)
    req.end()
  })
}

function show(label: string, r: { status: number; headers: Record<string, string | string[] | undefined>; body: string }) {
  console.log(`\n=== ${label} ===`)
  console.log('status:', r.status)
  for (const [k, v] of Object.entries(r.headers)) {
    if (['location', 'set-cookie', 'content-type', 'allow', 'x-robots-tag', 'server', 'cache-control'].includes(k)) {
      console.log(`${k}: ${Array.isArray(v) ? v.join(' | ') : v}`)
    }
  }
  console.log('body (first 300):', r.body.slice(0, 300).replace(/\s+/g, ' '))
}

async function main() {
  const baseHeaders = { 'content-type': 'text/plain;charset=utf-8' }

  const hop1 = await request(url, 'POST', baseHeaders, body)
  show('POST /exec (hop 1)', hop1)

  const location = hop1.headers.location
  if (typeof location === 'string' && hop1.status >= 300 && hop1.status < 400) {
    const target = new URL(location, url).toString()
    console.log('\nredirect target:', target.slice(0, 120) + '...')

    const hop2 = await request(target, 'POST', baseHeaders, body)
    show('POST echo (hop 2, no cookies)', hop2)

    if (hop2.status === 405) {
      // try with cookies from hop 1
      const setCookies = hop1.headers['set-cookie']
      const cookieHeader = Array.isArray(setCookies)
        ? setCookies.map((c) => c.split(';')[0]).join('; ')
        : setCookies
          ? String(setCookies).split(';')[0]
          : ''
      console.log('cookies from hop 1:', cookieHeader || '(none)')
      if (cookieHeader) {
        const hop3 = await request(target, 'POST', { ...baseHeaders, cookie: cookieHeader }, body)
        show('POST echo (hop 2 with cookies)', hop3)
      }

      // try GET on the echo target to see what it says
      const hop4 = await request(target, 'GET', {})
      show('GET echo', hop4)
    }
  }
}

main().catch((err) => {
  console.error('ERR', err)
  process.exit(1)
})
