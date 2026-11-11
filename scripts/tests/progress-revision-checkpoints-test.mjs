import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../supabase/migrations/', import.meta.url)
const base = [
  '20261026071721_create_user_learning_progress.sql',
  '20261028181820_revoke_client_execute_on_learning_progress_trigger.sql',
  '20261029032520_revoke_client_access_to_learning_progress.sql',
  '20261031094513_add_low_egress_progress_snapshot_comparison.sql',
  '20261102090000_preserve_saved_progress_and_session_audits.sql',
  '20261104010000_optimize_progress_revision_storage.sql',
  '20261104020000_preserve_exact_progress_noops.sql'
]
const checkpoint = '20261112010000_throttle_recovery_checkpoints.sql'
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const db = new PGlite()
const snapshot = {version:1,savedAt:1,activeSession:null,storage:{}}
const revisions = async id => (await db.query(
  'select id,user_id,data,captured_at::text from public.user_learning_progress_revisions where user_id=$1 order by id', [id]
)).rows
const saved = async id => (await db.query(
  'select data from public.user_learning_progress where user_id=$1', [id]
)).rows[0].data
const write = async (owner, value) => db.query(
  "update public.user_learning_progress set data=jsonb_set(data,'{syntheticStep}',to_jsonb($2::integer),true) where user_id=$1",
  [owner,value]
)
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select null::uuid$$;')
  for(const file of base) await db.exec(await readFile(new URL(file,root),'utf8'))
  await db.query('insert into auth.users values($1),($2)',[a,b])
  await db.query('insert into public.user_learning_progress(user_id,data) values($1,$2),($3,$4)',
    [a,snapshot,b,snapshot])
  // Preexisting revisions must survive the new migration exactly.
  await write(a,1)
  await write(a,2)
  const originalA = await revisions(a)
  const originalB = await revisions(b)
  // Install the existing 10-revision cap AFTER these old recovery records;
  // only subsequent records may be pruned.
  await db.exec(await readFile(new URL('20261104030000_bound_future_progress_revisions.sql',root),'utf8'))
  const oldCutoff = Number((await db.query(
    'select protected_through_id from public.user_learning_progress_revision_retention'
  )).rows[0].protected_through_id)
  await db.exec(await readFile(new URL(checkpoint,root),'utf8'))
  assert.deepEqual(await revisions(a),originalA)
  assert.deepEqual(await revisions(b),originalB)
  assert.equal(Number((await db.query('select min_checkpoint_seconds n from public.user_learning_progress_revision_retention')).rows[0].n),300)

  await write(a,3)
  const first = await revisions(a)
  assert.equal(first.length,originalA.length+1,
    'First future recovery point is never skipped when the account has no recent future backup')
  assert.equal(first.at(-1).data.syntheticStep,2)
  for(let i=4;i<=22;i++) await write(a,i)
  assert.equal((await revisions(a)).length,first.length,
    'Repeated real saves during the interval change current progress but not backup/WAL')
  assert.equal((await saved(a)).syntheticStep,22)
  assert.equal((await revisions(b)).length,0,'Other owners are never checkpointed by unrelated edits')

  await write(b,1)
  assert.equal((await revisions(b)).length,1,'Each owner gets an independent initial backup')

  // Deletions and completed exams are safety-critical: capture even inside 5min.
  const deletion = {version:1,bookmarks:{item1:{at:100,deleted:true}},vault:{}}
  await db.query(
    "update public.user_learning_progress set data=jsonb_set(data,'{storage,hyperion-progress-deletions}',to_jsonb($2::text),true) where user_id=$1",
    [a,JSON.stringify(deletion)]
  )
  assert.equal((await revisions(a)).length,first.length+1,'Explicit deletion gets an immediate rollback point')
  assert.equal(JSON.parse((await saved(a)).storage['hyperion-progress-deletions']).bookmarks.item1.deleted,true)
  const completed = {sessionId:'exam1',track:'DECK_OIC_NW',questions:[{id:'q1'}],answers:{q1:{selectedIndex:1}},finished:true}
  await db.query(
    "update public.user_learning_progress set data=jsonb_set(data,'{activeSession}',$2::jsonb,true) where user_id=$1",
    [a,completed]
  )
  assert.equal((await revisions(a)).length,first.length+2,'Completed exams get immediate recovery boundary')
  assert.equal((await saved(a)).activeSession.finished,true)

  // Rolling cap still keeps ten full independent *future* backups; preserve all old IDs.
  await db.exec('update public.user_learning_progress_revision_retention set min_checkpoint_seconds=0')
  for(let i=23;i<42;i++) await write(a,i)
  const final = await revisions(a)
  assert.equal(final.filter(row=>Number(row.id)>oldCutoff).length,10)
  assert.deepEqual(final.filter(row=>Number(row.id)<=oldCutoff),originalA)
  assert.equal((await saved(a)).syntheticStep,41)

  const countBefore = final.length
  const repeat = structuredClone(await saved(a))
  repeat.savedAt = 999999; repeat.changedSections=['history']
  await db.query('update public.user_learning_progress set data=$2 where user_id=$1',[a,repeat])
  assert.equal((await revisions(a)).length,countBefore,'No-op never creates a recovery snapshot')

  // A missing policy errs on the side of backups, without deleting anything.
  await db.exec('delete from public.user_learning_progress_revision_retention')
  await write(a,42)
  assert.equal((await revisions(a)).length,countBefore+1)
  assert.equal((await saved(a)).syntheticStep,42)

  const security = await db.query(
    "select relrowsecurity from pg_class where oid='public.user_learning_progress_revision_retention'::regclass"
  )
  assert.equal(security.rows[0].relrowsecurity,true)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from public.user_learning_progress_revision_retention'),
    /permission denied/)
  await db.exec('reset role')
  console.log('PASS: checkpoint spacing, critical deletion/completion boundaries, existing backup preservation, 10 recent recoveries, no-ops, fail-safe and RLS')
} finally {
  await db.close()
}
