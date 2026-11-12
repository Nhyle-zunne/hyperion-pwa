import assert from 'node:assert/strict'

type Handler = (req: Request) => Promise<Response>
Deno.test('conditional progress reads omit unchanged data only after fresh access checks', async () => {
  const userA = '11111111-1111-4111-8111-111111111111'
  const userB = '22222222-2222-4222-8222-222222222222'
  const originalFetch = globalThis.fetch
  const originalServe = Deno.serve
  let handler: Handler | undefined
  let entitled = true
  let entitlementFailure = false
  let authorizationFailure = false
  let exists = true
  let revision = '2026-11-03T01:00:00.000Z'
  const question = { id: 'q1', track: 'DECK_OIC_NW', questionText: 'Paid fixture', options: ['A', 'B'], correctAnswerIndex: 1 }
  const snapshot = { version: 1, storage: {
    'hyperion-bookmarks': JSON.stringify({ state: { items: [question] } }),
    'hyperion-vault': JSON.stringify({ state: { items: [question] } }),
    'hyperion-history': 'saved history',
  }, activeSession: { sessionId: 'saved-session', track: 'DECK_OIC_NW', questions: [question] } }
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  Object.assign(Deno, { serve: (fn: Handler) => { handler = fn; return {} } })
  Deno.env.set('SUPABASE_URL', 'http://fixture.invalid')
  Deno.env.set('SUPABASE_ANON_KEY', 'fixture-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service')
  Deno.env.set('ADMIN_EMAILS', '')
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/rpc/get_active_paid_track_entitlements')) {
      const body = JSON.parse(await req.text())
      return entitlementFailure ? json({ message: 'Unavailable' }, 503) :
        json(entitled ? [{ user_id: body.p_user_id, track_id: 'DECK_OIC_NW', expires_at: '2099-01-01T00:00:00Z' }] : [])
    }
    if (url.pathname.endsWith('/entitlements')) return entitlementFailure ? json({ message: 'Unavailable' }, 503) : json(entitled ? [{ track_id: 'DECK_OIC_NW' }] : [])
    if (url.pathname.endsWith('/user_learning_progress')) {
      assert.equal(req.method, 'GET', 'Read optimization must never write saved progress')
      const fields = url.searchParams.get('select')
      return json(!exists ? [] : [fields === 'updated_at' ? { updated_at: revision } : { data: snapshot, updated_at: revision }])
    }
    if (url.pathname.endsWith('/question-bank')) return authorizationFailure ? json({ error: 'Unavailable' }, 503) : json({ bookmarkAllowedIndexes: [], vaultAllowedIndexes: [], legacySavedPracticeAllowed: false, activeSessionAllowed: false })
    throw new Error('Unexpected endpoint: ' + url.pathname)
  }) as typeof fetch
  const request = (user: string, hash?: unknown) => {
    const token = 'fixture.' + btoa(JSON.stringify({ role: 'authenticated', sub: user, exp: Date.now() / 1000 + 600 })) + '.fixture'
    return handler!(new Request('http://fixture.invalid/functions/v1/learning-progress', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'read', known_snapshot_hash: hash }) }))
  }
  try {
    await import('../functions/learning-progress/index.ts')
    const initial = await (await request(userA)).json()
    assert.equal(initial.data.activeSession.sessionId, 'saved-session')
    assert.match(initial.snapshot_hash, /^[0-9a-f]{64}$/)
    const response = await request(userA, initial.snapshot_hash)
    const unchangedText = await response.text()
    const unchanged = JSON.parse(unchangedText)
    assert.equal(unchanged.not_modified, true)
    assert.equal(Object.hasOwn(unchanged, 'data'), false)
    assert.equal(unchanged.updated_at, revision)
    assert.ok(unchangedText.length < JSON.stringify(initial).length / 2)
    assert.equal(response.headers.get('Cache-Control'), 'no-store')

    const otherUser = await (await request(userB, initial.snapshot_hash)).json()
    assert.ok(otherUser.data, 'Fingerprints are scoped to the authenticated account')
    assert.notEqual(otherUser.snapshot_hash, initial.snapshot_hash)
    revision = '2026-11-03T01:01:00.000Z'
    const changed = await (await request(userA, initial.snapshot_hash)).json()
    assert.ok(changed.data, 'A new revision must deliver a full snapshot')
    assert.notEqual(changed.snapshot_hash, initial.snapshot_hash)
    const invalidHash = await (await request(userA, { invalid: true })).json()
    assert.ok(invalidHash.data)

    entitled = false
    const expired = await (await request(userA, changed.snapshot_hash)).json()
    assert.ok(expired.data, 'License expiry must re-sanitize even when DB revision is unchanged')
    assert.equal(expired.data.activeSession, null)
    assert.deepEqual(JSON.parse(expired.data.storage['hyperion-bookmarks']).state.items, [])
    assert.equal(expired.data.storage['hyperion-history'], 'saved history')
    assert.notEqual(expired.snapshot_hash, changed.snapshot_hash)
    authorizationFailure = true
    assert.equal((await request(userA, expired.snapshot_hash)).status, 503)
    authorizationFailure = false
    entitlementFailure = true
    assert.equal((await request(userA, expired.snapshot_hash)).status, 503)
    entitlementFailure = false
    exists = false
    const missing = await (await request(userA, expired.snapshot_hash)).json()
    assert.equal(missing.data, null)
    assert.equal(missing.updated_at, null)
    assert.notEqual(missing.not_modified, true)
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(Deno, { serve: originalServe })
  }
})
