import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import ts from 'typescript'

const ownerId = '11111111-1111-4111-8111-111111111111'
const orderId = '22222222-2222-4222-8222-222222222222'
const providerId = 'cs_historical_fixture'

function loadEndpoint(name, { signedIn = true, order = null, providerStatus = 'active' } = {}) {
  let handler
  const providerCalls = []
  const dbUpdates = []
  const env = {
    SUPABASE_URL: 'https://fixture.invalid',
    SUPABASE_ANON_KEY: 'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY: 'fixture-service',
    PAYMONGO_SECRET_KEY: 'sk_test_fixture',
    PAYMONGO_EXPECT_LIVEMODE: 'false',
  }

  const createClient = (_url, key) => key === env.SUPABASE_ANON_KEY ? {
    auth: { getUser: async () => ({ data: { user: signedIn ? { id: ownerId } : null }, error: null }) },
  } : {
    from(table) {
      assert.equal(table, 'lifetime_orders')
      let current = order
      let updated = false
      const builder = {
        select() { return this },
        eq(key, value) {
          if (key === 'id' && value !== orderId) current = null
          if (key === 'user_id' && value !== ownerId) current = null
          if (key === 'status' && value !== 'pending') current = null
          return this
        },
        update(value) { dbUpdates.push(value); updated = true; return this },
        async maybeSingle() { return { data: updated ? current && { id: current.id } : current, error: null } },
      }
      return builder
    },
  }

  const source = readFileSync(new URL(`../../supabase/functions/${name}/index.ts`, import.meta.url), 'utf8')
  const transpiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  runInNewContext(transpiled, {
    exports: {},
    require(specifier) {
      assert.equal(specifier, 'npm:@supabase/supabase-js@2')
      return { createClient }
    },
    Deno: { env: { get: key => env[key] }, serve: fn => { handler = fn } },
    Response, Request, AbortSignal, btoa, URL, Date, console,
    fetch: async (url, init) => {
      providerCalls.push({ url: String(url), method: init?.method || 'GET' })
      const sessionUrl = `https://api.paymongo.com/v1/checkout_sessions/${providerId}`
      if (url === sessionUrl) return Response.json({ data: {
        id: providerId,
        attributes: {
          status: providerStatus,
          reference_number: orderId,
          livemode: false,
          metadata: { kind: 'lifetime', user_id: ownerId, product_code: 'lifetime_oic' },
          payments: providerStatus === 'paid' ? [{ attributes: { status: 'paid' } }] : [],
        },
      } })
      assert.equal(url, `${sessionUrl}/expire`)
      assert.equal(init.method, 'POST')
      return Response.json({ ok: true })
    },
  }, { filename: name })

  return {
    providerCalls,
    dbUpdates,
    request: async (action, data = {}, authenticated = true) => {
      const response = await handler(new Request('https://fixture.invalid', {
        method: 'POST',
        headers: authenticated ? { Authorization: 'Bearer synthetic' } : {},
        body: JSON.stringify({ action, ...data }),
      }))
      return { status: response.status, body: await response.json() }
    },
  }
}

const regular = loadEndpoint('create-checkout')
assert.deepEqual(await regular.request('status'), {
  status: 200, body: { action: 'status', enabled: false, mode: null, reason: 'manual_only' },
})
assert.equal((await regular.request('create', { items: [{ productCode: 'oic_nw' }] })).status, 503)
assert.equal((await regular.request('create', {}, false)).status, 401)
assert.equal(regular.providerCalls.length, 0, 'Retired website checkout makes no provider calls')

const pendingOrder = {
  id: orderId, user_id: ownerId, product_code: 'lifetime_oic',
  paymongo_checkout_session_id: providerId, status: 'pending',
}
const lifetime = loadEndpoint('create-lifetime-checkout', { order: pendingOrder })
assert.deepEqual(await lifetime.request('status'), { status: 200, body: { enabled: false } })
assert.equal((await lifetime.request('create', { productCode: 'lifetime_oic' })).status, 503)
assert.equal(lifetime.providerCalls.length, 0, 'No provider request when a new Lifetime checkout is attempted')

const cancelled = await lifetime.request('cancel', { orderId })
assert.deepEqual(cancelled, { status: 200, body: { status: 'cancelled', orderId } })
assert.deepEqual(lifetime.providerCalls.map(call => call.method), ['GET', 'POST'])
assert.equal(lifetime.dbUpdates.length, 1)
assert.equal(lifetime.dbUpdates[0].status, 'cancelled')

const processing = loadEndpoint('create-lifetime-checkout', { order: pendingOrder, providerStatus: 'paid' })
assert.equal((await processing.request('cancel', { orderId })).status, 409)
assert.equal(processing.providerCalls.length, 1, 'Paid checkout is inspected but never expired')
assert.equal(processing.dbUpdates.length, 0, 'Paid checkout license history cannot be cancelled')

const someoneElse = loadEndpoint('create-lifetime-checkout', { order: pendingOrder, signedIn: false })
assert.equal((await someoneElse.request('cancel', { orderId })).status, 401)
assert.equal(someoneElse.providerCalls.length, 0)

console.log('PASS: new hosted payments retired; authenticated historical cancellation and paid-order protection preserved')
