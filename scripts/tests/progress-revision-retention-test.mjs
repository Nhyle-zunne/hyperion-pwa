// Synthetic PostgreSQL test: existing recovery points are immutable; only
// post-cutover revisions participate in future-only account-scoped retention.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migrations = [
  '20261026071721_create_user_learning_progress.sql',
  '20261028181820_revoke_client_execute_on_learning_progress_trigger.sql',
  '20261029032520_revoke_client_access_to_learning_progress.sql',
  '20261031094513_add_low_egress_progress_snapshot_comparison.sql',
  '20261102090000_preserve_saved_progress_and_session_audits.sql',
  '20261104010000_optimize_progress_revision_storage.sql',
  '20261104020000_preserve_exact_progress_noops.sql'
]
const retentionMigration = '20261104030000_bound_future_progress_revisions.sql'
const a = '11111111-1111-4111-8111-111111111111'
const b = '22222222-2222-4222-8222-222222222222'
const wrap = items => JSON.stringify({ version: 0, state: { items } })
const snapshot = () => ({
  version: 1, savedAt: 100, changedSections: [], activeSessionChangedAt: 1,
  activeSession: {
    sessionId: 'synthetic-session', track: 'DECK_OIC_NW',
    questions: [{ id: 'synthetic-1' }], answers: { 'synthetic-1': { selectedIndex: 1 } }
  },
  storage: {
    'hyperion-bookmarks': wrap([{ id: 'synthetic-bookmark', savedAt: 1 }]),
    'hyperion-vault': wrap([{ id: 'synthetic-mistake', lastWrongAt: 1, wrongCount: 1 }]),
    'hyperion-progress-deletions': JSON.stringify({ version: 1, bookmarks: {}, vault: {} }),
    'hyperion-history': JSON.stringify({ version: 0, state: { entries: [], savedSessions: [] } }),
    'hyperion-study-time': JSON.stringify({ version: 0, state: { segments: [] } })
  }
})

const db = new PGlite()
const allRevisions = () => db.query('select id,user_id,data,captured_at::text as captured_at from public.user_learning_progress_revisions order by id')
const future = async (userId, cutoff) => (await db.query(
  'select id,data from public.user_learning_progress_revisions where user_id=$1 and id>$2 order by id',
  [userId, cutoff]
)).rows
const userRow = async userId => (await db.query('select data from public.user_learning_progress where user_id=$1', [userId])).rows[0].data
const update = (userId, marker, key = 'retentionMarker') => db.query(
  "update public.user_learning_progress set data=jsonb_set(data, array[$2],to_jsonb($3::integer),true) where user_id=$1",
  [userId, key, marker]
)

