import assert from 'node:assert/strict'

type Handler = (req: Request) => Promise<Response>

Deno.test('activity tracking suppresses duplicate cross-device writes for six hours and never crosses accounts', async () => {
  const ownerA = '11111111-1111-4111-8111-111111111111'
  const ownerB = '22222222-2222-4222-8222-222222222222'
  const originalFetch = globalThis.fetch
  const originalServe = Deno.serve
  let handler: Handler | undefined
  const lastAccess = new Map<string, string>()
  let currentUser = ownerA
  let authLookups = 0
  let reads = 0
  let writes = 0

  const respond = (value: unknown, status = 200) => Response.json(value, { status })
  Object.assign(Deno, { serve: (fn: Handler) => { handler = fn; return {} } })
  Deno.env.set('SUPABASE_URL', 'http://fixture.invalid')
  Deno.env.set('SUPABASE_ANON_KEY', 'fixture-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service')
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/auth/v1/user')) {
      authLookups++
      return respond({ id: currentUser, aud: 'authenticated', email: 'fixture@example.invalid' })
    }
    if (url.pathname.endsWith('/rest/v1/user_activity')) {
      if (req.method === 'GET') {
        reads++
        assert.equal(url.searchParams.get('user_id'), 'eq.' + currentUser)
        const last = lastAccess.get(currentUser)
        return respond(last ? { last_accessed_at: last } : null)
      }
      if (req.method === 'POST') {
        const body = JSON.parse(await req.text())
        assert.equal(body.user_id, currentUser)
        assert.ok(body.updated_at && body.last_accessed_at)
        lastAccess.set(currentUser, body.last_accessed_at)
        writes++
        return respond([], 201)
      }
    }
    throw Error('Unexpected service request: ' + req.method + ' ' + url.pathname)
  }) as typeof fetch

  try {
    await import('../functions/record-user-activity/index.ts')
    const send = () => handler!(new Request('http://fixture.invalid/functions/v1/record-user-activity', {
      method: 'POST',
      headers: { Authorization: 'Bearer fixture-token', Origin: 'https://hyperionmaritime.org' },
      body: '{}'
    }))
    let response = await send()
    assert.equal(response.status, 200)
    assert.equal((await response.json()).updated, true)
    assert.equal(writes, 1)

    response = await send()
    assert.equal(response.status, 200)
    assert.equal((await response.json()).updated, false)
    assert.equal(writes, 1, 'Repeated visits from old clients must not write another row')

    lastAccess.set(ownerA, new Date(Date.now() - (6 * 60 * 60 * 1000) + 60_000).toISOString())
    assert.equal((await (await send()).json()).updated, false, 'A record only 5h59m old is fresh')
    assert.equal(writes, 1)

    lastAccess.set(ownerA, new Date(Date.now() - (6 * 60 * 60 * 1000) - 60_000).toISOString())
    assert.equal((await (await send()).json()).updated, true, 'A six-hour stale activity marker is updated')
    assert.equal(writes, 2)

    currentUser = ownerB
    assert.equal((await (await send()).json()).updated, true)
    assert.equal(writes, 3, 'Another signed-in owner is independent of the first account')
    assert.equal(reads, 5)
    assert.equal(authLookups, 5)

    const anonymous = await handler!(new Request('http://fixture.invalid/functions/v1/record-user-activity', { method: 'POST' }))
    assert.equal(anonymous.status, 401)
    assert.equal(writes, 3)
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(Deno, { serve: originalServe })
  }
})
