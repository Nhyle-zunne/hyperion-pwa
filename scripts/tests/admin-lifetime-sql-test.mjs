import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const user = '11111111-1111-4111-8111-111111111111'
const admin = '22222222-2222-4222-8222-222222222222'
const available = async track => (await db.query(
  'select exists(select from public.get_active_paid_track_entitlements($1,$2)) as result', [user, track]
)).rows[0].result
const setLifetime = async (product, active) => (await db.query(
  'select public.set_admin_lifetime_entitlement($1,$2,$3,$4,$5,$6) as changed',
  [user, product, active, admin, 'admin@example.invalid', 'Test reason']
)).rows[0].changed

const revokePurchased = async (product, actingAdmin = admin) => (await db.query(
  'select public.revoke_admin_purchased_lifetime($1,$2,$3,$4,$5) as changed',
  [user, product, actingAdmin, 'admin@example.invalid', 'Purchase review']
)).rows[0].changed

try {
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as 'select null::uuid';
    create table auth.users(id uuid primary key);
    insert into auth.users(id) values ('${user}'), ('${admin}');
    create table public.entitlements (user_id uuid, track_id text, status text, expires_at timestamptz, order_id uuid not null);
    create table public.google_play_entitlements (user_id uuid, track_id text, status text, expires_at timestamptz);
    grant select on public.entitlements, public.google_play_entitlements to service_role;
  `)
  for (const migration of [
    '20261027041500_admin_license_management.sql',
    '20261116230813_add_lifetime_entitlement_foundation.sql',
    '20261117014902_verify_google_play_lifetime_receipts.sql',
    '20261122154019_admin_lifetime_track_grants.sql',
    '20261128044512_admin_revoke_purchased_lifetime.sql',
  ]) {
    await db.exec(await readFile(new URL('../../supabase/migrations/' + migration, import.meta.url), 'utf8'))
  }
  const checkoutMigration = await readFile(new URL('../../supabase/migrations/20261125013418_manual_checkout_claims.sql', import.meta.url), 'utf8')
  // The larger checkout migration depends on unrelated tables. Apply its provider constraint here.
  const providerConstraint = checkoutMigration.match(/alter table public\.lifetime_entitlements\s+drop constraint lifetime_entitlements_provider_check,[\s\S]*?;/i)
  assert(providerConstraint)
  await db.exec(providerConstraint[0])
  await db.exec('grant insert, select on public.license_admin_audit to service_role')
  await db.exec('set role service_role')
  assert.equal(await setLifetime('oic_nw', false), false)
  assert.equal(await setLifetime('oic_nw', true), true)
  assert.equal(await setLifetime('oic_nw', true), false)
  assert.equal(await available('DECK_OIC_NW'), true)
  assert.equal(await available('ENGINE_OIC_EW'), false)
  assert.equal(await setLifetime('oic_nw', false), true)
  assert.equal(await setLifetime('oic_nw', false), false)
  assert.equal(await available('DECK_OIC_NW'), false)
  assert.equal(await setLifetime('oic_nw', true), true)
  await db.query(
    "select public.record_verified_lifetime_entitlement($1,'oic_nw','paymongo',$2,'active')",
    [user, 'a'.repeat(64)]
  )
  assert.equal(await setLifetime('oic_nw', false), true)
  assert.equal(await available('DECK_OIC_NW'), true, 'The paid entitlement survives revocation of the manual grant')

  const audit = await db.query(`
    select action, count(*)::int as count from public.license_admin_audit
    where license_term = 'lifetime' and note = 'Test reason' and new_expires_at is null
    group by action order by action
  `)
  assert.deepEqual(audit.rows, [{ action: 'grant', count: 2 }, { action: 'revoke', count: 2 }])

  const linkPlay = async () => db.query(
    "select public.link_verified_google_play_lifetime($1, 'oic_nw', $2)", [user, 'b'.repeat(64)]
  )
  const purchaseStates = async () => (await db.query(
    "select provider, status, revoked_at is not null as revoked from public.lifetime_entitlements where user_id=$1 and product_code='oic_nw' and provider <> 'admin' order by provider",
    [user]
  )).rows
  await linkPlay()
  await db.query(`
    insert into public.lifetime_entitlements (user_id, product_code, track_id, provider, purchase_ref_sha256, status)
    values ($1,'oic_nw','DECK_OIC_NW','manual',repeat('c',64),'active'),
           ($1,'gmdss','GMDSS_GOC','manual',repeat('d',64),'active'),
           ($2,'oic_nw','DECK_OIC_NW','manual',repeat('e',64),'active')
  `, [user, admin])
  await assert.rejects(revokePurchased('oic_nw', '33333333-3333-4333-8333-333333333333'), /foreign key/i)
  assert.ok((await purchaseStates()).every(row => row.status === 'active'), 'Failed audit write rolls back the revocation')
  assert.equal(await setLifetime('oic_nw', true), true)
  assert.equal(await revokePurchased('oic_nw'), true)
  assert.equal(await revokePurchased('oic_nw'), false, 'Repeated requests neither change access nor add audit rows')
  assert.deepEqual(await purchaseStates(), ['google_play', 'manual', 'paymongo'].map(provider => ({ provider, status: 'revoked', revoked: true })))
  assert.equal(await available('DECK_OIC_NW'), true, 'A separate admin grant remains active')
  assert.equal(await setLifetime('oic_nw', false), true)
  assert.equal(await available('DECK_OIC_NW'), false)
  assert.equal(await available('GMDSS_GOC'), true, 'Other tracks stay active')
  assert.equal((await db.query("select status from public.lifetime_entitlements where user_id=$1 and product_code='oic_nw'", [admin])).rows[0].status, 'active', 'Other accounts stay active')

  await linkPlay()
  await db.query("select public.record_verified_lifetime_entitlement($1,'oic_nw','paymongo',$2,'active')", [user, 'a'.repeat(64)])
  assert.equal(await available('DECK_OIC_NW'), false, 'Replaying revoked receipts does not restore access')
  const purchaseAudit = await db.query(
    "select user_id, track_id, action, prior_status, new_status, license_term, admin_user_id from public.license_admin_audit where note like '%Purchase review%'"
  )
  assert.deepEqual(purchaseAudit.rows, [{
    user_id: user, track_id: 'DECK_OIC_NW', action: 'revoke', prior_status: 'active',
    new_status: 'revoked', license_term: 'lifetime', admin_user_id: admin
  }])

  for (const role of ['anon', 'authenticated']) {
    await db.exec('reset role')
    await db.exec('set role ' + role)
    await assert.rejects(setLifetime('oic_nw', true), /permission denied/i)
    await assert.rejects(setLifetime('oic_nw', false), /permission denied/i)
    await assert.rejects(revokePurchased('oic_nw'), /permission denied/i)
  }
  console.log('PASS: Lifetime grant, purchased revocation, audit rollback, receipt replay, account and track isolation, and authorization')
} finally {
  await db.close()
}
