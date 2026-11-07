// Only an isolated local database/container is accepted. Never production.
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { readFile, readdir } from 'node:fs/promises'
const container = process.env.HYPERION_RECONCILIATION_TEST_CONTAINER
const base = process.env.DATABASE_URL
if (container && !/^hyperion-reconciliation-test-[a-z0-9-]+$/.test(container)) throw Error('Use an isolated reconciliation test container')
if (!container) { const url = new URL(base || 'invalid:'); if (!['localhost','127.0.0.1'].includes(url.hostname) || url.pathname !== '/hyperion_test') throw Error('Only the local synthetic CI database is accepted') }
const env = { ...process.env }
for (const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH']) delete env[key]
const dbName = 'hyperion_reconciliation'
function sql(database, statement, onData) {
  const args = ['-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d', container ? database : new URL('/' + database, base).href]
  return new Promise((resolve,reject) => {
    const child = spawn(container ? 'docker' : 'psql', container ? ['--host=unix:///var/run/docker.sock','exec','-i',container,'psql',...args] : args, { env, stdio:['pipe','pipe','pipe'] })
    let output='', error=''
    child.stdout.on('data',chunk=>{ output+=chunk; onData?.(output) })
    child.stderr.on('data',chunk=>{ error+=chunk })
    child.on('error',reject)
    child.on('close',code=>code===0?resolve(output.trim()):reject(Error('Synthetic reconciliation SQL failed: '+error.slice(-1500))))
    child.stdin.end(statement)
  })
}
const query = (statement,onData) => sql(dbName,statement,onData)
const a='11111111-1111-4111-8111-111111111111', b='22222222-2222-4222-8222-222222222222'
const batch='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', legacy='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const literal = value => "'"+value.replaceAll("'","''")+"'"
const finalize = (id, session, payment='pay_fixture_same', amount=4000) => `public.finalize_paymongo_checkout('${id}',${literal(session)},${literal(payment)},'PayMongo · gcash','PHP',${amount})`
const schema = [
 '20261025021930_hyperion_manual_payment_schema.sql', '20261026095918_add_order_customer_profile.sql',
 '20261026105115_add_paymongo_checkout_tracking.sql', '20261026122137_add_checkout_batches_for_multi_item_basket.sql',
 '20261026135540_add_week_month_year_license_terms.sql', '20261027095847_finalize_paymongo_checkout_atomically.sql',
 '20261027095917_correct_gmdss_monthly_price_in_payment_finalizer.sql', '20261027101638_prevent_duplicate_open_payment_orders.sql',
 '20261027102007_harden_paymongo_finalizer_search_path.sql'
]
await sql('postgres',`drop database if exists ${dbName};create database ${dbName};`)
try {
  await query(`do $$begin if not exists(select from pg_roles where rolname='anon')then create role anon;end if;if not exists(select from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;
    create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql as $$select null::uuid$$;`)
  for (const file of schema) await query(await readFile('supabase/migrations/'+file,'utf8'))
  const guardFile=(await readdir('supabase/migrations')).find(name=>name.endsWith('_serialize_paymongo_payment_ids.sql'))
  if (guardFile && process.env.HYPERION_TEST_BASELINE !== 'yes') await query(await readFile('supabase/migrations/'+guardFile,'utf8'))
  await query(`insert into auth.users values('${a}'),('${b}');
    insert into public.checkout_batches(id,user_id,product_codes,license_terms,amount_php,paymongo_checkout_session_id) values('${batch}','${a}',array['gmdss'],array['month'],40,'cs_fixture_batch');
    insert into public.orders(user_id,product_code,track_id,license_term,amount_php,payment_method,checkout_batch_id) values('${a}','gmdss','GMDSS_GOC','month',40,'PayMongo Checkout','${batch}');
    insert into public.orders(id,user_id,product_code,track_id,license_term,amount_php,payment_method,paymongo_checkout_session_id) values('${legacy}','${b}','gmdss','GMDSS_GOC','month',40,'PayMongo Checkout','cs_fixture_legacy');`)

  // Hold the legacy track lock after its duplicate check, then race a different
  // table/reference using the same provider payment ID. No real payments exist.
  let lockedResolve
  const locked = new Promise(resolve=>{ lockedResolve=resolve })
  const holder=query(`begin;select pg_advisory_xact_lock(hashtext('${b}'),hashtext('gmdss'));select 'TRACK_LOCKED';select pg_sleep(2);commit;`,output=>{if(output.includes('TRACK_LOCKED'))lockedResolve()})
  await locked
  const legacyCall=query(`set application_name='hyperion-legacy-race';select ${finalize(legacy,'cs_fixture_legacy')};`)
  let waiting=false
  for(let i=0;i<40;i++) {
    waiting=(await query("select exists(select from pg_stat_activity where application_name='hyperion-legacy-race' and wait_event_type='Lock' and wait_event='advisory')"))==='t'
    if(waiting)break
    await new Promise(resolve=>setTimeout(resolve,20))
  }
  assert(waiting,'Legacy writer must reach the controlled advisory-lock barrier')
  const batchCall=query(`select ${finalize(batch,'cs_fixture_batch')};`)
  const [legacyResult,batchResult]=await Promise.all([legacyCall,batchCall,holder]).then(results=>results.slice(0,2).map(JSON.parse))
  assert.deepEqual([legacyResult.status,batchResult.status].sort(),['paid','reconciliation_required'],'A provider payment ID cannot fulfill two checkout references, even across batch/legacy tables')
  assert.equal(await query('select count(*) from public.entitlements'),'1','Only one entitlement is granted by a raced provider payment ID')
  const expiry=await query(`select expires_at::text from public.entitlements where user_id='${b}'`)
  const duplicate=JSON.parse(await query(`select ${finalize(legacy,'cs_fixture_legacy')};`))
  assert.equal(duplicate.duplicate,true)
  assert.equal(await query(`select expires_at::text from public.entitlements where user_id='${b}'`),expiry,'Repeated webhook/verify finalization does not extend expiry again')
  const distinct=JSON.parse(await query(`select ${finalize(legacy,'cs_fixture_legacy','pay_fixture_second')};`))
  assert.equal(distinct.duplicatePayment,true)
  assert.equal(await query(`select expires_at::text from public.entitlements where user_id='${b}'`),expiry,'A distinct payment on an already paid checkout is flagged instead of extending access')
  const fresh='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  await query(`insert into public.orders(id,user_id,product_code,track_id,license_term,amount_php,payment_method,paymongo_checkout_session_id) values('${fresh}','${a}','oic_nw','DECK_OIC_NW','week',20,'PayMongo Checkout','cs_fixture_fresh');`)
  const simultaneous=await Promise.all([query(`select ${finalize(fresh,'cs_fixture_fresh','pay_fixture_fresh',2000)};`),query(`select ${finalize(fresh,'cs_fixture_fresh','pay_fixture_fresh',2000)};`)])
  assert.deepEqual(simultaneous.map(JSON.parse).map(result=>result.duplicate).sort(),[false,true],'Concurrent webhook and verification for the same unpaid checkout finalize once')
  assert.equal(await query(`select expires_at=granted_at+interval '7 days' from public.entitlements where order_id='${fresh}'`),'t','Concurrent duplicate delivery cannot turn one weekly term into two')
  const renewalA='dddddddd-dddd-4ddd-8ddd-dddddddddddd',renewalB='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  await query(`insert into public.orders(id,user_id,product_code,track_id,license_term,amount_php,status,payment_method,paymongo_checkout_session_id) values('${renewalA}','${b}','gmdss','GMDSS_GOC','month',40,'failed','PayMongo Checkout','cs_fixture_renewal_a'),('${renewalB}','${b}','gmdss','GMDSS_GOC','month',40,'failed','PayMongo Checkout','cs_fixture_renewal_b');`)
  const expectedRenewal=await query(`select (expires_at+interval '1 month'+interval '1 month')::text from public.entitlements where user_id='${b}' and product_code='gmdss'`)
  await Promise.all([query(`select ${finalize(renewalA,'cs_fixture_renewal_a','pay_fixture_renewal_a')};`),query(`select ${finalize(renewalB,'cs_fixture_renewal_b','pay_fixture_renewal_b')};`)])
  assert.equal(await query(`select expires_at::text from public.entitlements where user_id='${b}' and product_code='gmdss'`),expectedRenewal,'Distinct legitimate concurrent payments still extend access once each')
  await assert.rejects(query(`select ${finalize(legacy,'cs_wrong')};`),/does not match/)
  await assert.rejects(query(`select ${finalize(legacy,'cs_fixture_legacy','pay_invalid',999)};`),/does not match/)
  await assert.rejects(query(`set role authenticated;select ${finalize(legacy,'cs_fixture_legacy')};`),/permission denied/)
  const privilege=await query("select prosecdef and proconfig @> array['search_path=pg_catalog, public, pg_temp'] and not has_function_privilege('anon',oid,'EXECUTE') and not has_function_privilege('authenticated',oid,'EXECUTE') and has_function_privilege('service_role',oid,'EXECUTE') from pg_proc where oid='public.finalize_paymongo_checkout(uuid,text,text,text,text,bigint,text,text,text)'::regprocedure")
  assert.equal(privilege,'t','Finalizer stays service-only with its hardened search path')
  if(guardFile) {
    const before=await query("select md5(string_agg(row_to_json(e)::text,'' order by user_id)) from public.entitlements e")
    await query(await readFile('supabase/rollbacks/serialize_paymongo_payment_ids.sql','utf8'))
    assert.equal(await query("select md5(string_agg(row_to_json(e)::text,'' order by user_id)) from public.entitlements e"),before,'Rollback never changes entitlements')
  }
  console.log('PASS: cross-reference payment-ID race, webhook/verify replay, expiry stability, distinct-charge alert, validation, permissions and rollback')
} finally { await sql('postgres',`drop database if exists ${dbName} with(force);`) }
