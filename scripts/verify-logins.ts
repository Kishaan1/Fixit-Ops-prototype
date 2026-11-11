// Verifies the seeded accounts can actually log in through the running API:
// owner portal, technician portal, wrong password rejection, portal boundary.
const BASE = 'http://localhost:4000'

const OWNER = { identifier: 'OWNER', password: '^F6y3k4E79%X5qLZ', portal: 'OWNER' }
const TECH = { identifier: 'TECH01', password: 'k2GQm^AzYdvUv#3i', portal: 'TECHNICIAN' }

async function login(body: Record<string, string>) {
  const res = await fetch(`${BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = (await res.json()) as any
  return { status: res.status, json }
}

function assert(cond: unknown, msg: string) {
  if (!cond) throw new Error(msg)
  console.log(`  PASS — ${msg}`)
}

async function main() {
  console.log('[login-check] owner login via /api/auth/login')
  const owner = await login(OWNER)
  assert(owner.status === 200, `owner login returned HTTP 200 (got ${owner.status})`)
  assert(owner.json.user.role === 'OWNER', 'owner account has role OWNER')
  assert(owner.json.user.userId === 'OWNER', 'owner login ID is OWNER')
  assert(owner.json.user.mustChangePassword === true, 'owner is required to change password at first login')

  console.log('[login-check] technician login via /api/auth/login')
  const tech = await login(TECH)
  assert(tech.status === 200, `technician login returned HTTP 200 (got ${tech.status})`)
  assert(tech.json.user.role === 'TECHNICIAN', 'technician account has role TECHNICIAN')
  assert(tech.json.user.mustChangePassword === true, 'technician is required to change password at first login')
  assert(typeof tech.json.user.technicianId === 'string' && tech.json.user.technicianId.length > 0, 'technician master row is linked to the account')

  console.log('[login-check] wrong password is rejected')
  const bad = await login({ identifier: 'OWNER', password: 'definitely-wrong', portal: 'OWNER' })
  assert(bad.status === 401, `wrong password returned HTTP 401 (got ${bad.status})`)

  console.log('[login-check] owner cannot use the technician portal and vice versa')
  const cross1 = await login({ identifier: 'OWNER', password: OWNER.password, portal: 'TECHNICIAN' })
  assert(cross1.status === 403, `owner on technician portal returned HTTP 403 (got ${cross1.status})`)
  const cross2 = await login({ identifier: 'TECH01', password: TECH.password, portal: 'OWNER' })
  assert(cross2.status === 403, `technician on owner portal returned HTTP 403 (got ${cross2.status})`)

  console.log('[login-check] all login checks passed')
}

main().catch((err) => {
  console.error(`[login-check] FAIL — ${err instanceof Error ? err.message : err}`)
  process.exit(1)
})
