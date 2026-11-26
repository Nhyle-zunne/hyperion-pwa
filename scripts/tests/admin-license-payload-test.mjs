import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const compile = path => ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText
const codes = ['oic_nw', 'gmdss', 'engine_ew', 'deck_mgt', 'engine_mgt']
const userId = '11111111-1111-4111-8111-111111111111'
const adminEmail = 'admin@fixture.invalid'
const accounts = Array.from({ length: 381 }, (_, i) => ({ id: i ? 'free-' + i : userId, email: `user${i}@fixture.invalid`, created_at: '2025-01-01T00:00:00Z', user_metadata: { full_name: `Member ${i}` } }))
const row = (product_code, status, expires_at) => ({ id: product_code, user_id: userId, product_code, track_id: product_code, status, expires_at, license_term: 'month', granted_at: '2025-01-01T00:00:00Z', renewed_at: null, order_id: null })
const website = [row('oic_nw', 'active', '2099-01-01T00:00:00Z'), row('gmdss', 'active', '2025-01-01T00:00:00Z'), row('engine_ew', 'revoked', '2099-01-01T00:00:00Z'), row('deck_mgt', 'active', null)]
const play = [{ ...row('oic_nw', 'active', '2099-02-01T00:00:00Z'), updated_at: '2025-01-01T00:00:00Z' }]
const lifetime = ['admin', 'paymongo'].map(provider => ({
  id: provider, user_id: userId, product_code: 'oic_nw', track_id: 'DECK_OIC_NW',
  provider, status: 'active', purchased_at: '2025-01-01T00:00:00Z'
}))
const manualChanges = []
const diagnosticErrors = []
const diagnosticSteps = []
let email = adminEmail, authFails = false, failDependency = false, explodeDependency = false, dbReads = 0, authReads = 0, writes = 0, handler
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init), url = new URL(req.url)
  const json = (data, status = 200) => Response.json(data, { status })
  if (url.pathname === '/auth/v1/user') {
    authReads++
    return authFails ? json({ message: 'Invalid token' }, 401) : json({ id: 'admin-fixture', email })
  }
  dbReads++
  if (url.pathname.endsWith('/rpc/set_admin_lifetime_entitlement') && req.method === 'POST') {
    const change = await req.json()
    manualChanges.push(change)
    lifetime[0].status = change.p_active ? 'active' : 'revoked'
    return json(true)
  }
  if (req.method !== 'GET') { writes++; throw new Error('Unexpected mutation') }
  if (url.pathname === '/auth/v1/admin/users/' + userId) return json({ user: accounts[0] })
  if (url.pathname === '/auth/v1/admin/users') return json({ users: accounts, aud: 'authenticated' })
  if (url.pathname.endsWith('/lifetime_entitlements')) return json(lifetime)
  if (url.pathname.endsWith('/google_play_entitlements')) return json(play)
  if (url.pathname.endsWith('/entitlements')) return json(url.searchParams.has('product_code') ? website[0] : website)
  if (url.pathname.endsWith('/user_activity') && explodeDependency) return json([{ user_id: accounts[1].id, last_accessed_at: '+275760-09-13T00:00:00.000Z' }])
  if (url.pathname.endsWith('/user_activity') && failDependency) return json({ code: 'PGRST100', message: 'fixture private details must not be logged' }, 400)
  if (url.pathname.endsWith('/license_admin_audit') || url.pathname.endsWith('/user_activity') || url.pathname.endsWith('/orders') || url.pathname.endsWith('/checkout_batches') || url.pathname.endsWith('/manual_checkout_claims')) return json([])
  throw new Error('Unexpected request ' + req.url)
}
const env = { SUPABASE_URL: 'http://fixture.invalid', SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', ADMIN_EMAILS: adminEmail }
try {
  const context = { require: name => require(name.replace('npm:', '').replace('@2', '')), exports: {}, Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } }, Request, Response, Headers, Blob, CompressionStream, TextEncoder, console: { log: console.log, info: (...args) => diagnosticSteps.push(args.join(' ')), error: (...args) => diagnosticErrors.push(args.join(' ')) }, URL, setTimeout, clearTimeout }
  vm.runInNewContext(compile('supabase/functions/admin-license-management/index.ts'), context)
  const send = async (body, headers = {}) => {
    const before = authReads
    const response = await handler(new Request('http://fixture.invalid/admin-license-management', { method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) }))
    assert.equal(authReads, before + 1, 'Every request verifies the current user before privileged reads')
    return response
  }
  const legacyResponse = await send({ action: 'list' })
  const legacyText = await legacyResponse.text(), legacy = JSON.parse(legacyText)
  const compactResponse = await send({ action: 'list', compact: true })
  const compactText = await compactResponse.text(), compact = JSON.parse(compactText)
  assert.ok(diagnosticSteps.some(message => message.endsWith('list.start')), 'Authorized list requests leave a start breadcrumb')
  assert.ok(diagnosticSteps.some(message => message.endsWith('list.dependencies-loaded')), 'Completed database work leaves a breadcrumb')
  assert.ok(diagnosticSteps.some(message => message.endsWith('list.ready')), 'Completed response shaping leaves a breadcrumb')
  assert.doesNotMatch(diagnosticSteps.join(' '), /@fixture\.invalid/, 'Diagnostic milestones never log customer data')
  assert.equal(compact.licenseFormat, 'owned-only', 'Compact responses identify omitted unowned defaults')
  assert.equal(legacy.licenseFormat, undefined, 'Legacy response contract is unchanged')
  assert.equal(legacy.users.length, accounts.length)
  assert.equal(compact.users.length, accounts.length, 'Compaction must not truncate accounts')
  assert.equal(Object.keys(compact.users[1].licenses).length, 0)
  assert.equal(Object.keys(compact.users[0].licenses).length, 4, 'Expired and revoked records remain present')
  assert.equal(compact.users[0].licenses.oic_nw.has_active_google_play, true)
  assert.equal(compact.users[0].licenses.oic_nw.source, 'admin_lifetime+google_play+paymongo_lifetime+website')
  assert.equal(compact.users[0].licenses.oic_nw.license_term, 'lifetime')
  assert.equal(compact.users[0].licenses.oic_nw.expires_at, null)
  assert.equal(compact.users[0].licenses.oic_nw.has_manual_lifetime, true)
  assert.equal(compact.users[0].licenses.oic_nw.has_purchased_lifetime, true)
  assert.equal(compact.users[0].licenses.oic_nw.has_revocable_website, true)
  assert.deepEqual(codes.map(code => legacy.users[0].licenses[code].status), ['active', 'expired', 'revoked', 'expired', 'none'])
  assert.ok(Buffer.byteLength(compactText) < Buffer.byteLength(legacyText) * 0.5, 'Sparse accounts reduce uncompressed response bytes by over 50%')
  const ui = { exports: {}, require: () => ({}), console }
  vm.runInNewContext(compile('src/screens/AdminLicensesScreen.tsx'), ui)
  const hydrate = ui.exports.hydrateManagedUser
  assert.equal(typeof hydrate, 'function')
  const restored = compact.users.map(hydrate)
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), legacy.users, 'Compact data restores the complete legacy UI state, counts, filters, and action inputs')
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.users.map(hydrate))), legacy.users, 'Updated UI accepts old backend responses')
  let hook = 0, storedUsers, editorUser
  const loads = [], calls = []
  const react = {
    useState: initial => {
      const index = hook++
      const editorState = { 0: [editorUser], 1: userId, 8: { [userId + ':oic_nw']: 'lifetime' }, 11: false, 12: true }
      return [editorUser && index in editorState ? editorState[index] : initial, value => { if (index === 0) storedUsers = value }]
    },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => { if (!editorUser) fn() }
  }
  const mounted = { exports: {}, require: name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return require(name)
    if (name === 'react-dom') return { createPortal: children => children }
    if (name.endsWith('/AdminNavigation')) return { default: () => null }
    if (name.endsWith('/pageLoading')) return { withPageLoading: (_label, fn) => { const task = fn(); loads.push(task); return task } }
    if (name.endsWith('/supabase')) return { supabase: { functions: { invoke: async (_name, options) => { calls.push(options.body); return { data: compact, error: null } } } } }
    return {}
  }, console, document: { body: {} } }
  vm.runInNewContext(compile('src/screens/AdminLicensesScreen.tsx'), mounted)
  mounted.exports.default()
  await Promise.all(loads)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ action: 'list', compact: true }], 'The screen opts in on initial and subsequent loads')
  assert.deepEqual(JSON.parse(JSON.stringify(storedUsers)), legacy.users, 'The screen stores hydrated records before rendering controls')
  const renderLicenseEditor = user => {
    hook = 0
    editorUser = user
    return require('react-dom/server').renderToStaticMarkup(mounted.exports.default())
      .split('class="admin-license-tile"')[1]
  }
  const activeEditor = renderLicenseEditor(restored[0])
  assert.doesNotMatch(activeEditor, />GRANT LIFETIME<|<option value="lifetime"/)
  assert.match(activeEditor, />REVOKE LIFETIME GRANT</)
  assert.match(activeEditor, /<option value="month" selected="">1 Month<\/option>/)
  editorUser = null
  for (const value of [false, 'true', 1]) {
    assert.equal(Object.keys((await (await send({ action: 'list', compact: value })).json()).users[1].licenses).length, 5, 'Only boolean true opts in')
  }
  assert.match(legacyResponse.headers.get('Cache-Control'), /no-store/)
  assert.match(compactResponse.headers.get('Cache-Control'), /private/)
  const browserResponse = await send({ action: 'list', compact: true }, { 'Accept-Encoding': 'gzip, br' })
  assert.equal(browserResponse.headers.get('Content-Encoding'), null, 'Large admin lists must not use manually compressed Edge Function responses')
  assert.equal((await browserResponse.json()).users.length, accounts.length, 'Browser-compatible JSON must retain every registered account')
  const browserLegacy = await send({ action: 'list' }, { 'Accept-Encoding': 'br, gzip;q=0.8' })
  assert.equal(browserLegacy.headers.get('Content-Encoding'), null)
  assert.match(browserLegacy.headers.get('Vary'), /Origin/)
  assert.deepEqual(await browserLegacy.json(), legacy)
  context.CompressionStream = undefined
  const withoutStreamCompression = await send({ action: 'list', compact: true }, { 'Accept-Encoding': 'gzip' })
  assert.equal(withoutStreamCompression.status, 200, 'Large account lists must load without streaming compression support')
  assert.equal(withoutStreamCompression.headers.get('Content-Encoding'), null)
  assert.equal((await withoutStreamCompression.json()).users.length, accounts.length)
  for (const encoding of ['gzip;q=0', 'br', 'gzip;q=invalid']) {
    assert.equal((await send({ action: 'list' }, { 'Accept-Encoding': encoding })).headers.get('Content-Encoding'), null, 'Respect encoding negotiation: ' + encoding)
  }
  assert.equal((await send({ action: 'revoke', userId, productCode: 'oic_nw', compact: true })).status, 409, 'Google Play still protects active access from revocation')
  assert.equal((await send({ action: 'revoke', userId, productCode: 'oic_nw', term: 'lifetime' })).status, 200)
  const afterRevoke = (await (await send({ action: 'list', compact: true })).json()).users[0].licenses.oic_nw
  assert.equal(afterRevoke.has_manual_lifetime, false)
  assert.equal(afterRevoke.has_purchased_lifetime, true)
  assert.equal(afterRevoke.status, 'active')
  const revokedEditor = renderLicenseEditor(hydrate({
    ...restored[0], licenses: { ...restored[0].licenses, oic_nw: afterRevoke }
  }))
  assert.match(revokedEditor, />GRANT LIFETIME</)
  assert.doesNotMatch(revokedEditor, />REVOKE LIFETIME GRANT</)
  editorUser = null
  assert.equal((await send({ action: 'grant', userId, productCode: 'oic_nw', term: 'lifetime', note: 'Test grant' })).status, 200)
  assert.deepEqual(manualChanges, [
    { p_user_id: userId, p_product_code: 'oic_nw', p_active: false, p_admin_user_id: 'admin-fixture', p_admin_email: adminEmail, p_note: null },
    { p_user_id: userId, p_product_code: 'oic_nw', p_active: true, p_admin_user_id: 'admin-fixture', p_admin_email: adminEmail, p_note: 'Test grant' },
  ])
  assert.equal(writes, 0)
  failDependency = true
  assert.equal((await send({ action: 'list', compact: true })).status, 500)
  assert.match(diagnosticErrors.at(-1), /Could not load last website activity/, 'A handled server failure records its safe stage')
  assert.doesNotMatch(diagnosticErrors.at(-1), /fixture private details/)
  failDependency = false
  explodeDependency = true
  await assert.rejects(send({ action: 'list', compact: true }), /Invalid time value/)
  assert.match(diagnosticErrors.at(-1), /shape-users.*RangeError/, 'An unexpected exception records its stage and error type')
  assert.doesNotMatch(diagnosticErrors.at(-1), /@fixture\.invalid/)
  context.Date = class PrivateErrorDate extends Date {
    toISOString() {
      const error = new Error('intentional date failure')
      error.name = 'private-person@fixture.invalid'
      throw error
    }
  }
  try {
    await assert.rejects(send({ action: 'list', compact: true }), /intentional date failure/)
    assert.match(diagnosticErrors.at(-1), /shape-users.*unknown/, 'Unrecognized error names are replaced with a fixed label')
    assert.doesNotMatch(diagnosticErrors.at(-1), /private-person@fixture\.invalid/, 'Exception names cannot leak customer identifiers')
  } finally {
    delete context.Date
  }
  explodeDependency = false
  assert.equal(typeof context.json, 'function')
  const directFailure = context.json(new Request('http://fixture.invalid/admin-license-management'), { error: 'private-person@fixture.invalid' }, 500)
  assert.equal(directFailure.status, 500)
  assert.doesNotMatch(diagnosticErrors.at(-1), /private-person@fixture\.invalid/, 'A future dynamic error response cannot leak through central diagnostics')
  const readsBeforeDenied = dbReads
  email = 'member@fixture.invalid'
  assert.equal((await send({ action: 'list', compact: true })).status, 403)
  assert.equal((await send({ action: 'grant', userId, productCode: 'oic_nw', term: 'lifetime' })).status, 403)
  authFails = true
  assert.equal((await send({ action: 'list', compact: true })).status, 401)
  assert.equal(dbReads, readsBeforeDenied, 'Denied requests never read privileged account data')
  assert.equal((await handler(new Request('http://fixture.invalid/admin-license-management', { method: 'POST', body: JSON.stringify({ action: 'list', compact: true }) }))).status, 401, 'Compact requests still require a bearer token')
  assert.equal(dbReads, readsBeforeDenied)
  console.log(`Admin license payload tests passed: ${Buffer.byteLength(legacyText)} → ${Buffer.byteLength(compactText)} bytes (${Math.round(100 * (1 - Buffer.byteLength(compactText) / Buffer.byteLength(legacyText)))}% smaller).`)
} finally {
  globalThis.fetch = originalFetch
}
