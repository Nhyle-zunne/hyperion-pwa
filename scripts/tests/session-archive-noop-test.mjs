import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const migrations = new URL('../../supabase/migrations/', import.meta.url)
const filename = (await readdir(migrations)).find(name => name.endsWith('_skip_unchanged_session_archives.sql'))
assert(filename, 'The archive deduplication migration must exist')
const db = new PGlite()
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const draft = { sessionId: 'draft', finished: false, answers: { q1: { selectedIndex: 1 } }, questions: [{ id: 'q1' }] }
const finished = { ...draft, finished: true }
const upsert = (user, id, data, timestamp = '2026-11-07T00:00:00Z') => db.query(`
  insert into public.user_learning_session_archives(user_id,session_id,data,updated_at) values($1,$2,$3,$4)
  on conflict(user_id,session_id) do update set data=excluded.data,updated_at=excluded.updated_at
  returning session_id`, [user, id, data, timestamp])
const read = async (user = owner, id = 'draft') => (await db.query(
  'select data,updated_at::text,xmin::text from public.user_learning_session_archives where user_id=$1 and session_id=$2', [user, id])).rows[0]
const allArchives = async () => (await db.query('select user_id,session_id,data,updated_at::text,xmin::text from public.user_learning_session_archives order by user_id,session_id')).rows
try {
  await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql as $$select null::uuid$$;`)
  await db.exec(await readFile(new URL('20261026071721_create_user_learning_progress.sql', migrations), 'utf8'))
  await db.exec(await readFile(new URL('20261102090000_preserve_saved_progress_and_session_audits.sql', migrations), 'utf8'))
  await db.query('insert into auth.users values($1),($2)', [owner, other])
  await upsert(owner, 'draft', draft, '2026-11-06T00:00:00Z')
  await upsert(owner, 'finished', finished, '2026-11-06T00:00:00Z')
  await upsert(other, 'draft', { ...draft, answers: { q1: { selectedIndex: 0 } } })
  const originalArchives = await allArchives()
  const preservation = (await db.query("select pg_get_functiondef('public.preserve_completed_session_audit()'::regprocedure) body")).rows[0].body
  await db.exec(await readFile(new URL(filename, migrations), 'utf8'))
  assert.deepEqual(await allArchives(), originalArchives, 'Migration never rewrites or removes an existing archive')
  assert.equal((await db.query("select pg_get_functiondef('public.preserve_completed_session_audit()'::regprocedure) body")).rows[0].body, preservation, 'Original completion protection remains intact')

  await db.exec('set role service_role')
  const before = await read()
  for (let i = 0; i < 25; i++) {
    assert.equal((await upsert(owner, 'draft', draft)).rows.length, 0, 'Identical autosaves skip the row update')
  }
  assert.deepEqual(await read(), before, 'Duplicate retries keep both the original timestamp and physical tuple version')
  const reordered = { questions: [{ id: 'q1' }], answers: { q1: { selectedIndex: 1 } }, finished: false, sessionId: 'draft' }
  assert.equal((await upsert(owner, 'draft', reordered)).rows.length, 0, 'JSON object key order does not create another write')
  const changed = { ...draft, answers: { q1: { selectedIndex: 0 } } }
  assert.equal((await upsert(owner, 'draft', changed)).rows.length, 1)
  assert.deepEqual((await read()).data, changed, 'Real answer edits still save')
  const completed = { ...changed, finished: true }
  assert.equal((await upsert(owner, 'draft', completed)).rows.length, 1, 'Completion still saves')
  const completedRow = await read()
  for (const retry of [completed, draft, { ...completed, answers: {} }]) {
    assert.equal((await upsert(owner, 'draft', retry)).rows.length, 0, 'Completed audit retries and delayed drafts do not rewrite the row')
    assert.deepEqual(await read(), completedRow)
  }
  assert.equal((await upsert(owner, 'new-draft', draft)).rows.length, 1, 'New archives still insert')
  const batch = await db.query(`insert into public.user_learning_session_archives(user_id,session_id,data,updated_at)
    values($1,'draft',$2,now()),($1,'new-draft',$3,now()),($1,'new-batch',$4,now())
    on conflict(user_id,session_id) do update set data=excluded.data,updated_at=excluded.updated_at returning session_id`,
    [owner, draft, changed, finished])
  assert.deepEqual(batch.rows.map(row => row.session_id).sort(), ['new-batch', 'new-draft'], 'A skipped duplicate does not block real changes or new items in the same batch')
  assert.deepEqual(await read(), completedRow)
  assert.deepEqual((await read(other)).data.answers, { q1: { selectedIndex: 0 } }, 'Identical session IDs remain account-scoped')

  const beforeFailure = await allArchives()
  await assert.rejects(db.query(`insert into public.user_learning_session_archives(user_id,session_id,data)
    values($1,'must-roll-back',$2),($1,'invalid',$3)
    on conflict(user_id,session_id) do update set data=excluded.data`, [owner, draft, []]), /check constraint/)
  assert.deepEqual(await allArchives(), beforeFailure, 'A failed batch still rolls back every item')
  await db.exec('reset role; set role authenticated')
  await assert.rejects(db.query('select * from public.user_learning_session_archives'), /permission denied/)
  await assert.rejects(upsert(owner, 'forbidden', draft), /permission denied/)
  await db.exec('reset role; set role anon')
  await assert.rejects(db.query('select * from public.user_learning_session_archives'), /permission denied/)
  await db.exec('reset role')

  const beforeRollback = await allArchives()
  await db.exec(await readFile(new URL('../../supabase/rollbacks/skip_unchanged_session_archives.sql', import.meta.url), 'utf8'))
  assert.deepEqual(await allArchives(), beforeRollback, 'Rollback changes no saved data')
  assert.equal((await upsert(owner, 'draft', draft)).rows.length, 1, 'Rollback restores the prior write contract')
  assert.deepEqual((await read()).data, completed, 'Completion protection survives rollback')
  console.log('PASS: archive no-op writes, preserved timestamps/tuple versions, real edits/completion, batches, account isolation, client denial and rollback')
} finally { await db.close() }
