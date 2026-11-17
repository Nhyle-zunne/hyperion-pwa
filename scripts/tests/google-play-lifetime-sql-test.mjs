import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const id = v => v.repeat(64)
const link = async (user, product, hash) => (await db.query(
  'select public.link_verified_google_play_lifetime($1,$2,$3) value',
  [user,product,hash]
)).rows[0].value
const voided = async hash => (await db.query(
  'select public.record_voided_google_play_lifetime($1) value',[hash]
)).rows[0].value
const status = async (provider, hash) => (await db.query(
  'select status from public.lifetime_entitlements where provider=$1 and purchase_ref_sha256=$2',
  [provider,hash]
)).rows[0]?.status

try {
  await db.exec([
    'create role anon;',
    'create role authenticated;',
    'create role service_role bypassrls;',
    'create schema auth;',
    "create function auth.uid() returns uuid language sql stable as 'select null::uuid';",
    'create table auth.users(id uuid primary key);',
    "insert into auth.users(id) values('"+owner+"'),('"+other+"');",
    'create table public.entitlements (user_id uuid,track_id text,status text,expires_at timestamptz);',
    'create table public.google_play_entitlements (user_id uuid,track_id text,status text,expires_at timestamptz);',
    'grant select,insert,update on public.entitlements,public.google_play_entitlements to service_role;'
  ].join('\n'))
  for (const name of [
    '20261116230813_add_lifetime_entitlement_foundation.sql',
    '20261117014902_verify_google_play_lifetime_receipts.sql'
  ]) {
    const contents = await readFile(new URL('../../supabase/migrations/' + name,import.meta.url),'utf8')
    await db.exec(contents)
  }
  await db.exec('set role service_role')
  assert.equal(await link(owner,'oic_nw',id('a')),true)
  assert.equal(await status('google_play',id('a')),'active')
  await assert.rejects(link(other,'oic_nw',id('a')),/already belongs/i,
    'A verified purchase cannot be reassigned to a second Hyperion account')
  await assert.rejects(link(owner,'gmdss',id('a')),/already belongs/i,
    'A receipt cannot grant a different reviewer track')
  assert.equal(await link(owner,'oic_nw',id('a')),true,'Safe receipt replay is idempotent')
  const expires = await db.query('select expires_at from public.get_active_paid_track_entitlements($1,$2)',
    [owner,'DECK_OIC_NW'])
  assert.equal(expires.rows.length,1,'Verified lifetime grants existing shared entitlement access')
  assert.equal(new Date(expires.rows[0].expires_at).getUTCFullYear(),9999)

  const paid = await db.query(
    "select public.record_verified_lifetime_entitlement($1,'oic_nw','paymongo',$2,'active') value",
    [owner,id('b')]
  )
  assert.equal(paid.rows[0].value,true)
  assert.equal(await voided(id('a')),true)
  assert.equal(await status('google_play',id('a')),'revoked')
  assert.equal(await status('paymongo',id('b')),'active',
    'A refunded Play purchase does not revoke PayMongo lifetime access on the same track')
  assert.equal(await voided(id('a')),true,'Duplicate authenticated refund is harmless')
  assert.equal(await link(owner,'oic_nw',id('a')),false,
    'Revoked Play receipt must never restore permanent access')
  assert.equal(await voided(id('c')),true,'Void may arrive before the initial purchase link')
  assert.equal(await link(other,'engine_ew',id('c')),false,
    'A late verified purchase cannot resurrect a voided receipt')
  assert.equal(await link(other,'engine_ew',id('d')),true,
    'Other accounts and tracks remain independent')

  await db.exec('reset role')
  for(const role of ['anon','authenticated']) {
    await db.exec('set role '+role)
    await assert.rejects(link(owner,'oic_nw',id('e')),/permission denied/i,
      'Only the verified server can grant Lifetime licenses')
    await assert.rejects(voided(id('e')),/permission denied/i)
    await db.exec('reset role')
  }
  console.log('PASS: Play Lifetime receipt ownership, signed lease access, void-first races, permanent revocation and RLS')
} finally { await db.close() }
