import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const manual = '33333333-3333-4333-8333-333333333333'
const uuid = n => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(n).padStart(12,'0')
const refund = async payment => (await db.query(
  'select public.revoke_paymongo_fixed_term_checkout($1) result',[payment]
)).rows[0].result
const count = async (table,clause='',values=[]) => Number((await db.query(
  'select count(*) n from ' + table + (clause ? ' where '+clause : ''),values
)).rows[0].n)

try {
  await db.exec([
    'create role anon; create role authenticated; create role service_role bypassrls;',
    "create table public.checkout_batches (id uuid primary key,user_id uuid not null,product_codes text[] not null,amount_php integer not null,status text not null constraint checkout_batches_status_check check(status in ('pending','paid','failed','cancelled')),payment_method text,paymongo_checkout_session_id text,paymongo_payment_id text unique);",
    'create table public.orders (id uuid primary key,user_id uuid not null,product_code text not null,checkout_batch_id uuid,amount_php integer not null,status text not null,payment_method text,payment_reference text,paymongo_payment_id text,paymongo_checkout_session_id text);',
    'create table public.entitlements (id uuid primary key,user_id uuid not null,product_code text not null,order_id uuid,status text not null,expires_at timestamptz);',
    'create table public.license_admin_audit (user_id uuid not null,product_code text not null,action text not null);',
    'create table public.paymongo_reconciliation_alerts (checkout_reference uuid not null,checkout_session_id text not null,paymongo_payment_id text not null unique,expected_amount_php integer not null,observed_amount_minor bigint not null,observed_currency text not null,reason text not null);',
    'grant select,insert,update on public.checkout_batches,public.orders,public.entitlements,public.license_admin_audit,public.paymongo_reconciliation_alerts to service_role;',
    "create function public.finalize_paymongo_checkout(p_checkout_reference uuid,p_checkout_session_id text,p_payment_id text,p_payment_method text,p_currency text,p_amount_minor bigint,p_customer_name text default null,p_customer_company text default null,p_customer_school text default null) returns jsonb language plpgsql security definer as $fn$ begin perform pg_advisory_xact_lock(hashtextextended('hyperion-paymongo-payment:' || p_payment_id,0));\n  -- A checkout session reference can identify either a basket batch or a legacy\n  return jsonb_build_object('status','paid'); end $fn$;"
  ].join('\n'))
  const migration = await readFile(new URL(
    '../../supabase/migrations/20261117084500_record_paymongo_fixed_term_refunds.sql',import.meta.url
  ),'utf8')
  await db.exec(migration)
  await db.exec('set role service_role')

  await db.query("insert into public.orders(id,user_id,product_code,amount_php,status,payment_method,paymongo_checkout_session_id,paymongo_payment_id,payment_reference) values ($1,$2,'oic_nw',499,'paid','PayMongo · qrph','cs_one',$3,$3)",
    [uuid(1),owner,'pay_fixedterm_111111'])
  await db.query("insert into public.entitlements(id,user_id,product_code,order_id,status,expires_at) values($1,$2,'oic_nw',$3,'active',now()+interval '1 year')",[uuid(21),owner,uuid(1)])
  await db.query("insert into public.orders(id,user_id,product_code,amount_php,status,payment_method,paymongo_checkout_session_id,paymongo_payment_id) values($1,$2,'engine_ew',499,'paid','PayMongo · qrph','cs_other',$3)",
    [uuid(2),other,'pay_other_account_123'])
  await db.query("insert into public.entitlements(id,user_id,product_code,order_id,status,expires_at) values($1,$2,'engine_ew',$3,'active',now()+interval '1 year')",[uuid(22),other,uuid(2)])

  let result=await refund('pay_fixedterm_111111')
  assert.equal(result.status,'refunded')
  assert.equal(result.revokedTracks,1)
  assert.equal((await db.query('select status from public.orders where id=$1',[uuid(1)])).rows[0].status,'refunded')
  assert.equal((await db.query('select status from public.entitlements where order_id=$1',[uuid(1)])).rows[0].status,'revoked')
  assert.equal((await db.query('select status from public.entitlements where order_id=$1',[uuid(2)])).rows[0].status,'active')
  assert.equal((await refund('pay_fixedterm_111111')).revokedTracks,0,'Refund replay is idempotent')

  const basketPayment='pay_basket_333333',basketId=uuid(3)
  await db.query("insert into public.checkout_batches(id,user_id,product_codes,amount_php,status,payment_method,paymongo_checkout_session_id,paymongo_payment_id) values($1,$2,array['gmdss','deck_mgt'],1398,'paid','PayMongo · qrph','cs_basket',$3)",
    [basketId,owner,basketPayment])
  for(const [orderId,entitlementId,code] of [[uuid(4),uuid(24),'gmdss'],[uuid(5),uuid(25),'deck_mgt']]){
    await db.query("insert into public.orders(id,user_id,product_code,checkout_batch_id,amount_php,status,payment_method,payment_reference) values($1,$2,$3,$4,699,'paid','PayMongo · qrph',$5)",
      [orderId,owner,code,basketId,basketPayment])
    await db.query("insert into public.entitlements(id,user_id,product_code,order_id,status,expires_at) values($1,$2,$3,$4,'active',now()+interval '1 month')",
      [entitlementId,owner,code,orderId])
  }
  result=await refund(basketPayment)
  assert.equal(result.revokedTracks,2,'One refunded basket revokes only its two independently funded grants')
  assert.equal((await db.query('select status from public.checkout_batches where id=$1',[basketId])).rows[0].status,'refunded')
  assert.equal(await count('public.orders','checkout_batch_id=$1 and status=$2',[basketId,'refunded']),2)

  const priorPayment='pay_prior_666666'
  await db.query("insert into public.orders(id,user_id,product_code,amount_php,status,payment_method,paymongo_checkout_session_id,paymongo_payment_id) values($1,$3,'gmdss',399,'paid','PayMongo · qrph','cs_prior',$4),($2,$3,'gmdss',399,'paid','PayMongo · qrph','cs_new','pay_new_777777')",
    [uuid(6),uuid(7),other,priorPayment])
  await db.query("insert into public.entitlements(id,user_id,product_code,order_id,status,expires_at) values($1,$2,'gmdss',$3,'active',now()+interval '2 years')",[uuid(26),other,uuid(7)])
  result=await refund(priorPayment)
  assert.equal(result.status,'reconciliation_required')
  assert.equal((await db.query('select status from public.entitlements where order_id=$1',[uuid(7)])).rows[0].status,'active',
    'Later paid extension remains active while refund duration is reconciled')
  assert.equal(await count('public.paymongo_reconciliation_alerts','paymongo_payment_id=$1',[priorPayment]),1)

  const manualPayment='pay_admin_888888'
  await db.query("insert into public.orders(id,user_id,product_code,amount_php,status,payment_method,paymongo_checkout_session_id,paymongo_payment_id) values($1,$2,'engine_mgt',999,'paid','PayMongo · qrph','cs_manual',$3)",
    [uuid(8),manual,manualPayment])
  await db.query("insert into public.entitlements(id,user_id,product_code,order_id,status,expires_at) values($1,$2,'engine_mgt',$3,'active',now()+interval '2 years')",[uuid(28),manual,uuid(8)])
  await db.query("insert into public.license_admin_audit(user_id,product_code,action) values($1,'engine_mgt','extend')",[manual])
  result=await refund(manualPayment)
  assert.equal(result.status,'reconciliation_required')
  assert.equal((await db.query('select status from public.entitlements where order_id=$1',[uuid(8)])).rows[0].status,'active',
    'Admin-granted time is not silently deleted')

  assert.equal((await refund('pay_before_paid_123')).status,'recorded','Refund-before-paid is stored')
  const late=(await db.query("select public.finalize_paymongo_checkout($1,'cs_late',$2,'PayMongo · qrph','PHP',39900,null,null,null) result",
    [uuid(9),'pay_before_paid_123'])).rows[0].result
  assert.equal(late.status,'refunded','Late paid finalization cannot resurrect refunded access')
  const normal=(await db.query("select public.finalize_paymongo_checkout($1,'cs_valid',$2,'PayMongo · qrph','PHP',39900,null,null,null) result",
    [uuid(10),'pay_not_refunded_123'])).rows[0].result
  assert.equal(normal.status,'paid','Unrefunded checkout remains valid')
  assert.equal(await count('public.paymongo_fixed_term_refunds'),5)

  await db.exec('reset role')
  for(const role of ['anon','authenticated']){
    await db.exec('set role '+role)
    await assert.rejects(db.query('select public.revoke_paymongo_fixed_term_checkout($1)',[priorPayment]),/permission denied/i)
    await assert.rejects(db.query('select * from public.paymongo_fixed_term_refunds'),/permission denied/i)
    await db.exec('reset role')
  }
  console.log('PASS: fixed-term refund ledger, single/basket revocation, manual extension safety, replay and private RPC')
} finally { await db.close() }
