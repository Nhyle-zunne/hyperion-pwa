import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'

const migration = new URL('../../supabase/migrations/20261125013418_manual_checkout_claims.sql', import.meta.url)
const guardMigration = new URL('../../supabase/migrations/20261128020000_prevent_overlapping_manual_checkout_claims.sql', import.meta.url)
const buyer = '11111111-1111-4111-8111-111111111111'
const secondBuyer = '22222222-2222-4222-8222-222222222222'

async function setup() {
  const db = new PGlite()
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create table auth.users(id uuid primary key);
    insert into auth.users values ('${buyer}'),('${secondBuyer}');
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('test.auth_uid',true),'')::uuid$$;
    create table public.payment_settings(id integer primary key, website_checkout_enabled boolean not null);
    insert into public.payment_settings values (1,true);
    create table public.orders(
      id uuid primary key default gen_random_uuid(), user_id uuid not null references auth.users(id),
      product_code text not null, track_id text not null, license_term text not null,
      amount_php integer not null, currency text not null default 'PHP', status text not null,
      payment_method text, payment_reference text, admin_note text, reviewed_by text,
      reviewed_at timestamptz, created_at timestamptz not null default now(), paid_at timestamptz,
      paymongo_checkout_session_id text
    );
    create table public.entitlements(
      id uuid primary key default gen_random_uuid(),user_id uuid not null,
      product_code text not null,track_id text not null,order_id uuid not null references public.orders(id),
      license_term text not null,status text not null,granted_at timestamptz not null,
      renewed_at timestamptz, expires_at timestamptz,unique(user_id,product_code)
    );
    create table public.lifetime_entitlements(
      id uuid primary key default gen_random_uuid(), user_id uuid not null,
      product_code text not null, track_id text not null,provider text not null,
      purchase_ref_sha256 text not null,status text not null,purchased_at timestamptz not null default now(),
      revoked_at timestamptz,updated_at timestamptz not null default now(),
      constraint lifetime_entitlements_provider_check check(provider in('paymongo','google_play','admin')),
      unique(provider,purchase_ref_sha256)
    );
    create table public.google_play_entitlements(user_id uuid,product_code text,status text,expires_at timestamptz);
    create table public.lifetime_orders(user_id uuid,product_code text,status text);
  `)
  await db.exec(readFileSync(migration, 'utf8'))
  await db.exec(readFileSync(guardMigration, 'utf8'))
  return db
}

async function create(db, user, selection) {
  return (await db.query('select public.create_manual_checkout_claim($1,$2) as claim', [user, selection])).rows[0].claim
}

async function createWithoutDuplicateTracks(db, user, selection) {
  return (await db.query('select public.create_manual_checkout_claim_unique_tracks($1,$2) as claim', [user, selection])).rows[0].claim
}

async function review(db, id, action) {
  return (await db.query('select public.review_manual_checkout_claim($1,$2,$3,$4) as result', [id,action,'admin@example.com','Reviewed bank credit'])).rows[0].result
}

test('server calculates multi-track totals, reuses an open claim, and never grants access on creation', async t => {
  const db = await setup(); t.after(() => db.close())
  const a = await create(db,buyer,'gmdss:lifetime,oic_nw:month')
  const b = await create(db,buyer,'oic_nw:month,gmdss:lifetime')
  assert.equal(a.id,b.id)
  assert.equal(a.status,'awaiting_proof')
  assert.equal(a.total_amount_php,678)
  assert.deepEqual(a.items.map(item=>[item.code,item.term,item.amountPhp]),[['gmdss','lifetime',599],['oic_nw','month',79]])
  assert.equal((await db.query('select count(*)::int as n from public.entitlements')).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int as n from public.orders')).rows[0].n,0)
  await assert.rejects(create(db,buyer,'oic_nw:year,oic_nw:month'),/duplicate|invalid/i)
  await assert.rejects(create(db,buyer,'oic_nw:year,evil:month'),/invalid/i)
  await assert.rejects(create(db,buyer,'oic_nw:year:0'),/invalid/i)
  await assert.rejects(create(db,buyer,'oic_nw:year:'),/invalid/i)
  await assert.rejects(create(db,buyer,'oic_nw:year::'),/invalid/i)
})

test('new manual checkout blocks a second pending request for an overlapping track across different carts', async t => {
  const db = await setup(); t.after(() => db.close())
  const first = await createWithoutDuplicateTracks(db, buyer, 'oic_nw:year,gmdss:month')
  const same = await createWithoutDuplicateTracks(db, buyer, 'gmdss:month,oic_nw:year')
  assert.equal(same.id, first.id, 'the same cart reuses its original request')
  await assert.rejects(createWithoutDuplicateTracks(db, buyer, 'oic_nw:week'), /pending.*track|already.*request/i)
  const independent = await createWithoutDuplicateTracks(db, buyer, 'engine_ew:year')
  assert.notEqual(independent.id, first.id, 'a different track can still be purchased')
  const otherOwner = await createWithoutDuplicateTracks(db, secondBuyer, 'oic_nw:week')
  assert.notEqual(otherOwner.id, first.id, 'another account is unaffected')
  await review(db, first.id, 'proof_received')
  await review(db, first.id, 'approve')
  const renewed = await createWithoutDuplicateTracks(db, buyer, 'oic_nw:week')
  assert.notEqual(renewed.id, first.id, 'approved purchases do not block later renewals')
})

test('an existing request stays reusable when older checkout already left overlapping requests', async t => {
  const db = await setup(); t.after(() => db.close())
  const first = await create(db, buyer, 'oic_nw:month')
  await create(db, buyer, 'oic_nw:year')
  const reused = await createWithoutDuplicateTracks(db, buyer, 'oic_nw:month')
  assert.equal(reused.id, first.id)
})

test('proof stage is mandatory and approval writes subscriptions plus lifetime grants atomically', async t => {
  const db = await setup(); t.after(() => db.close())
  const claim = await create(db,buyer,'oic_nw:month,gmdss:lifetime')
  await assert.rejects(review(db,claim.id,'approve'),/proof|awaiting/i)
  await assert.rejects(review(db,claim.id,null),/invalid/i)
  assert.equal((await review(db,claim.id,'proof_received')).status,'pending_verification')
  assert.equal((await review(db,claim.id,'approve')).status,'approved')
  await assert.rejects(review(db,claim.id,'approve'),/already|review|status/i)
  const order = (await db.query('select * from public.orders')).rows
  assert.equal(order.length,1)
  assert.equal(order[0].status,'paid')
  assert.equal(order[0].amount_php,79)
  assert.equal(order[0].payment_method,'Manual QR Ph / InstaPay')
  assert.equal(order[0].admin_note,null,'Internal admin notes must not be copied into customer-readable paid orders')
  assert.equal((await db.query('select count(*)::int as n from public.entitlements')).rows[0].n,1)
  const lifetime = (await db.query('select provider,product_code,status from public.lifetime_entitlements')).rows
  assert.deepEqual(lifetime,[{ provider:'manual',product_code:'gmdss',status:'active' }])
})

test('reject never activates, expired claims can be retried and rate limiting stops floods', async t => {
  const db = await setup(); t.after(() => db.close())
  const first = await create(db,buyer,'oic_nw:week')
  await review(db,first.id,'reject')
  assert.equal((await db.query('select status from public.manual_checkout_claims where id=$1',[first.id])).rows[0].status,'rejected')
  const retry = await create(db,buyer,'oic_nw:week')
  assert.notEqual(retry.id,first.id)
  await create(db,buyer,'gmdss:week')
  await create(db,buyer,'engine_ew:week')
  await assert.rejects(create(db,buyer,'deck_mgt:week'),/too many|open/i)
  await db.query("update public.manual_checkout_claims set expires_at=now()- interval '1 second' where id=$1",[retry.id])
  const next = await create(db,buyer,'oic_nw:week')
  assert.notEqual(next.id,retry.id)
  assert.equal((await db.query('select status from public.manual_checkout_claims where id=$1',[retry.id])).rows[0].status,'expired')
})

test('final review preserves the proof-matching note when no new note is entered', async t => {
  const db=await setup();t.after(()=>db.close())
  const claim=await create(db,buyer,'oic_nw:week')
  await review(db,claim.id,'proof_received')
  await db.query("update public.manual_checkout_claims set admin_note='Receipt checked in Messenger' where id=$1",[claim.id])
  await db.query("select public.review_manual_checkout_claim($1,'approve','admin@example.com',null)",[claim.id])
  const row=(await db.query('select admin_note from public.manual_checkout_claims where id=$1',[claim.id])).rows[0]
  assert.equal(row.admin_note,'Receipt checked in Messenger')
})

test('checkout toggle is enforced, existing historic PayMongo lifetime remains untouched', async t => {
  const db = await setup(); t.after(()=>db.close())
  await db.query("insert into public.lifetime_entitlements(user_id,product_code,track_id,provider,purchase_ref_sha256,status) values($1,'gmdss','GMDSS_GOC','paymongo',$2,'active')",[buyer,'a'.repeat(64)])
  await db.exec('update public.payment_settings set website_checkout_enabled=false')
  await assert.rejects(create(db,buyer,'oic_nw:week'),/disabled|unavailable/i)
  await db.exec('update public.payment_settings set website_checkout_enabled=true')
  const claim = await create(db,secondBuyer,'oic_nw:year')
  await review(db,claim.id,'proof_received')
  await review(db,claim.id,'approve')
  assert.equal((await db.query("select count(*)::int as n from public.lifetime_entitlements where provider='paymongo'")).rows[0].n,1)
})

test('account deletion intent serializes with checkout and protects newly approved lifetime access',async t=>{
  const db=await setup();t.after(()=>db.close())
  const claim=await create(db,buyer,'gmdss:lifetime')
  assert.equal((await db.query("select public.begin_checkout_account_deletion($1,'retention') as allowed",[buyer])).rows[0].allowed,false)
  await review(db,claim.id,'proof_received');await review(db,claim.id,'approve')
  assert.equal((await db.query("select public.begin_checkout_account_deletion($1,'retention') as allowed",[buyer])).rows[0].allowed,false)
  // A voluntary deletion is allowed once paid claims have completed, but new
  // checkout work must not start during that destructive operation.
  assert.equal((await db.query("select public.begin_checkout_account_deletion($1,'customer') as allowed",[buyer])).rows[0].allowed,true)
  await assert.rejects(create(db,buyer,'oic_nw:week'),/deletion/i)
  await db.query('select public.cancel_checkout_account_deletion($1)',[buyer])
  const next=await create(db,buyer,'oic_nw:week')
  assert.equal(next.status,'awaiting_proof')
})

test('checkout does not invite payment for lifetime owners, Play overlap or unresolved historical payments', async t=>{
  const db=await setup();t.after(()=>db.close())
  await db.query("insert into public.lifetime_entitlements(user_id,product_code,track_id,provider,purchase_ref_sha256,status) values($1,'gmdss','GMDSS_GOC','paymongo',$2,'active')",[buyer,'d'.repeat(64)])
  await assert.rejects(create(db,buyer,'oic_nw:month,gmdss:week'),/lifetime|already owned/i)
  await db.query("insert into public.google_play_entitlements(user_id,product_code,status,expires_at) values($1,'oic_nw','active',now()+ interval '10 days')",[buyer])
  await assert.rejects(create(db,buyer,'oic_nw:week'),/Google Play|overlap/i)
  await db.query("insert into public.orders(user_id,product_code,track_id,license_term,amount_php,status,payment_method,paymongo_checkout_session_id) values($1,'deck_mgt','DECK_MGT','year',999,'pending','PayMongo Checkout','old-session')",[buyer])
  await assert.rejects(create(db,buyer,'deck_mgt:year'),/pending|unresolved/i)
  await db.query("insert into public.lifetime_orders(user_id,product_code,status) values($1,'engine_mgt','pending')",[buyer])
  await assert.rejects(create(db,buyer,'engine_mgt:lifetime'),/pending|unresolved/i)
})

test('a duplicate lifetime grant rolls back the entire mixed-cart approval', async t => {
  const db = await setup(); t.after(()=>db.close())
  const claim = await create(db,buyer,'oic_nw:month,gmdss:lifetime')
  await review(db,claim.id,'proof_received')
  // A separate provider can activate a license after the manual claim is opened.
  await db.query("insert into public.lifetime_entitlements(user_id,product_code,track_id,provider,purchase_ref_sha256,status) values($1,'gmdss','GMDSS_GOC','google_play',$2,'active')",[buyer,'c'.repeat(64)])
  await assert.rejects(review(db,claim.id,'approve'),/already has lifetime access/i)
  assert.equal((await db.query('select count(*)::int as n from public.orders')).rows[0].n,0)
  assert.equal((await db.query('select count(*)::int as n from public.entitlements')).rows[0].n,0)
  assert.equal((await db.query('select status from public.manual_checkout_claims where id=$1',[claim.id])).rows[0].status,'pending_verification')
})

test('verified renewal adds time after existing subscription expiry, not from now', async t => {
  const db = await setup(); t.after(()=>db.close())
  const first = await create(db,buyer,'oic_nw:week')
  await review(db,first.id,'proof_received'); await review(db,first.id,'approve')
  const before = new Date((await db.query("select expires_at from public.entitlements where product_code='oic_nw'")).rows[0].expires_at)
  const second = await create(db,buyer,'oic_nw:week')
  await review(db,second.id,'proof_received'); await review(db,second.id,'approve')
  const after = new Date((await db.query("select expires_at from public.entitlements where product_code='oic_nw'")).rows[0].expires_at)
  assert.equal((after.getTime()-before.getTime())/(24*60*60*1000),7)
  assert.equal((await db.query('select count(*)::int as n from public.orders')).rows[0].n,2)
})

test('claims use own-account read RLS with no client insert/update/delete grants; privileged review only', async t => {
  const db = await setup(); t.after(()=>db.close())
  const claim = await create(db,buyer,'oic_nw:year')
  await db.exec(`alter table public.manual_checkout_claims force row level security; grant usage on schema public,auth to authenticated; grant execute on function auth.uid() to authenticated;`)
  await db.exec(`set role authenticated; set test.auth_uid='${secondBuyer}'`)
  try {
    assert.equal((await db.query('select count(*)::int as n from public.manual_checkout_claims')).rows[0].n,0)
    await assert.rejects(db.query("update public.manual_checkout_claims set status='approved' where id=$1",[claim.id]),/permission denied/i)
    await assert.rejects(db.query('select public.review_manual_checkout_claim($1,$2,$3,$4)',[claim.id,'approve','admin@example.com','fake']),/permission denied/i)
    await assert.rejects(db.query('select public.create_manual_checkout_claim($1,$2)',[secondBuyer,'oic_nw:week']),/permission denied/i)
    await assert.rejects(db.query('select public.create_manual_checkout_claim_unique_tracks($1,$2)',[secondBuyer,'oic_nw:week']),/permission denied/i)
    await db.exec(`set test.auth_uid='${buyer}'`)
    assert.equal((await db.query('select count(id)::int as n from public.manual_checkout_claims')).rows[0].n,1)
    assert.equal((await db.query('select id,user_id,selection_key,items,total_amount_php,status,created_at,expires_at,reviewed_at from public.manual_checkout_claims')).rows[0].id,claim.id)
    await assert.rejects(db.query('select admin_note from public.manual_checkout_claims'),/permission denied/i)
  } finally { await db.exec('reset role') }
})

test('admin review merges manual claims into historical status tabs without dropping receipts or orders', () => {
  const endpoint = readFileSync(new URL('../../supabase/functions/admin-payment-review/index.ts',import.meta.url),'utf8')
  const screen = readFileSync(new URL('../../src/screens/AdminPaymentsScreen.tsx',import.meta.url),'utf8')
  assert.match(endpoint,/from\('manual_checkout_claims'\)/)
  assert.match(endpoint,/action === 'find-claim'/)
  assert.match(endpoint,/\.range\(offset, offset \+ pageSize - 1\)/)
  assert.match(endpoint,/rpc\('review_manual_checkout_claim'/)
  assert.match(endpoint,/from\('orders'\)/)
  for (const status of ['awaiting_proof','pending_verification','approved','rejected']) assert.ok(screen.includes(status),`missing ${status}`)
  assert.match(screen,/\['pending', 'PENDING'\]/)
  assert.doesNotMatch(screen,/Mark proof received/i)
  assert.match(screen,/manual_claim_id/)
  assert.match(screen,/claimsByStatus/)
  assert.match(screen,/Approve\s*&(?:amp;)?\s*unlock/i)
  assert.match(screen,/Find by submission ID/i)
})

test('checkout creates a guarded server claim before opening Messenger', () => {
  const screen = readFileSync(new URL('../../src/screens/AdminQrCheckoutScreen.tsx',import.meta.url),'utf8')
  const endpoint = readFileSync(new URL('../../supabase/functions/create-manual-checkout-claim/index.ts',import.meta.url),'utf8')
  assert.match(screen,/functions\.invoke\('create-manual-checkout-claim'/)
  assert.doesNotMatch(screen,/navigator\.clipboard\.writeText\(message\)/)
  assert.match(screen,/window\.open\('about:blank', '_blank'\)/)
  assert.match(screen,/messengerTab\.location\.replace\(messengerUrl\)/)
  assert.doesNotMatch(screen,/window\.location\.assign\(messengerUrl\)/)
  assert.match(endpoint,/authClient\.auth\.getUser\(\)/)
  assert.match(endpoint,/p_user_id: user\.id/)
  assert.match(endpoint,/rpc\('create_manual_checkout_claim_unique_tracks'/)
  assert.doesNotMatch(screen,/\.from\('manual_checkout_claims'\)\.insert/)
  const config = readFileSync(new URL('../../supabase/config.toml',import.meta.url),'utf8')
  assert.match(config,/\[functions\.create-manual-checkout-claim\]\s*verify_jwt = true/)
})

test('account deletion refuses unsettled Messenger claims', () => {
  const code = readFileSync(new URL('../../supabase/functions/delete-account/index.ts',import.meta.url),'utf8')
  assert.match(code,/from\('manual_checkout_claims'\)/)
  assert.match(code,/pending_verification/)
  assert.match(code,/awaiting_proof/)
})

test('account retention and automated expiry protect in-review Messenger claims', () => {
  const expiration = readFileSync(new URL('../../supabase/functions/expire-inactive-accounts/index.ts',import.meta.url),'utf8')
  const administration = readFileSync(new URL('../../supabase/functions/admin-license-management/index.ts',import.meta.url),'utf8')
  assert.match(expiration,/from\('manual_checkout_claims'\)/)
  assert.match(expiration,/freshPendingClaim/)
  assert.match(expiration,/begin_checkout_account_deletion/)
  assert.match(expiration,/cancel_checkout_account_deletion/)
  assert.match(administration,/from\('manual_checkout_claims'\)/)
  assert.match(administration,/pending_verification/)
})
