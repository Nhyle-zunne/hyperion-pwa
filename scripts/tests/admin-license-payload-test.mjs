import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { gunzipSync } from 'node:zlib'

const require = createRequire(import.meta.url)
const compile = path => ts.transpileModule(readFileSync(new URL('../../' + path, import.meta.url), 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX }
}).outputText
const codes = ['oic_nw', 'gmdss', 'engine_ew', 'deck_mgt', 'engine_mgt']
const userId = '11111111-1111-4111-8111-111111111111'
const adminEmail = 'admin@fixture.invalid'
const accounts = Array.from({ length: 12 }, (_, i) => ({ id: i ? 'free-' + i : userId, email: `user${i}@fixture.invalid`, created_at: '2025-01-01T00:00:00Z', user_metadata: { full_name: `Member ${i}` } }))
const row = (product_code, status, expires_at) => ({ id: product_code, user_id: userId, product_code, track_id: product_code, status, expires_at, license_term: 'month', granted_at: '2025-01-01T00:00:00Z', renewed_at: null, order_id: null })
const website = [row('oic_nw', 'active', '2099-01-01T00:00:00Z'), row('gmdss', 'active', '2025-01-01T00:00:00Z'), row('engine_ew', 'revoked', '2099-01-01T00:00:00Z'), row('deck_mgt', 'active', null)]
const play = [{ ...row('oic_nw', 'active', '2099-02-01T00:00:00Z'), updated_at: '2025-01-01T00:00:00Z' }]
let email = adminEmail, authFails = false, dbReads = 0, authReads = 0, writes = 0, handler
const originalFetch = globalThis.fetch
globalThis.fetch = async (input, init) => {
  const req = new Request(input, init), url = new URL(req.url)
  const json = (data, status = 200) => Response.json(data, { status })
  if (url.pathname === '/auth/v1/user') {
    authReads++
    return authFails ? json({ message: 'Invalid token' }, 401) : json({ id: 'admin-fixture', email })
  }
  dbReads++
  if (req.method !== 'GET') { writes++; throw new Error('Unexpected mutation') }
  if (url.pathname === '/auth/v1/admin/users/' + userId) return json({ user: accounts[0] })
  if (url.pathname === '/auth/v1/admin/users') return json({ users: accounts, aud: 'authenticated' })
  if (url.pathname.endsWith('/google_play_entitlements')) return json(play)
  if (url.pathname.endsWith('/entitlements')) return json(url.searchParams.has('product_code') ? website[0] : website)
  if (url.pathname.endsWith('/license_admin_audit') || url.pathname.endsWith('/user_activity') || url.pathname.endsWith('/orders') || url.pathname.endsWith('/checkout_batches')) return json([])
  throw new Error('Unexpected request ' + req.url)
}
const env = { SUPABASE_URL: 'http://fixture.invalid', SUPABASE_ANON_KEY: 'fixture-anon', SUPABASE_SERVICE_ROLE_KEY: 'fixture-service', ADMIN_EMAILS: adminEmail }
try {
  const context = { require: name => require(name.replace('npm:', '').replace('@2', '')), exports: {}, Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } }, Request, Response, Headers, Blob, CompressionStream, TextEncoder, console, URL, setTimeout, clearTimeout }
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
  assert.equal(compact.licenseFormat, 'owned-only', 'Compact responses identify omitted unowned defaults')
  assert.equal(legacy.licenseFormat, undefined, 'Legacy response contract is unchanged')
  assert.equal(legacy.users.length, accounts.length)
  assert.equal(compact.users.length, accounts.length, 'Compaction must not truncate accounts')
  assert.equal(Object.keys(compact.users[1].licenses).length, 0)
  assert.equal(Object.keys(compact.users[0].licenses).length, 4, 'Expired and revoked records remain present')
  assert.equal(compact.users[0].licenses.oic_nw.has_active_google_play, true)
  assert.equal(compact.users[0].licenses.oic_nw.source, 'google_play+website')
  assert.deepEqual(codes.map(code => legacy.users[0].licenses[code].status), ['active', 'expired', 'revoked', 'expired', 'none'])
  assert.ok(Buffer.byteLength(compactText) < Buffer.byteLength(legacyText) * 0.5, 'Sparse accounts reduce uncompressed response bytes by over 50%')
  const ui = { exports: {}, require: () => ({}), console }
  vm.runInNewContext(compile('src/screens/AdminLicensesScreen.tsx'), ui)
  const hydrate = ui.exports.hydrateManagedUser
  assert.equal(typeof hydrate, 'function')
  const restored = compact.users.map(hydrate)
  assert.deepEqual(JSON.parse(JSON.stringify(restored)), legacy.users, 'Compact data restores the complete legacy UI state, counts, filters, and action inputs')
  assert.deepEqual(JSON.parse(JSON.stringify(legacy.users.map(hydrate))), legacy.users, 'Updated UI accepts old backend responses')
  let hook = 0, storedUsers
  const loads = [], calls = []
  const react = {
    useState: initial => { const index = hook++; return [initial, value => { if (index === 0) storedUsers = value }] },
    useCallback: fn => fn, useMemo: fn => fn(), useEffect: fn => fn()
  }
  const mounted = { exports: {}, require: name => {
    if (name === 'react') return react
    if (name === 'react/jsx-runtime') return { jsx: () => null, jsxs: () => null }
    if (name.endsWith('/pageLoading')) return { withPageLoading: (_label, fn) => { const task = fn(); loads.push(task); return task } }
    if (name.endsWith('/supabase')) return { supabase: { functions: { invoke: async (_name, options) => { calls.push(options.body); return { data: compact, error: null } } } } }
    return {}
  }, console }
  vm.runInNewContext(compile('src/screens/AdminLicensesScreen.tsx'), mounted)
  mounted.exports.default()
  await Promise.all(loads)
  assert.deepEqual(JSON.parse(JSON.stringify(calls)), [{ action: 'list', compact: true }], 'The screen opts in on initial and subsequent loads')
  assert.deepEqual(JSON.parse(JSON.stringify(storedUsers)), legacy.users, 'The screen stores hydrated records before rendering controls')
  for (const value of [false, 'true', 1]) {
    assert.equal(Object.keys((await (await send({ action: 'list', compact: value })).json()).users[1].licenses).length, 5, 'Only boolean true opts in')
  }
  assert.match(legacyResponse.headers.get('Cache-Control'), /no-store/)
  assert.match(compactResponse.headers.get('Cache-Control'), /private/)
  const compressed = await send({ action: 'list' }, { 'Accept-Encoding': 'br, gzip;q=0.8' })
  assert.equal(compressed.headers.get('Content-Encoding'), 'gzip')
  assert.match(compressed.headers.get('Vary'), /Origin/)
  assert.match(compressed.headers.get('Vary'), /Accept-Encoding/)
  assert.deepEqual(JSON.parse(gunzipSync(Buffer.from(await compressed.arrayBuffer())).toString()), legacy)
  for (const encoding of ['gzip;q=0', 'br', 'gzip;q=invalid']) {
    assert.equal((await send({ action: 'list' }, { 'Accept-Encoding': encoding })).headers.get('Content-Encoding'), null, 'Respect encoding negotiation: ' + encoding)
  }
  assert.equal((await send({ action: 'revoke', userId, productCode: 'oic_nw', compact: true })).status, 409, 'Google Play still protects active access from revocation')
  assert.equal(writes, 0)
  const readsBeforeDenied = dbReads
  email = 'member@fixture.invalid'
  assert.equal((await send({ action: 'list', compact: true })).status, 403)
  authFails = true
  assert.equal((await send({ action: 'list', compact: true })).status, 401)
  assert.equal(dbReads, readsBeforeDenied, 'Denied requests never read privileged account data')
  assert.equal((await handler(new Request('http://fixture.invalid/admin-license-management', { method: 'POST', body: JSON.stringify({ action: 'list', compact: true }) }))).status, 401, 'Compact requests still require a bearer token')
  assert.equal(dbReads, readsBeforeDenied)
  console.log(`Admin license payload tests passed: ${Buffer.byteLength(legacyText)} → ${Buffer.byteLength(compactText)} bytes (${Math.round(100 * (1 - Buffer.byteLength(compactText) / Buffer.byteLength(legacyText)))}% smaller).`)
} finally {
  globalThis.fetch = originalFetch
}
