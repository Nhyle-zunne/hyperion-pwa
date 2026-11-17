import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { createHmac, webcrypto } from 'node:crypto'
import vm from 'node:vm'
import ts from 'typescript'

const require = createRequire(import.meta.url)
const originalFetch = globalThis.fetch
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const orderId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const paymentId = 'pay_lifetime123456'
const sessionId = 'cs_lifetime_fixture'
const proofSource = readFileSync(new URL('../../supabase/functions/_shared/paymongoLifetime.ts',import.meta.url),'utf8')
const compiled = (code) => ts.transpileModule(code,{
  compilerOptions: { module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022 }
}).outputText
const lifetimeExports = {}
vm.runInNewContext(compiled(proofSource),{
  exports:lifetimeExports,crypto:webcrypto,TextEncoder
})

function fixture() {
  const state = {
    currentOwner:owner,paid:false,wrongAmount:false,wrongMetadata:false,
    status:'pending',grants:0,refunds:0,timedRefunds:0,lifetimeOrderExists:true,dbCalls:0,providerReads:0
  }
  const order = {
    id:orderId,user_id:owner,product_code:'gmdss',track_id:'GMDSS_GOC',
    amount_php:599,currency:'PHP',status:'pending',
    paymongo_checkout_session_id:sessionId,paymongo_livemode:false
  }
  const session = () => ({
    id:sessionId,
    attributes:{
      livemode:false,reference_number:orderId,
      metadata:{
        kind:'lifetime',order_id:orderId,user_id:state.wrongMetadata?other:owner,
        product_code:'gmdss'
      },
      payments:state.paid?[{
        id:paymentId,
        attributes:{
          status:'paid',currency:'PHP',
          amount:state.wrongAmount?1:59900
        }
      }]:[]
    }
  })
  const handlers = {}
  const environment = {
    SUPABASE_URL:'http://fixture.invalid',
    SUPABASE_ANON_KEY:'fixture-anon',
    SUPABASE_SERVICE_ROLE_KEY:'fixture-service',
    PAYMONGO_SECRET_KEY:'sk_test_fixture',
    PAYMONGO_EXPECT_LIVEMODE:'false',
    PAYMONGO_TEST_WEBHOOK_SECRET:'whsec_fixture'
  }
  const fetchMock = async(input,init) => {
    const req = new Request(input,init)
    const url = new URL(req.url)
    const json = (data,status=200) => Response.json(data,{status})
    if(url.hostname==='api.paymongo.com') {
      assert.equal(req.method,'GET','Verification must not charge money')
      state.providerReads++
      return json({data:session()})
    }
    assert.equal(url.hostname,'fixture.invalid')
    if(url.pathname==='/auth/v1/user') {
      return json({id:state.currentOwner,email:'synthetic@fixture.invalid'})
    }
    state.dbCalls++
    if(url.pathname.endsWith('/lifetime_orders')) {
      return json(url.searchParams.get('id')==='eq.'+orderId &&
        (!url.searchParams.has('user_id') || url.searchParams.get('user_id')==='eq.'+owner)
        ?{...order,status:state.status}:null)
    }
    if(url.pathname.endsWith('/rpc/finalize_paymongo_lifetime_checkout')) {
      const body=await req.json()
      assert.equal(body.p_order_id,orderId)
      assert.equal(body.p_payment_id,paymentId)
      assert.equal(body.p_amount_minor,59900)
      assert.equal(body.p_currency,'PHP')
      if(state.status==='refunded') return json({status:'refunded',orderId})
      const duplicate=state.status==='paid'
      if(!duplicate)state.grants++
      state.status='paid'
      return json({status:'paid',orderId,productCode:'gmdss',duplicate})
    }
    if(url.pathname.endsWith('/rpc/revoke_paymongo_lifetime_checkout')) {
      const body=await req.json()
      assert.equal(body.p_payment_id,paymentId)
      if(!state.lifetimeOrderExists)return json(false)
      if(state.status!=='refunded')state.refunds++
      state.status='refunded'
      return json(true)
    }
    if(url.pathname.endsWith('/rpc/revoke_paymongo_fixed_term_checkout')) {
      const body=await req.json()
      assert.equal(body.p_payment_id,paymentId)
      if(state.timedRefunds===0)state.timedRefunds++
      return json({status:'refunded',matched:true,revokedTracks:1})
    }
    throw Error('Unexpected synthetic endpoint '+url.pathname)
  }
  globalThis.fetch=fetchMock
  for(const name of ['verify-lifetime-checkout','paymongo-webhook']) {
    const code=readFileSync(new URL('../../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8')
    const context={
      require:name=>name==='../_shared/paymongoLifetime.ts'
        ?lifetimeExports
        :name==='../_shared/paymentPrices.mjs'
          ?{isAcceptedStoredPrice:()=>true}
          :require(name.replace('npm:','').replace('@2','')),
      exports:{},
      Deno:{env:{get:key=>environment[key]},serve:fn=>{handlers[name]=fn}},
      fetch:fetchMock,Request,Response,Headers,TextEncoder,TextDecoder,
      crypto:webcrypto,btoa,AbortSignal,console:{error(){},warn(){},info(){}}
    }
    vm.runInNewContext(compiled(code),context)
  }
  const verify = () => handlers['verify-lifetime-checkout'](new Request(
    'http://fixture.invalid/verify-lifetime-checkout',{
      method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},
      body:JSON.stringify({orderId})
    }
  ))
  const signed = async(type,resource,invalid=false) => {
    const raw=JSON.stringify({data:{id:'evt_lifetime_fixture',type:'event',
      attributes:{type,livemode:false,data:resource}}})
    const timestamp=String(Math.floor(Date.now()/1000))
    const signature=createHmac('sha256','whsec_fixture')
      .update(timestamp+'.'+raw).digest('hex')
    return handlers['paymongo-webhook'](new Request(
      'http://fixture.invalid/paymongo-webhook',{
        method:'POST',headers:{
          'Paymongo-Signature':'t='+timestamp+',te='+(invalid?'0'.repeat(64):signature)
        },body:raw
      }
    ))
  }
  return {state,session,verify,signed}
}