try {
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;`)
  for (const name of migrations) await db.exec(await readFile('supabase/migrations/' + name, 'utf8'))
  await db.query('insert into auth.users values($1),($2)', [a,b])
  await db.query('insert into public.user_learning_progress(user_id,data) values($1,$2),($3,$4)', [a,snapshot(),b,snapshot()])

  // Older backups intentionally exceed the future cap before migration.
  for (let n=0; n<25; n++) await update(a,n,'legacyMarker')
  for (let n=0; n<7; n++) await update(b,n,'legacyMarker')
  const original = (await allRevisions()).rows
  assert.ok(original.length > 20)
  const highestOriginalId = original.at(-1).id

  const migration = await readFile('supabase/migrations/' + retentionMigration, 'utf8')
  await db.exec(migration)
  let policy = (await db.query('select * from public.user_learning_progress_revision_retention')).rows
  assert.equal(policy.length,1)
  assert.equal(Number(policy[0].protected_through_id),Number(highestOriginalId))
  assert.equal(policy[0].max_future_per_account,10)
  assert.equal(policy[0].enabled,true)
  assert.deepEqual((await allRevisions()).rows,original,
    'Applying retention must never change or remove a pre-existing revision')

  // 50 meaningful changes to one account, 18 to another: both retain 10 newest
  // post-cutover snapshots, with all prior recovery points still intact.
  for (let n=0; n<50; n++) await update(a,n,'futureOrdinal')
  for (let n=0; n<18; n++) await update(b,n,'futureOrdinal')
  const retainedA = await future(a,highestOriginalId)
  const retainedB = await future(b,highestOriginalId)
  assert.equal(retainedA.length,10)
  assert.equal(retainedB.length,10)
  assert.deepEqual(retainedA.map(x=>x.data.futureOrdinal),Array.from({length:10},(_,i)=>i+39))
  assert.deepEqual(retainedB.map(x=>x.data.futureOrdinal),Array.from({length:10},(_,i)=>i+7))
  assert.deepEqual((await allRevisions()).rows.filter(x=>x.id<=highestOriginalId),original,
    'The complete historical baseline is never eligible for future retention')
  assert.equal((await userRow(a)).futureOrdinal,49)
  assert.equal((await userRow(b)).futureOrdinal,17)
  assert.equal((await userRow(a)).activeSession.answers['synthetic-1'].selectedIndex,1)
  assert.equal(JSON.parse((await userRow(a)).storage['hyperion-bookmarks']).state.items[0].id,'synthetic-bookmark')
  assert.equal(JSON.parse((await userRow(a)).storage['hyperion-vault']).state.items[0].id,'synthetic-mistake')

  // The policy must never prune when the write has no meaningful change.
  const initialCount = (await allRevisions()).rows.length
  const noop = structuredClone(await userRow(a))
  noop.savedAt=909090; noop.changedSections=['bookmarks']
  await db.query('update public.user_learning_progress set data=$2 where user_id=$1',[a,noop])
  assert.equal((await allRevisions()).rows.length,initialCount)

  // Account-scoped recovery is still callable; dry-run changes no data.
  const beforeRecovery = await userRow(a)
  const check = await db.query('select public.recover_learning_progress_collections($1,false) as recovery',[a])
  assert.equal(check.rows[0].recovery.found,true)
  assert.deepEqual(await userRow(a),beforeRecovery)

  // An operator can pause pruning without interrupting study progress.
  await db.exec('update public.user_learning_progress_revision_retention set enabled=false')
  for(let n=50;n<55;n++) await update(a,n,'futureOrdinal')
  assert.equal((await future(a,highestOriginalId)).length,15)
  await db.exec('update public.user_learning_progress_revision_retention set enabled=true')
  await update(a,55,'futureOrdinal')
  assert.equal((await future(a,highestOriginalId)).length,10)
  assert.deepEqual((await allRevisions()).rows.filter(x=>x.id<=highestOriginalId),original)

  // Missing-policy fallback preserves progress, never deletes it.
  await db.exec('delete from public.user_learning_progress_revision_retention')
  const beforeMissing = (await allRevisions()).rows.length
  await update(a,56,'futureOrdinal')
  assert.equal((await allRevisions()).rows.length,beforeMissing+1)
  assert.equal((await userRow(a)).futureOrdinal,56)
  // Reapplying the migration restores a new policy, but does not touch records.
  const priorToReplay = (await allRevisions()).rows
  await db.exec(migration)
  assert.deepEqual((await allRevisions()).rows,priorToReplay)

  const access = await db.query("select relrowsecurity from pg_class where oid='public.user_learning_progress_revision_retention'::regclass")
  assert.equal(access.rows[0].relrowsecurity,true)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from public.user_learning_progress_revision_retention'),/permission denied/)
  await db.exec('reset role')
  await db.exec('set role anon')
  await assert.rejects(db.query('select * from public.user_learning_progress_revision_retention'),/permission denied/)
  await db.exec('reset role')

  console.log('PASS: historical revisions preserved, 10 future/account, separate owners, no-op, progress/answers retained, recovery, fail-safe missing policy, RLS.')
} finally {
  await db.close()
}
