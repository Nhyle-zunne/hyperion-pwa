import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../supabase/migrations/', import.meta.url)
const userA = '11111111-1111-4111-8111-111111111111'
const userB = '22222222-2222-4222-8222-222222222222'
const db = new PGlite()
try {
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create table public.entitlements (
      user_id uuid not null, track_id text not null,
      status text not null, expires_at timestamptz
    );
    create table public.google_play_entitlements (
      user_id uuid not null, track_id text not null,
      status text not null, expires_at timestamptz not null
    );
    grant select on public.entitlements, public.google_play_entitlements to service_role;
  `)
  await db.query(`
    insert into public.entitlements (user_id,track_id,status,expires_at) values
      ($1,'DECK_OIC_NW','active',now()+interval '1 day'),
      ($1,'GMDSS_GOC','expired',now()-interval '1 day'),
      ($1,'ENGINE_MGT','revoked',now()+interval '1 day'),
      ($2,'DECK_MGT','active',now()+interval '1 day')
  `, [userA,userB])
  await db.query(`
    insert into public.google_play_entitlements (user_id,track_id,status,expires_at) values
      ($1,'DECK_OIC_NW','active',now()+interval '2 days'),
      ($1,'ENGINE_OIC_EW','active',now()+interval '3 days'),
      ($1,'ENGINE_MGT','revoked',now()+interval '1 day'),
      ($1,'GMDSS_GOC','active',now()-interval '1 day'),
      ($2,'GMDSS_GOC','active',now()+interval '1 day')
  `,[userA,userB])
  const tableCounts = (await db.query(
    'select (select count(*) from public.entitlements) web, (select count(*) from public.google_play_entitlements) play'
  )).rows[0]

  await db.exec(await readFile(
    new URL('20261112001500_unify_current_paid_entitlement_reads.sql',root),'utf8'
  ))
  await db.exec('set role service_role')
  const current = await db.query(
    'select user_id,track_id,expires_at from public.get_active_paid_track_entitlements($1,null) order by track_id',[userA]
  )
  assert.deepEqual(current.rows.map(row=>row.track_id),['DECK_OIC_NW','ENGINE_OIC_EW'])
  assert.ok(current.rows.every(row=>row.user_id===userA), 'RPC returns only the specified owner')
  const nw = current.rows.find(row=>row.track_id==='DECK_OIC_NW')
  assert.ok(new Date(nw.expires_at).getTime() > Date.now() + 1.5*86400000,
    'Newest overlapping website / Play expiry wins without duplicate track rows')
  const filtered = await db.query(
    'select track_id from public.get_active_paid_track_entitlements($1,$2)',[userA,'ENGINE_OIC_EW']
  )
  assert.deepEqual(filtered.rows.map(row=>row.track_id),['ENGINE_OIC_EW'])
  const noGrant = await db.query(
    'select track_id from public.get_active_paid_track_entitlements($1,$2)',[userA,'GMDSS_GOC']
  )
  assert.equal(noGrant.rows.length,0,'Expired grants never unlock')
  const revoked = await db.query(
    'select track_id from public.get_active_paid_track_entitlements($1,$2)',[userA,'ENGINE_MGT']
  )
  assert.equal(revoked.rows.length,0,'Revoked grants never unlock')
  const other = await db.query(
    'select track_id from public.get_active_paid_track_entitlements($1,null) order by track_id',[userB]
  )
  assert.deepEqual(other.rows.map(row=>row.track_id),['DECK_MGT','GMDSS_GOC'])
  assert.equal((await db.query('select count(*) n from public.get_active_paid_track_entitlements(null,null)')).rows[0].n,0)
  await db.exec('reset role')
  assert.deepEqual((await db.query(
    'select (select count(*) from public.entitlements) web, (select count(*) from public.google_play_entitlements) play'
  )).rows[0],tableCounts,'RPC is strictly read only')

  for(const denied of ['anon','authenticated']){
    await db.exec('set role '+denied)
    await assert.rejects(
      db.query('select * from public.get_active_paid_track_entitlements($1,null)',[userA]),
      /permission denied/i, 'Only server-side service_role may invoke the RPC'
    )
    await db.exec('reset role')
  }
  console.log('PASS: current website/Google Play grants, latest expiry, account isolation, expiry/revocation, zero writes and private RPC grants')
} finally { await db.close() }
