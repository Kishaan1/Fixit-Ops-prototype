/**
 * Local check for the gateway transport's Apps Script redirect handling.
 *
 * Mimics Google's verified /exec → echo dance exactly:
 *   1. POST /exec with the JSON body — Google stashes the request and
 *      replies 302 to script.googleusercontent.com/macros/echo.
 *   2. The echo endpoint ONLY allows GET (a re-sent POST is a 405). The GET
 *      makes the server execute the stashed POST and return its response.
 * This never touches the network.
 *
 * Run: npx tsx scripts/gateway-transport-check.ts
 */
import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { SheetsGateway, SheetsGatewayError } from '../server/sheets/gateway'

let execPosts = 0
let echoGets = 0
let echoPosts = 0
let lastExecBody = ''
let lastEchoMethod = ''

const server = http.createServer((req, res) => {
  const host = `http://${req.headers.host}`

  // Imitates script.google.com/macros/s/.../exec: stash the POST body and
  // redirect to the echo endpoint.
  if (req.method === 'POST' && req.url === '/exec') {
    const chunks: Buffer[] = []
    req.on('data', (chunk: Buffer) => chunks.push(chunk))
    req.on('end', () => {
      execPosts += 1
      lastExecBody = Buffer.concat(chunks).toString('utf8')
      res.writeHead(302, { location: `${host}/echo` })
      res.end()
    })
    return
  }

  // Imitates script.googleusercontent.com: like Google, it rejects POST
  // (405, Allow: GET/HEAD) and serves the stashed request's response on GET.
  if (req.url === '/echo') {
    if (req.method === 'POST') {
      echoPosts += 1
      req.resume()
      res.writeHead(405, { allow: 'HEAD, GET' })
      res.end('method not allowed')
      return
    }
    echoGets += 1
    lastEchoMethod = req.method
    req.resume()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(
      JSON.stringify({
        ok: true,
        result: { transport: 'ok', echoedBody: lastExecBody },
      }),
    )
    return
  }

  if (req.method === 'POST' && req.url === '/reject') {
    req.resume()
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ ok: false, error: 'Mocked rejection.', code: 'MOCK_REJECT' }))
    return
  }

  res.writeHead(404)
  res.end()
})

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message)
}

async function main() {
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  const port = (server.address() as AddressInfo).port
  const base = `http://127.0.0.1:${port}`

  console.log('[transport] gateway POST→302→GET redirect check (local mock of Google)')

  const gateway = new SheetsGateway(`${base}/exec`, 'fixit-gateway-secret')
  const result = (await gateway.ping()) as { transport?: string; echoedBody?: string }

  assert(result.transport === 'ok', 'The gateway call did not return the mock result.')
  assert(execPosts === 1, `Expected exactly one POST to /exec, saw ${execPosts}.`)
  assert(echoGets === 1, `Expected exactly one GET at the echo endpoint, saw ${echoGets}.`)
  assert(echoPosts === 0, 'The transport re-POSTed to the echo endpoint — Google answers that with 405.')
  assert(lastEchoMethod === 'GET', `The redirected request arrived as ${lastEchoMethod}, not GET.`)
  const parsed = JSON.parse(result.echoedBody ?? '{}') as { secret?: string; action?: string }
  assert(parsed.secret === 'fixit-gateway-secret', 'The secret did not survive the POST→302→GET dance.')
  assert(parsed.action === 'ping', 'The action did not survive the POST→302→GET dance.')
  console.log('  PASS — POST body reached the stash; the redirect was followed with GET')

  const rejecting = new SheetsGateway(`${base}/reject`, 'fixit-gateway-secret')
  try {
    await rejecting.ping()
    throw new Error('The mock rejection was not surfaced.')
  } catch (err) {
    assert(
      err instanceof SheetsGatewayError && err.code === 'MOCK_REJECT',
      `Expected a MOCK_REJECT gateway error, got: ${err instanceof Error ? err.message : err}`,
    )
  }
  console.log('  PASS — gateway error envelopes are surfaced with their code')

  server.close()
  console.log('[transport] all checks passed')
}

main().catch((err) => {
  console.error(`[transport] FAIL — ${err instanceof Error ? err.message : err}`)
  server.close()
  process.exit(1)
})
