import assert from 'node:assert/strict'

type Handler = (req: Request) => Promise<Response>
Deno.test('saved-data service scopes recovery and audits, preserves expired-owner backups, and gates reads', async () => {
  const userA = '11111111-1111-4111-8111-111111111111'
  const userB = '22222222-2222-4222-8222-222222222222'
  const originalFetch = globalThis.fetch
  const originalServe = Deno.serve
  let handler: Handler | undefined
  let active = true
  let historical = true
  const rows = new Map<string, unknown>()
  const calls: { url: URL; body: any }[] = []
  const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } })
  Object.assign(Deno, { serve: (fn: Handler) => { handler = fn; return {} } })
  Deno.env.set('SUPABASE_URL', 'http://fixture.invalid')
  Deno.env.set('SUPABASE_ANON_KEY', 'fixture-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service')
  Deno.env.set('ADMIN_EMAILS', '')
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init)
    const url = new URL(req.url)
    const body = req.method === 'GET' ? null : JSON.parse(await req.text() || 'null')
    calls.push({ url, body })
    if (url.pathname.endsWith('/entitlements')) return json((url.searchParams.has('status') ? active : historical) ? [{ track_id: 'DECK_OIC_NW' }] : [])
    if (url.pathname.endsWith('/google_play_entitlements')) return json([])
    if (url.pathname.endsWith('/rpc/recover_learning_progress_collections')) return json({ found: true, applied: true })
    if (url.pathname.endsWith('/question-bank')) return json({ bookmarkAllowedIndexes: [], vaultAllowedIndexes: [], legacySavedPracticeAllowed: false, activeSessionAllowed: false })
    if (url.pathname.endsWith('/user_learning_session_archives')) {
      if (req.method === 'GET') {
        const key = url.searchParams.get('user_id')?.replace('eq.', '') + ':' + url.searchParams.get('session_id')?.replace('eq.', '')
        const data = rows.get(key)
        return json(data ? [{ data }] : [])
      }
      rows.set(body.user_id + ':' + body.session_id, body.data)
      return new Response(null, { status: 201 })
    }
    throw new Error('Unexpected test endpoint: ' + url.pathname)
  }) as typeof fetch
  const token = (id: string, expired = false) => 'fixture.' + btoa(JSON.stringify({ role: 'authenticated', sub: id, exp: Date.now() / 1000 + (expired ? -60 : 600) })).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_') + '.fixture'
  const request = (id: string, body: unknown, expired = false) => handler!(new Request('http://fixture.invalid/functions/v1/learning-progress', { method: 'POST', headers: { Authorization: 'Bearer ' + token(id, expired), 'Content-Type': 'application/json' }, body: JSON.stringify(body) }))
  try {
    await import('../functions/learning-progress/index.ts')
    assert.ok(handler)
    const snapshot = { sessionId: 'audit-1', track: 'DECK_OIC_NW', startedAt: 1, finished: true, questions: [{ id: 'q1', track: 'DECK_OIC_NW', questionText: 'Fixture question', options: ['A', 'B'], correctAnswerIndex: 1 }], answers: { q1: { selectedIndex: 0, isCorrect: false } } }
    let response = await request(userA, { action: 'write-session', sessionId: 'audit-1', snapshot, userId: userB })
    assert.equal(response.status, 200)
    assert.ok(rows.has(userA + ':audit-1'))
    assert.equal(rows.has(userB + ':audit-1'), false)
    response = await request(userB, { action: 'read-session', sessionId: 'audit-1', userId: userA })
    assert.equal((await response.json()).snapshot, null)
    response = await request(userA, { action: 'read-session', sessionId: 'audit-1' })
    assert.equal((await response.json()).snapshot.answers.q1.selectedIndex, 0)
    active = false
    response = await request(userA, { action: 'read-session', sessionId: 'audit-1' })
    assert.equal((await response.json()).snapshot, null, 'Expired ownership cannot open paid content')
    assert.ok(rows.has(userA + ':audit-1'), 'Denied reads do not delete the archive')
    response = await request(userA, { action: 'write-session', sessionId: 'audit-2', snapshot: { ...snapshot, sessionId: 'audit-2' } })
    assert.equal(response.status, 200, 'An owner can back up offline work after expiry without granting read access')
    historical = false
    response = await request(userB, { action: 'write-session', sessionId: 'audit-3', snapshot: { ...snapshot, sessionId: 'audit-3' } })
    assert.equal(response.status, 403)
    response = await request(userA, { action: 'recover-saved', userId: userB })
    assert.equal(response.status, 200)
    const rpc = calls.findLast(call => call.url.pathname.endsWith('/rpc/recover_learning_progress_collections'))
    assert.equal(rpc?.body.p_user_id, userA)
    const count = calls.length
    response = await request(userA, { action: 'read-session', sessionId: 'audit-1' }, true)
    assert.equal(response.status, 401)
    assert.equal(calls.length, count)
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(Deno, { serve: originalServe })
  }
})
