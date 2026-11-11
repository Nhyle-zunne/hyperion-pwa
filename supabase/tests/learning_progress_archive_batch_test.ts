import assert from 'node:assert/strict'

type Handler = (req: Request) => Promise<Response>
Deno.test('archive batches authenticate owners and validate every item before one atomic write', async () => {
  const user = '11111111-1111-4111-8111-111111111111'
  const other = '22222222-2222-4222-8222-222222222222'
  const originalFetch = globalThis.fetch, originalServe = Deno.serve
  let handler: Handler | undefined
  let allowed = true, historical = false, writeFailure = false, rpcMissing = false, legacyUpserts = 0
  let ownedRpcMissing = false, ownedRpcFailure = false, ownedRpcReads = 0
  const writes: any[] = []
  let entitlementReads = 0
  const json = (value: unknown, status = 200) => Response.json(value, { status })
  Object.assign(Deno, { serve: (fn: Handler) => { handler = fn; return {} } })
  Deno.env.set('SUPABASE_URL', 'http://fixture.invalid')
  Deno.env.set('SUPABASE_ANON_KEY', 'fixture-anon')
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'fixture-service')
  Deno.env.set('ADMIN_EMAILS', '')
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const req = new Request(input, init), url = new URL(req.url)
    if (url.pathname.endsWith('/rpc/get_learning_progress_owned_tracks')) {
      ownedRpcReads++
      const args = JSON.parse(await req.text())
      assert.equal(args.p_user_id, user, 'Cloud storage ownership must be scoped to the gateway-verified account')
      if (ownedRpcMissing) return json({ code: 'PGRST202', message: 'Historical ownership function not yet deployed' }, 404)
      if (ownedRpcFailure) return json({ code: 'XX000', message: 'Backend unavailable' }, 503)
      return json((allowed || historical) ? [{ track_id: 'DECK_OIC_NW' }] : [])
    }
    if (url.pathname.endsWith('/entitlements')) {
      entitlementReads++
      // An active entitlement is always present in the complete historical query.
      // `historical` models ownership after expiry, while `allowed` is current.
      return json((url.searchParams.has('status') ? allowed : (allowed || historical)) ? [{ track_id: 'DECK_OIC_NW' }] : [])
    }
    if (url.pathname.endsWith('/google_play_entitlements')) return json([])
    if (url.pathname.endsWith('/question-bank')) return json({ bookmarkAllowedIndexes: [], vaultAllowedIndexes: [], legacySavedPracticeAllowed: false, activeSessionAllowed: false })
    if (url.pathname.endsWith('/rpc/upsert_learning_session_archives_if_changed')) {
      if (rpcMissing) return json({code:'PGRST202',message:'Function is not yet installed'},404)
      if (writeFailure) return json({message:'Unavailable'},503)
      const args = JSON.parse(await req.text())
      assert.equal(args.p_user_id,user)
      assert.ok(Array.isArray(args.p_sessions))
      writes.push(args.p_sessions.map((row: any) => ({...row,user_id:args.p_user_id})))
      return json(args.p_sessions.length)
    }
    if (url.pathname.endsWith('/user_learning_session_archives')) {
      legacyUpserts++
      const body = JSON.parse(await req.text())
      if (writeFailure) return json({ message: 'Unavailable' }, 503)
      writes.push(body)
      assert.equal(url.searchParams.get('on_conflict'), 'user_id,session_id')
      return new Response(null, { status: 201 })
    }
    throw Error('Unexpected endpoint ' + url.pathname)
  }) as typeof fetch
  const token = 'fixture.' + btoa(JSON.stringify({ role: 'authenticated', sub: user, exp: Date.now() / 1000 + 600 })) + '.fixture'
  const send = (sessions: unknown) => handler!(new Request('http://fixture.invalid/functions/v1/learning-progress', { method: 'POST', headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'write-sessions', sessions, userId: other }) }))
  const item = (id: string, track = 'DECK_OIC_NW') => ({ sessionId: id, snapshot: { sessionId: id, finished: true, track, answers: { q1: { selectedIndex: 1, isCorrect: true } }, questions: [{ id: 'q1', track, questionText: 'Fixture question', options: ['A', 'B'], correctAnswerIndex: 1 }] } })
  try {
    await import('../functions/learning-progress/index.ts')
    let response = await send([item('one'), item('two')])
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).sessionIds, ['one', 'two'])
    assert.equal(writes.length, 1)
    assert.equal(writes[0].length, 2)
    assert.ok(writes[0].every((row: any) => row.user_id === user))
    assert.equal(writes[0][1].data.answers.q1.selectedIndex, 1)
    assert.equal(ownedRpcReads, 1, 'Historical ownership uses just one private server-side request')
    assert.equal(entitlementReads, 0, 'No separate website entitlement read on the optimized path')

    const reads = entitlementReads
    for (const invalid of [[], Array.from({ length: 11 }, (_, i) => item('s' + i)), [item('same'), item('same')], [{ ...item('bad'), snapshot: item('different').snapshot }]]) {
      assert.equal((await send(invalid)).status, 400)
    }
    assert.equal(entitlementReads, reads, 'Malformed batches must fail before DB access')
    assert.equal(writes.length, 1)
    response = await send([item('allowed'), item('forbidden', 'GMDSS_GOC')])
    assert.equal(response.status, 403)
    assert.equal(writes.length, 1, 'A denied later item must not partially save earlier items')

    allowed = false; historical = true
    response = await send([item('expired-backup')])
    assert.equal(response.status, 200, 'Historical owners may back up work without gaining paid read access')
    historical = false
    assert.equal((await send([item('unowned')])).status, 403)
    assert.equal(writes.length, 2)
    allowed = true; writeFailure = true
    assert.equal((await send([item('retry-later')])).status, 503)
    assert.equal(writes.length, 2)
    assert.equal(legacyUpserts,0,'New deployments use the private conditional UPSERT')
    writeFailure = false; rpcMissing = true
    const fallback = await send([item('legacy-server')])
    assert.equal(fallback.status,200,'Rolling deployment fallback must keep older DBs working')
    assert.equal(legacyUpserts,1)
    assert.equal(writes.length,3)

    // Independently verify rollout compatibility when a new Edge deployment
    // reaches an older database that has neither RPC installed.
    ownedRpcMissing = true
    const legacyOwned = await send([item('older-database')])
    assert.equal(legacyOwned.status, 200, 'Old-DB fallback preserves paid user sessions')
    assert.equal(entitlementReads, 1, 'Fallback queries old entitlements once')
    assert.equal(writes.length, 4)

    // Any error other than missing RPC must fail closed. Otherwise a database
    // outage could silently authorize uploads without a verified ownership set.
    ownedRpcMissing = false; ownedRpcFailure = true
    const beforeFailure = writes.length
    assert.equal((await send([item('backend-failure')])).status, 503)
    assert.equal(writes.length, beforeFailure, 'Failed ownership checks never persist an archive')
  } finally {
    globalThis.fetch = originalFetch
    Object.assign(Deno, { serve: originalServe })
  }
})
