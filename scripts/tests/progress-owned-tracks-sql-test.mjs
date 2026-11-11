import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../supabase/migrations/', import.meta.url)
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.entitlements (
      user_id uuid not null, track_id text not null,
      status text not null, expires_at timestamptz not null
    );
    create table public.google_play_entitlements (
      user_id uuid not null, track_id text not null,
      status text not null, expires_at timestamptz not null
    );
    grant select on public.entitlements, public.google_play_entitlements to service_role;
  `)
  await db.query(`
    insert into public.entitlements values
      ($1,'DECK_OIC_NW','active',now() + interval '1 day'),
      ($1,'GMDSS_GOC','expired',now() - interval '1 day'),
      ($2,'DECK_MGT','active',now() + interval '1 day')
  `, [a,b])
  await db.query(`
    insert into public.google_play_entitlements values
      ($1,'DECK_OIC_NW','revoked',now() - interval '1 day'),
      ($1,'ENGINE_OIC_EW','revoked',now() - interval '1 day'),
      ($2,'ENGINE_MGT','active',now() + interval '1 day')
  `, [a,b])
  const before = (await db.query(
    'select (select count(*) from public.entitlements) e, (select count(*) from public.google_play_entitlements) p'
  )).rows[0]
  await db.exec(await readFile(
    new URL('20261111184053_unify_progress_owned_tracks.sql',root),'utf8'
  ))
  await db.exec('set role service_role')
  const owned = await db.query(
    'select track_id from public.get_learning_progress_owned_tracks($1) order by track_id',[a]
  )
  assert.deepEqual(owned.rows.map(row=>row.track_id),
    ['DECK_OIC_NW','ENGINE_OIC_EW','GMDSS_GOC'],
    'Historical backup ownership retains expired/revoked tracks and deduplicates overlapping grants')
  const other = await db.query(
    'select track_id from public.get_learning_progress_owned_tracks($1) order by track_id',[b]
  )
  assert.deepEqual(other.rows.map(row=>row.track_id),['DECK_MGT','ENGINE_MGT'],
    'Each request sees only its explicit owner; no cross-account leakage')
  const unknown = await db.query('select * from public.get_learning_progress_owned_tracks($1)',[
    '33333333-3333-4333-8333-333333333333'
  ])
  assert.equal(unknown.rows.length,0)
  await db.exec('reset role')
  assert.deepEqual((await db.query(
    'select (select count(*) from public.entitlements) e, (select count(*) from public.google_play_entitlements) p'
  )).rows[0],before,'The read-only RPC does not modify either table')

  for(const deniedRole of ['anon','authenticated']){
    await db.exec('set role '+deniedRole)
    await assert.rejects(db.query(
      'select * from public.get_learning_progress_owned_tracks($1)',[a]
    ),/permission denied/i,'Public clients cannot call the service-only historical ownership RPC')
    await db.exec('reset role')
  }
  console.log('PASS: one-request historical ownership union, distinct tracks, expired ownership preservation, owner isolation, no writes and private invoker grants')
} finally { await db.close() }
