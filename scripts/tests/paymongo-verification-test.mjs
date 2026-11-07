import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import vm from 'node:vm'
import ts from 'typescript'
import { createHmac, webcrypto } from 'node:crypto'
const require = createRequire(import.meta.url)
const owner='11111111-1111-4111-8111-111111111111', other='22222222-2222-4222-8222-222222222222'
const reference='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const compile=name=>ts.transpileModule(readFileSync(new URL('../../supabase/functions/'+name+'/index.ts',import.meta.url),'utf8'),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText
const originalFetch=globalThis.fetch
const flush=async()=>{for(let i=0;i<40;i++)await Promise.resolve()}
function fixture(batch=false) {
  const state={batch,owner,authFails:false,status:'pending',providerPaid:false,providerStatus:200,providerError:false,hold:false,timeout:false,wrongMode:false,wrongAmount:false,wrongSession:false,rpcFail:false,time:0,providerReads:0,authReads:0,dbReads:0,rpcCalls:0,grants:0,release:undefined,timeoutMs:undefined}
  const order={id:reference,user_id:owner,product_code:'oic_nw',track_id:'DECK_OIC_NW',currency:'PHP',license_term:'year',amount_php:350,payment_method:'PayMongo Checkout',paymongo_checkout_session_id:'cs_fixture',customer_name:null,customer_company:null,customer_school:null}
  const basket={id:reference,user_id:owner,product_codes:['oic_nw','gmdss'],license_terms:['year','month'],amount_php:390,payment_method:'PayMongo Checkout',paymongo_checkout_session_id:'cs_fixture'}
  const session=()=>({id:state.wrongSession?'cs_other':'cs_fixture',attributes:{livemode:state.wrongMode,reference_number:reference,metadata:batch?{batch_id:reference,order_id:reference,user_id:owner,product_codes:'oic_nw,gmdss',product_terms:'oic_nw:year,gmdss:month'}:{order_id:reference,user_id:owner,product_code:'oic_nw',license_term:'year'},payments:state.providerPaid?[{id:'pay_fixture',attributes:{status:'paid',currency:'PHP',amount:state.wrongAmount?1:(batch?39000:35000),source:{type:'gcash'}}}]:[]}})
  const releases=[]
  const fetchMock=async(input,init)=>{
    const req=new Request(input,init),url=new URL(req.url)
    const json=(data,status=200)=>Response.json(data,{status})
    if(url.hostname==='api.paymongo.com') {
      assert.equal(req.method,'GET','Verification never creates or charges a payment')
      state.providerReads++
      if(state.providerError)throw Error('Synthetic network failure')
      if(state.timeout)return new Promise((_resolve,reject)=>{req.signal.addEventListener('abort',()=>reject(req.signal.reason),{once:true});if(req.signal.aborted)reject(req.signal.reason)})
      if(state.hold)await new Promise(resolve=>{releases.push(resolve);state.release=()=>{for(const resume of releases.splice(0))resume()}})
      return state.providerStatus===200?json({data:session()}):json({errors:[{detail:'Synthetic provider error'}]},state.providerStatus)
    }
    assert.equal(url.hostname,'fixture.invalid','No real service request is permitted')
    if(url.pathname==='/auth/v1/user') {state.authReads++;return state.authFails?json({message:'Invalid token'},401):json({id:state.owner,email:'member@fixture.invalid',user_metadata:{full_name:'Synthetic Member'}})}
    state.dbReads++
    if(url.pathname.endsWith('/checkout_batches'))return json(batch&&url.searchParams.get('id')==='eq.'+reference&&(!url.searchParams.has('user_id')||url.searchParams.get('user_id')==='eq.'+owner)?{...basket,status:state.status}:null)
    if(url.pathname.endsWith('/orders')) {
      if(url.searchParams.has('checkout_batch_id'))return json([{...order,checkout_batch_id:reference},{...order,id:'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',product_code:'gmdss',track_id:'GMDSS_GOC',license_term:'month',amount_php:40,checkout_batch_id:reference}])
      return json(!batch&&url.searchParams.get('id')==='eq.'+reference&&(!url.searchParams.has('user_id')||url.searchParams.get('user_id')==='eq.'+owner)?{...order,status:state.status}:null)
    }
    if(url.pathname.endsWith('/rpc/finalize_paymongo_checkout')) {
      state.rpcCalls++
      const body=await req.json();assert.equal(body.p_payment_id,'pay_fixture')
      if(state.rpcFail)return json({message:'Synthetic finalizer failure'},503)
      const duplicate=state.status==='paid';if(!duplicate)state.grants++
      state.status='paid';return json({status:'paid',duplicate,orderId:reference,productCodes:batch?['oic_nw','gmdss']:['oic_nw']})
    }
    throw Error('Unexpected synthetic endpoint '+url.pathname)
  }
  globalThis.fetch=fetchMock
  const env={SUPABASE_URL:'http://fixture.invalid',SUPABASE_ANON_KEY:'fixture-anon',SUPABASE_SERVICE_ROLE_KEY:'fixture-service',PAYMONGO_SECRET_KEY:'sk_test_fixture',PAYMONGO_EXPECT_LIVEMODE:'false',PAYMONGO_TEST_WEBHOOK_SECRET:'whsec_fixture'}
  const handlers={}
  for(const name of ['verify-checkout','paymongo-webhook']) {
    const context={require:name=>require(name.replace('npm:','').replace('@2','')),exports:{},Deno:{env:{get:key=>env[key]},serve:fn=>{handlers[name]=fn}},fetch:fetchMock,Request,Response,Headers,TextEncoder,TextDecoder,Blob,URL,crypto:webcrypto,btoa,console:{info(){},warn(){},error(){}},performance:{now:()=>state.time},AbortSignal:{timeout:ms=>{state.timeoutMs=ms;if(!state.timeout)return AbortSignal.timeout(ms);const controller=new AbortController();setTimeout(()=>controller.abort(Error('Synthetic timeout')),0);return controller.signal}},setTimeout,clearTimeout}
    vm.runInNewContext(compile(name),context)
  }
  const verify=()=>handlers['verify-checkout'](new Request('http://fixture.invalid/verify-checkout',{method:'POST',headers:{Authorization:'Bearer fixture','Content-Type':'application/json'},body:JSON.stringify({orderId:reference})}))
  const webhook=async({invalid=false,stale=false}={})=>{
    const body=JSON.stringify({data:{id:'evt_fixture',type:'event',attributes:{type:'checkout_session.payment.paid',livemode:false,data:session()}}})
    const timestamp=String(Math.floor(Date.now()/1000)-(stale?301:0))
    const signature=createHmac('sha256','whsec_fixture').update(timestamp+'.'+body).digest('hex')
    return handlers['paymongo-webhook'](new Request('http://fixture.invalid/paymongo-webhook',{method:'POST',headers:{'Paymongo-Signature':`t=${timestamp},te=${invalid?'0'.repeat(64):signature}`},body}))
  }
  return {state,verify,webhook}
}
try {
  let f=fixture();f.state.hold=true
  const first=f.verify(),second=f.verify()
  for(let i=0;i<60&&!f.state.release;i++)await new Promise(resolve=>setTimeout(resolve,1))
  assert(f.state.release,'Provider call reaches the synthetic barrier')
  await flush();f.state.hold=false;f.state.release();const responses=await Promise.all([first,second])
  assert.equal(f.state.providerReads,1,'Overlapping authenticated verifications share one provider request')
  assert.equal(f.state.authReads,2,'Every coalesced request still validates authentication')
  assert.equal(f.state.timeoutMs,8000,'Provider reads have a bounded timeout')
  for(const response of responses){assert.equal((await response.json()).status,'pending');assert.match(response.headers.get('Cache-Control'),/no-store/)}
  f.state.hold=false
  assert.equal((await (await f.verify()).json()).status,'pending')
  assert.equal(f.state.providerReads,1,'A validated pending result briefly absorbs rapid repeated requests')
  f.state.owner=other;assert.equal((await f.verify()).status,404,'A pending result cannot cross account boundaries')
  f.state.owner=owner;f.state.authFails=true;assert.equal((await f.verify()).status,401,'Cached pending results never bypass fresh authentication')
  f.state.authFails=false;f.state.providerPaid=true;f.state.time=2001
  assert.equal((await (await f.verify()).json()).status,'paid','A fresh provider result replaces expired pending state')
  assert.equal(f.state.grants,1)
  assert.equal((await (await f.verify()).json()).status,'paid')
  assert.equal(f.state.providerReads,2,'Already finalized checkout avoids another provider request')
  assert.equal(f.state.rpcCalls,1)
  assert.equal((await f.webhook()).status,200);assert.equal((await f.webhook()).status,200)
  assert.equal(f.state.grants,1,'Repeated signed notifications and verification share the idempotent finalizer')

  for(const failure of ['providerError','timeout']) {
    f=fixture();f.state[failure]=true
    assert.equal((await f.verify()).status,502)
    assert.equal(f.state.providerReads,1,'A provider error does not trigger immediate automatic retries')
    f.state[failure]=false
    assert.equal((await f.verify()).status,200)
    assert.equal(f.state.providerReads,2,'Failures release coalescing state and are not cached')
  }
  f=fixture();f.state.providerStatus=429;assert.equal((await f.verify()).status,502);f.state.providerStatus=200;assert.equal((await f.verify()).status,200);assert.equal(f.state.providerReads,2)
  for(const invalid of ['wrongMode','wrongAmount','wrongSession']) {
    f=fixture();f.state.providerPaid=true;f.state[invalid]=true
    assert.equal((await f.verify()).status,409,invalid+' remains rejected')
    assert.equal(f.state.rpcCalls,0,'Invalid provider data never reaches fulfillment')
  }
  f=fixture();f.state.providerPaid=true;f.state.rpcFail=true
  assert.equal((await f.verify()).status,500);assert.equal((await f.verify()).status,500)
  assert.equal(f.state.providerReads,2,'Finalization errors are never cached as paid or pending')
  f=fixture(true);f.state.providerPaid=true
  assert.equal((await f.verify()).status,200);assert.equal((await f.webhook()).status,200);assert.equal((await f.webhook()).status,200)
  assert.equal(f.state.grants,1,'Basket replay remains idempotent')
  f=fixture();f.state.providerPaid=true
  assert.equal((await f.webhook({invalid:true})).status,401)
  assert.equal((await f.webhook({stale:true})).status,401)
  assert.equal(f.state.dbReads,0,'Invalid or stale signatures are rejected before privileged database reads')
  console.log('PASS: verification coalescing, fresh auth, bounded pending cache/timeout, retry failures, provider validation and signed webhook replay')
} finally {globalThis.fetch=originalFetch}