try {
  let f=fixture()
  assert.equal((await (await f.verify()).json()).status,'pending')
  assert.equal(f.state.grants,0,'Redirect without provider paid status cannot unlock')
  f.state.paid=true
  assert.equal((await (await f.verify()).json()).status,'paid')
  assert.equal(f.state.grants,1)
  assert.equal((await f.signed('checkout_session.payment.paid',f.session())).status,200)
  assert.equal(f.state.grants,1,'Repeated signed webhook never duplicates a lifetime grant')

  f=fixture()
  f.state.paid=true
  assert.equal((await f.signed('checkout_session.payment.paid',f.session(),true)).status,401)
  assert.equal(f.state.dbCalls,0,'Invalid signature rejected before privileged lookup')
  assert.equal((await f.signed('checkout_session.payment.paid',f.session())).status,200)
  assert.equal(f.state.grants,1)

  f=fixture()
  f.state.paid=true
  f.state.wrongAmount=true
  assert.equal((await f.verify()).status,500)
  assert.equal(f.state.grants,0,'Wrong amount cannot fulfill')
  assert.equal((await f.signed('checkout_session.payment.paid',f.session())).status,500)
  assert.equal(f.state.grants,0)

  f=fixture()
  f.state.paid=true
  f.state.wrongMetadata=true
  assert.equal((await f.verify()).status,409)
  assert.equal((await f.signed('checkout_session.payment.paid',f.session())).status,500)
  assert.equal(f.state.grants,0)

  f=fixture()
  f.state.currentOwner=other
  assert.equal((await f.verify()).status,404,'Different user cannot retrieve lifetime order')
  assert.equal(f.state.grants,0)

  f=fixture()
  f.state.paid=true
  assert.equal((await f.signed('checkout_session.payment.paid',f.session())).status,200)
  assert.equal((await f.signed('payment.refunded',{id:paymentId,attributes:{status:'refunded'}},true)).status,401)
  assert.equal(f.state.refunds,0,'Forged refund cannot revoke')
  assert.equal((await f.signed('payment.refund.updated',{
    attributes:{status:'pending',payment_id:paymentId}
  })).status,200)
  assert.equal(f.state.refunds,0,'Pending refund cannot revoke')
  assert.equal((await f.signed('payment.refund.updated',{
    attributes:{status:'succeeded',payment_id:paymentId}
  })).status,200)
  assert.equal(f.state.refunds,1,'Succeeded refund revokes paid lifetime entitlement')
  assert.equal((await f.signed('payment.refunded',{
    id:paymentId,attributes:{status:'refunded'}
  })).status,200)
  assert.equal(f.state.refunds,1,'Refund replays are idempotent')
  assert.equal((await f.signed('checkout_session.payment.paid',f.session())).status,200)
  assert.equal(f.state.grants,1,'Late paid webhook cannot resurrect refunded ownership')
  assert.equal(f.state.timedRefunds,0,'Lifetime refund never touches fixed-term subscriptions')

  f=fixture()
  f.state.lifetimeOrderExists=false
  assert.equal((await f.signed('payment.refunded',{id:paymentId,attributes:{status:'refunded'}},true)).status,401)
  assert.equal(f.state.timedRefunds,0,'Forged fixed-term refund cannot revoke')
  assert.equal((await f.signed('payment.refund.updated',{
    attributes:{status:'pending',payment_id:paymentId}
  })).status,200)
  assert.equal(f.state.timedRefunds,0,'Pending fixed-term refund cannot revoke')
  assert.equal((await f.signed('payment.refund.updated',{
    attributes:{status:'succeeded',payment_id:paymentId}
  })).status,200)
  assert.equal(f.state.timedRefunds,1,'Signed succeeded refund reaches fixed-term reconciliation')
  assert.equal((await f.signed('payment.refunded',{id:paymentId,attributes:{status:'refunded'}})).status,200)
  assert.equal(f.state.timedRefunds,1,'Fixed-term refund repeats do not revoke again')
  console.log('PASS: lifetime and fixed-term signed refunds, mode/signature safeguards and replay')
} finally {
  globalThis.fetch=originalFetch
}
