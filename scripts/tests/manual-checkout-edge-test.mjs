import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import ts from 'typescript'

const uid = '11111111-1111-4111-8111-111111111111'
const claimId = '33333333-3333-4333-8333-333333333333'
const compile = file => ts.transpileModule(readFileSync(new URL(`../../supabase/functions/${file}/index.ts`,import.meta.url),'utf8'),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},reportDiagnostics:true,
}).outputText

function fixture(file, email='buyer@example.invalid', initialClaimStatus='awaiting_proof') {
  let handler, calls=[]
  let signedIn = true
  let googleLinked = true
  let claimStatus = initialClaimStatus
  const createClient = (_url,key) => key === 'anon-key' ? {
    auth: { getUser: async()=>({data:{user:signedIn?{id:uid,email,identities:googleLinked?[{provider:'google'}]:[{provider:'email'}]}:null},error:signedIn?null:new Error('Signed out')}) },
  } : {
    from: table => {
      assert.equal(table, 'manual_checkout_claims')
      return { select: columns => {
        assert.equal(columns, 'status')
        return { eq: (_field,id) => {
          assert.equal(id, claimId)
          return { maybeSingle: async () => ({ data: { status: claimStatus }, error: null }) }
        } }
      } }
    },
    rpc: async (functionName,params) => {
      calls.push({functionName,params})
      if (functionName === 'create_manual_checkout_claim') return {data:{id:claimId,status:'awaiting_proof',total_amount_php:79},error:null}
      if (functionName === 'review_manual_checkout_claim') {
        if (params.p_action === 'proof_received' && claimStatus === 'awaiting_proof') {
          claimStatus = 'pending_verification'
          return {data:{ok:true,status:claimStatus},error:null}
        }
        if (params.p_action === 'approve' && claimStatus === 'pending_verification') {
          claimStatus = 'approved'
          return {data:{ok:true,status:claimStatus},error:null}
        }
        if (params.p_action === 'proof_received' || params.p_action === 'approve') return {data:null,error:{code:'23514'}}
      }
      throw Error('Unexpected RPC '+functionName)
    },
  }
  const env = { SUPABASE_URL:'http://fixture.invalid',SUPABASE_ANON_KEY:'anon-key',SUPABASE_SERVICE_ROLE_KEY:'service-key',ADMIN_EMAILS:'admin@example.invalid' }
  vm.runInNewContext(compile(file),{
    exports:{},require:name => { assert.equal(name,'npm:@supabase/supabase-js@2'); return {createClient} },
    Deno:{serve:fn=>{handler=fn},env:{get:name=>env[name]}},Response,Request,Headers,console,
  })
  const send = async (body,authenticated=true) => {
    const response = await handler(new Request('http://fixture.invalid/functions/v1/'+file,{
      method:'POST',headers:{...(authenticated?{Authorization:'Bearer fixture'}:{}),'Content-Type':'application/json'},
      body:JSON.stringify(body),
    }))
    return {status:response.status,data:await response.json()}
  }
  return {send,calls,signOut:()=>{signedIn=false},unlinkGoogle:()=>{googleLinked=false}}
}

function adminListFixture(metadata, identityName) {
  const customerId = '22222222-2222-4222-8222-222222222222'
  const claim = {
    id: claimId, user_id: customerId, items: [{ code: 'oic_nw', term: 'month', amountPhp: 50 }],
    total_amount_php: 50, status: 'awaiting_proof', created_at: '2026-11-25T00:00:00Z',
  }
  const order = {
    id: '44444444-4444-4444-8444-444444444444', user_id: customerId, product_code: 'oic_nw',
    status: 'pending', amount_php: 50, created_at: '2026-11-25T00:00:00Z', customer_name: null,
  }
  const owner = {
    id: customerId, email: 'seafarer@example.invalid', user_metadata: metadata,
    identities: identityName ? [{ provider: 'google', identity_data: { name: identityName } }] : [],
  }
  let handler
  const createClient = (_url, key) => key === 'anon-key'
    ? { auth: { getUser: async () => ({ data: { user: { id: uid, email: 'admin@example.invalid' } }, error: null }) } }
    : {
      auth: { admin: {
        listUsers: async () => ({ data: { users: [owner] }, error: null }),
        getUserById: async () => ({ data: { user: owner }, error: null }),
      } },
      from: table => ({
        update: () => ({ eq: () => ({ lte: async () => ({ error: null }) }) }),
        select: () => ({
          in: () => ({ order: () => ({
            range: async () => ({ data: table === 'manual_checkout_claims' ? [claim] : [], error: null }),
            limit: async () => ({ data: table === 'orders' ? [order] : [], error: null }),
          }) }),
          order: () => ({ limit: async () => ({ data: [], error: null }) }),
          eq: () => ({ maybeSingle: async () => ({ data: claim, error: null }) }),
        }),
      }),
    }
  const env = { SUPABASE_URL: 'http://fixture.invalid', SUPABASE_ANON_KEY: 'anon-key', SUPABASE_SERVICE_ROLE_KEY: 'service-key', ADMIN_EMAILS: 'admin@example.invalid' }
  vm.runInNewContext(compile('admin-payment-review'), {
    exports: {}, require: name => { assert.equal(name, 'npm:@supabase/supabase-js@2'); return { createClient } },
    Deno: { serve: fn => { handler = fn }, env: { get: name => env[name] } }, Response, Request, Headers, console,
  })
  return async action => {
    const response = await handler(new Request('http://fixture.invalid/functions/v1/admin-payment-review', {
      method: 'POST', headers: { Authorization: 'Bearer fixture', 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, claimId }),
    }))
    return { status: response.status, data: await response.json() }
  }
}

