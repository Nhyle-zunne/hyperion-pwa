import assert from 'node:assert/strict'
Deno.test('GitHub delivery broker verifies identity and current track access without reading question files', async () => {
  const originalFetch = globalThis.fetch, originalServe = Deno.serve
  const values = { SUPABASE_URL: 'https://test-project.supabase.co', SUPABASE_ANON_KEY: 'test-anon', SUPABASE_SERVICE_ROLE_KEY: 'test-service' }
  const saved = Object.fromEntries(Object.keys(values).map(name => [name, Deno.env.get(name)]))
  for (const [name, value] of Object.entries(values)) Deno.env.set(name, value)
  let handler: ((request: Request) => Promise<Response>) | undefined
  let licensed = true, unavailable = false, wrongOwner = false, bankReads = 0
  const userId = '11111111-1111-4111-8111-111111111111'
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  Object.assign(Deno, { serve: (fn: typeof handler) => { handler = fn; return {} } })
  globalThis.fetch = async (input, init) => {
    const request = new Request(input, init), url = new URL(request.url)
    if (url.pathname === '/auth/v1/user') return request.headers.get('Authorization') === 'Bearer valid-user' ? json({ id: userId, email: 'licensed@example.invalid' }) : json({ message: 'Invalid JWT' }, 401)
    if (url.pathname.includes('/rest/v1/')) {
      if (unavailable) return json({ message: 'Unavailable' }, 503)
      if (url.pathname.endsWith('/entitlements')) return json(licensed ? [{ user_id: wrongOwner ? 'another-user' : userId, track_id: 'DECK_OIC_NW', status: 'active', expires_at: '2099-01-01T00:00:00Z' }] : [])
      if (url.pathname.endsWith('/google_play_entitlements')) return json([])
      if (url.pathname.endsWith('/question_bank_migration_state')) return json({
        status: 'complete', asset_count: 69, error_summary: null, updated_at: '2026-11-03T00:00:00Z'
      })
    }
    bankReads++
    throw new Error('The broker must not retrieve bank objects: ' + url.pathname)
  }
  try {
    await import('../functions/question-bank/index.ts?github-delivery-test')
    assert.ok(handler)
    const call = (freeOnly = false, token = 'valid-user', track = 'DECK_OIC_NW') => handler!(new Request('https://test-project.supabase.co/functions/v1/question-bank', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify({ action: 'github-delivery-access', track, freeOnly }) }))
    assert.equal((await call()).status, 200)
    licensed = false
    assert.equal((await call()).status, 403)
    assert.equal((await call(false, '')).status, 401)
    assert.equal((await call(false, 'expired-user')).status, 401)
    assert.equal((await call(true, '')).status, 200)
    // Online free sessions are still allowed, but bulk file/CSV extraction is not.
    const rawRequest = (action: 'free-track-files' | 'get', token = 'valid-user') =>
      handler!(new Request('https://test-project.supabase.co/functions/v1/question-bank', {
        method: 'POST',
        headers: token ? { Authorization: 'Bearer ' + token } : {},
        body: JSON.stringify(action === 'get'
          ? { action, path: 'deck/oic_nw_c1.csv.enc', freeOnly: true }
          : { action, track: 'DECK_OIC_NW' })
      }))
    assert.equal((await rawRequest('free-track-files')).status, 403)
    assert.equal((await rawRequest('free-track-files', '')).status, 401)
    assert.equal((await rawRequest('get')).status, 403)
    assert.equal((await rawRequest('get', '')).status, 401)
    assert.equal(bankReads, 0, 'Denied bulk requests cannot fetch question-bank bytes')
    licensed = true; wrongOwner = true
    assert.equal((await call()).status, 403)
    wrongOwner = false; unavailable = true
    assert.equal((await call()).status, 503)
    assert.equal((await call(false, 'valid-user', 'UNKNOWN')).status, 400)
    assert.equal(bankReads, 0)
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(Deno, { serve: originalServe })
    for (const [name, value] of Object.entries(saved)) value === undefined ? Deno.env.delete(name) : Deno.env.set(name, value)
  }
})
