import assert from 'node:assert/strict'

type Handler = (request: Request) => Promise<Response>

Deno.test('incremental progress section API authenticates, sanitizes, acknowledges and isolates users', async () => {
  const user = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const originalFetch = globalThis.fetch
  const originalServe = Deno.serve
  let handler: Handler | undefined
  let entitled = true
  let historical = true
  let failRpc = false
  const rpcCalls: { path: string; body: Record<string, unknown> }[] = []
  const question = { id: 'q1', track: 'DECK_OIC_NW', questionText: 'Synthetic only',
    options: ['A', 'B'], correctAnswerIndex: 0, savedAt: 100 }
  const bookmark = JSON.stringify({ version: 0, state: { items: [question] } })
  const versions = { 'hyperion-bookmarks': 'a'.repeat(32), 'hyperion-history': 'b'.repeat(32) }
  const json = (result: unknown, status = 200) => Response.json(result, { status })

  Object.assign(Deno, { serve: (fn: Handler) => { handler = fn; return {} } })
  Deno.env.set('SUPABASE_URL', 'http://fixture.invalid')
  Deno.env.set('SUPABASE_ANON_KEY', 'fixture-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service')
  Deno.env.set('ADMIN_EMAILS', '')

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    if (url.pathname.endsWith('/entitlements')) {
      return json((url.searchParams.has('status') ? entitled : historical)
        ? [{ track_id: 'DECK_OIC_NW' }] : [])
    }
    if (url.pathname.endsWith('/rpc/get_learning_progress_owned_tracks')) {
      const input = JSON.parse(await req.text())
      assert.equal(input.p_user_id,user,'Historical ownership must bind gateway-verified account')
      return json(historical ? [{track_id:'DECK_OIC_NW'}] : [])
    }
    if (url.pathname.endsWith('/google_play_entitlements')) return json([])
    if (url.pathname.endsWith('/question-bank')) return json({
      bookmarkAllowedIndexes: [], vaultAllowedIndexes: [],
      legacySavedPracticeAllowed: false, activeSessionAllowed: false
    })
    if (url.pathname.includes('/rpc/')) {
      const body = JSON.parse(await req.text())
      rpcCalls.push({ path: url.pathname, body })
      if (failRpc) return json({ code: 'PGRST202', message: 'RPC unavailable' }, 404)
      if (url.pathname.endsWith('/read_learning_progress_sections')) return json({
        storage: { 'hyperion-bookmarks': bookmark, 'hyperion-history': '{"version":0,"state":{"entries":[]}}' },
        versions, updated_at: '2026-11-11T00:00:00.000Z'
      })
      if (url.pathname.endsWith('/write_learning_progress_sections')) return json({
        ok: true, operation_id: body.p_operation_id, versions: { 'hyperion-bookmarks': 'c'.repeat(32) },
        updated_at: '2026-11-11T00:01:00.000Z'
      })
    }
    throw new Error('Unexpected external request: ' + url.pathname)
  }) as typeof fetch

  const request = (action: Record<string, unknown>, account = user) => {
    const token = 'fixture.' + btoa(JSON.stringify({
      role: 'authenticated', sub: account, exp: Date.now() / 1000 + 600
    })) + '.fixture'
    return handler!(new Request('http://fixture.invalid/functions/v1/learning-progress', {
      method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...action, userId: other })
    }))
  }
  const operation_id = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const update = { key: 'hyperion-bookmarks', value: bookmark, expected_version: versions['hyperion-bookmarks'] }
  try {
    await import('../functions/learning-progress/index.ts')
    assert.equal((await handler!(new Request('http://fixture.invalid', {
      method: 'POST', body: JSON.stringify({ action: 'read-sections', keys: ['hyperion-bookmarks'] })
    }))).status, 401)
    const read = await request({ action: 'read-sections', keys: ['hyperion-bookmarks','hyperion-history'] })
    assert.equal(read.status, 200)
    const initial = await read.json()
    assert.equal(initial.versions['hyperion-bookmarks'], versions['hyperion-bookmarks'])
    assert.equal(JSON.parse(initial.storage['hyperion-bookmarks']).state.items.length, 1)
    assert.equal(rpcCalls[0].body.p_user_id, user, 'Never trust userId supplied by the client')

    entitled = false
    const revokedRead = await (await request({ action: 'read-sections', keys: ['hyperion-bookmarks'],
      known_versions: { 'hyperion-bookmarks': versions['hyperion-bookmarks'] } })).json()
    assert.deepEqual(JSON.parse(revokedRead.storage['hyperion-bookmarks']).state.items, [],
      'Even a matching storage version must not bypass revoked-license filtering')
    entitled = true
    const shortRead = await (await request({ action: 'read-sections', keys: ['hyperion-history'],
      known_versions: { 'hyperion-history': versions['hyperion-history'] } })).json()
    assert.equal(Object.hasOwn(shortRead.storage, 'hyperion-history'), false,
      'Known non-question sections can avoid repeat network payloads')

    const recorded = rpcCalls.length
    assert.equal((await request({ action: 'write-sections', operation_id,
      updates: [{ ...update, key: 'malicious-storage' }] })).status, 400)
    assert.equal(rpcCalls.length, recorded, 'Invalid input must never call write RPC')
    const sent = await request({ action: 'write-sections', operation_id, updates: [update] })
    assert.equal(sent.status, 200)
    assert.equal((await sent.json()).operation_id, operation_id)
    const writeCall = rpcCalls.at(-1)!
    assert.equal(writeCall.body.p_user_id,user)
    assert.equal((writeCall.body.p_updates as {key:string}[])[0].key, 'hyperion-bookmarks')
    const beforeRevoked = rpcCalls.length
    historical = false
    assert.equal((await request({ action: 'write-sections', operation_id: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',
      updates: [update] })).status,403)
    assert.equal(rpcCalls.length,beforeRevoked,'Unlicensed free accounts do not create cloud delta writes')
    historical = true

    failRpc = true
    assert.equal((await request({ action: 'write-sections', operation_id: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc',
      updates: [update] })).status,503, 'Missing migration must fail closed, preserving local outbox')
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(Deno, { serve: originalServe })
  }
})
