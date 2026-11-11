// Isolated PostgreSQL/PGlite regression. Never connects to production.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migration = '20261111233000_add_incremental_progress_sections.sql'
const baseline = [
  '20261026071721_create_user_learning_progress.sql',
  '20261028181820_revoke_client_execute_on_learning_progress_trigger.sql',
  '20261029032520_revoke_client_access_to_learning_progress.sql',
  '20261031094513_add_low_egress_progress_snapshot_comparison.sql',
  '20261102090000_preserve_saved_progress_and_session_audits.sql',
  '20261104010000_optimize_progress_revision_storage.sql',
  '20261104020000_preserve_exact_progress_noops.sql',
  '20261104030000_bound_future_progress_revisions.sql'
]
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const b = x => JSON.stringify({ version: 0, state: { items: x } })
const h = x => JSON.stringify({ version: 0, state: { entries: x, savedSessions: [] } })
const snapshot = () => ({
  version: 1, savedAt: 100, changedSections: [], activeSessionChangedAt: 0, activeSession: null,
  storage: { 'hyperion-bookmarks': b([{ id: 'first', savedAt: 100, track: 'DECK_OIC_NW' }]),
    'hyperion-history': h([{ id: 'completed-1', finishedAt: 110 }]),
    'hyperion-progress-deletions': JSON.stringify({ version: 1, bookmarks: {}, vault: {} }) }
})
const db = new PGlite()
async function versions(user = owner, keys = ['hyperion-bookmarks', 'hyperion-history', 'hyperion-progress-deletions']) {
  return (await db.query('select public.read_learning_progress_sections($1,$2::text[]) result', [user, keys])).rows[0].result
}
async function write(user, id, changes) {
  const r = await db.query('select public.write_learning_progress_sections($1,$2,$3::jsonb) result', [user,id,JSON.stringify(changes)])
  return r.rows[0].result
}
const change = (key, value, expected_version) => [{ key, value, expected_version }]
async function row(user=owner) {
  return (await db.query('select data,updated_at::text as updated_at from public.user_learning_progress where user_id=$1',[user])).rows[0]
}
async function nrevisions() {
  return Number((await db.query('select count(*) n from public.user_learning_progress_revisions')).rows[0].n)
}
try {
  await db.exec(`create role anon;create role authenticated;create role service_role;
    create schema auth;create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;`)
  for (const file of baseline) await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
  await db.query('insert into auth.users(id) values($1),($2)',[owner,other])
  await db.query('insert into user_learning_progress(user_id,data) values($1,$2),($3,$4)',[owner,snapshot(),other,snapshot()])
  const before=await row(), originalRevisions=await nrevisions()
  const migrationSql=await readFile('supabase/migrations/'+migration,'utf8')
  await db.exec(migrationSql)
  assert.deepEqual(await row(),before, 'Applying the migration never mutates existing progress')
  assert.equal(await nrevisions(),originalRevisions, 'No recovery history is rewritten or pruned')

  const base=await versions()
  const sessionVersion=base.versions['hyperion-history']
  const bookmarkVersion=base.versions['hyperion-bookmarks']
  assert.equal(JSON.parse(base.storage['hyperion-bookmarks']).state.items.length,1)
  const opA='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
  const opB='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
  const addBookmark=change('hyperion-bookmarks',b([{id:'second',savedAt:300,track:'DECK_OIC_NW'}]),bookmarkVersion)
  const acknowledgement=await write(owner,opA,addBookmark)
  assert.equal(acknowledgement.ok,true)
  assert.equal(acknowledgement.conflict,undefined)
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-history']),JSON.parse(before.data.storage['hyperion-history']), 'Independent bookmark writes preserve the history content')
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-bookmarks']).state.items.map(x=>x.id).sort(),['first','second'])
  const revisionsAfterA=await nrevisions()
  assert.equal(revisionsAfterA,originalRevisions+1, 'Genuine delta retains recovery revision')
  assert.deepEqual(await write(owner,opA,addBookmark),acknowledgement,'Retry after lost response returns original acknowledgement')
  assert.equal(await nrevisions(),revisionsAfterA,'Acknowledged replay never rewrites progress')
  const changedPayload=change('hyperion-bookmarks',b([{id:'surprise',savedAt:999}]),bookmarkVersion)
  const idReuse=await write(owner,opA,changedPayload)
  assert.equal(idReuse.invalid_operation,true,'An operation ID cannot be reused with different content')

  // A stale bookmark token cannot overwrite a newer bookmark, but an
  // unrelated stale history token is still valid after a bookmark update.
  const conflict=await write(owner,opB,change('hyperion-bookmarks',b([{id:'stale',savedAt:200}]),bookmarkVersion))
  assert.deepEqual(conflict.conflicts,['hyperion-bookmarks'])
  const historyOp='cccccccc-cccc-4ccc-8ccc-cccccccccccc'
  const newHistory=change('hyperion-history',h([{id:'completed-1',finishedAt:110},{id:'completed-2',finishedAt:310}]),sessionVersion)
  assert.equal((await write(owner,historyOp,newHistory)).ok,true,'Independent sections accept unrelated simultaneous edits')
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-history']).state.entries.map(x=>x.id),['completed-1','completed-2'])

  // A deletion is explicit. Sending an empty bookmark wrapper never drops a
  // stored item. Timestamped ledger tombstones persist through stale clients.
  const newer=await versions()
  const deleteOp='dddddddd-dddd-4ddd-8ddd-dddddddddddd'
  const tomb=JSON.stringify({version:1,bookmarks:{first:{at:500,deleted:true}},vault:{}})
  const deletion=await write(owner,deleteOp,change('hyperion-progress-deletions',tomb,newer.versions['hyperion-progress-deletions']))
  assert.equal(deletion.ok,true)
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-bookmarks']).state.items.map(x=>x.id),['second'])
  const emptyOp='eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'
  const current=await versions()
  assert.equal((await write(owner,emptyOp,change('hyperion-bookmarks',b([]),current.versions['hyperion-bookmarks']))).ok,true)
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-bookmarks']).state.items.map(x=>x.id),['second'])
  assert.equal((await write(owner,'ffffffff-ffff-4fff-8fff-ffffffffffff',
    change('hyperion-bookmarks',b([{id:'first',savedAt:100}]),(await versions()).versions['hyperion-bookmarks']))).ok,true)
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-bookmarks']).state.items.map(x=>x.id),['second'],'Old offline saves cannot resurrect a tombstoned item')

  const otherBefore=await row(other)
  const otherV=await versions(other,['hyperion-bookmarks'])
  assert.notEqual(otherV.versions['hyperion-bookmarks'],base.versions['hyperion-bookmarks'],'Section versions are owner-scoped')
  assert.deepEqual((await row(other)).data,otherBefore.data,'Different owners cannot see or overwrite one another')
  const foreign=await write(other,'11111111-2222-4333-8444-555555555555',change('hyperion-bookmarks',b([]),base.versions['hyperion-bookmarks']))
  assert.deepEqual(foreign.conflicts,['hyperion-bookmarks'],'Owner A opaque token is invalid for owner B')

  const prior=await row()
  const invalid=await write(owner,'22222222-3333-4444-8555-666666666666',
    change('unknown-key','oops','anything'))
  assert.equal(invalid.invalid_operation,true)
  assert.deepEqual(await row(),prior,'Invalid operation is atomic and preserves stored progress')
  assert.equal(await db.query('select count(*) n from user_learning_progress_section_operations').then(r=>Number(r.rows[0].n))>=4,true)

  // The old full-snapshot compare-and-swap contract must reject a stale
  // version after a section mutation, then preserve unrelated collections.
  assert.equal((await db.query('select public.compare_user_learning_progress($1,$2,$3::jsonb) result',
    [owner,before.updated_at,JSON.stringify(snapshot())])).rows[0].result,'conflict')
  const legacy={...prior.data, savedAt:Date.now()}
  legacy.storage['hyperion-study-time']=JSON.stringify({version:0,state:{segments:[{id:'time-a',at:700}]}})
  await db.query('update public.user_learning_progress set data=$2 where user_id=$1',[owner,legacy])
  assert.deepEqual(JSON.parse((await row()).data.storage['hyperion-bookmarks']).state.items.map(x=>x.id),['second'])
  assert.equal(JSON.parse((await row()).data.storage['hyperion-study-time']).state.segments[0].id,'time-a')

  // No direct table access or RPC execution for clients; Edge service role
  // verifies the JWT and binds the user ID, including on both V2 actions.
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select public.read_learning_progress_sections($1,$2::text[])',[owner,['hyperion-history']]),/permission denied/)
  await assert.rejects(db.query('select public.write_learning_progress_sections($1,$2,$3::jsonb)',
    [owner,'99999999-9999-4999-8999-999999999999',JSON.stringify(addBookmark)]),/permission denied/)
  await assert.rejects(db.query('select * from user_learning_progress_section_operations'),/permission denied/)
  await db.exec('reset role')
  console.log('PASS: independent section revisions, atomic conflicts, replay receipts, tombstones, compatibility, isolation, retained recovery')
} finally { await db.close() }