test('admin payments resolves the Google full name for pending and searched claims', async () => {
  const send = adminListFixture({ full_name: 'Boss Maria Santos', track_category: 'GMDSS' })
  const list = await send('list')
  assert.equal(list.status, 200)
  assert.equal(list.data.claims[0].customer_name, 'Boss Maria Santos')
  assert.equal(list.data.claims[0].track_category, 'GMDSS')
  assert.equal(list.data.orders[0].customer_name, 'Boss Maria Santos')
  assert.equal(list.data.orders[0].track_category, 'GMDSS')
  const found = await send('find-claim')
  assert.equal(found.status, 200)
  assert.equal(found.data.claim.customer_name, 'Boss Maria Santos')
  assert.equal(found.data.claim.track_category, 'GMDSS')
})

test('admin payments uses Google identity name when profile metadata is missing', async () => {
  const send = adminListFixture({}, 'Boss Juan Dela Cruz')
  const list = await send('list')
  assert.equal(list.status, 200)
  assert.equal(list.data.claims[0].customer_name, 'Boss Juan Dela Cruz')
  assert.equal(list.data.claims[0].track_category, null)
})

test('admin payments ignores arbitrary, non-category profile metadata', async () => {
  const send = adminListFixture({ full_name: 'Boss Test', track_category: 'ENGINE_OIC_EW' })
  assert.equal((await send('list')).data.claims[0].track_category, null)
})

test('claim endpoint derives owner from verified JWT, not spoofable request fields',async()=>{
  const edge=fixture('create-manual-checkout-claim')
  assert.equal((await edge.send({selection:'oic_nw:month'},false)).status,401)
  assert.equal(edge.calls.length,0)
  const response=await edge.send({selection:'oic_nw:month',userId:'22222222-2222-4222-8222-222222222222',amount:1})
  assert.equal(response.status,200)
  assert.equal(response.data.id,claimId)
  assert.deepEqual(JSON.parse(JSON.stringify(edge.calls[0])),{functionName:'create_manual_checkout_claim',params:{p_user_id:uid,p_selection:'oic_nw:month'}})
  edge.signOut()
  assert.equal((await edge.send({selection:'oic_nw:month'})).status,401)
  assert.equal(edge.calls.length,1)
  const other=fixture('create-manual-checkout-claim');other.unlinkGoogle()
  assert.equal((await other.send({selection:'oic_nw:month'})).status,403)
  assert.equal(other.calls.length,0)
})

test('admin claim review denies customers and uses verified admin identity',async()=>{
  const customer=fixture('admin-payment-review')
  assert.equal((await customer.send({action:'review-claim',claimId,decision:'approve'})).status,403)
  assert.equal(customer.calls.length,0)
  const admin=fixture('admin-payment-review','admin@example.invalid')
  assert.equal((await admin.send({action:'review-claim',claimId,decision:'paid'})).status,400)
  const response=await admin.send({action:'review-claim',claimId,decision:'proof_received',adminEmail:'spoof@example.invalid'})
  assert.equal(response.status,200)
  assert.deepEqual(JSON.parse(JSON.stringify(admin.calls[0])),{
    functionName:'review_manual_checkout_claim',
    params:{p_claim_id:claimId,p_action:'proof_received',p_admin_email:'admin@example.invalid',p_admin_note:null},
  })
})

test('a single admin approval performs both internal stages for a new claim', async () => {
  const admin=fixture('admin-payment-review','admin@example.invalid')
  const result=await admin.send({action:'review-claim',claimId,decision:'approve',adminEmail:'spoof@example.invalid'})
  assert.equal(result.status,200)
  assert.equal(result.data.status,'approved')
  assert.deepEqual(admin.calls.map(call => call.params.p_action),['proof_received','approve'])
  assert.ok(admin.calls.every(call => call.params.p_admin_email==='admin@example.invalid'))
})

test('an already verified claim approves without repeating receipt processing', async () => {
  const admin=fixture('admin-payment-review','admin@example.invalid','pending_verification')
  const result=await admin.send({action:'review-claim',claimId,decision:'approve'})
  assert.equal(result.status,200)
  assert.deepEqual(admin.calls.map(call => call.params.p_action),['approve'])
})
