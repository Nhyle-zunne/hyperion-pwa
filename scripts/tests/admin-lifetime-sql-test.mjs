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
    '20261122154019_admin_lifetime_track_grants.sql',
  ]) {
    await db.exec(await readFile(new URL('../../supabase/migrations/' + migration, import.meta.url), 'utf8'))
  }
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

  for (const role of ['anon', 'authenticated']) {
    await db.exec('reset role')
    await db.exec('set role ' + role)
    await assert.rejects(setLifetime('oic_nw', true), /permission denied/i)
    await assert.rejects(setLifetime('oic_nw', false), /permission denied/i)
  }
  console.log('PASS: Manual lifetime grant, revoke, regrant, idempotency, paid entitlement, and authorization')
} finally {
  await db.close()
}
