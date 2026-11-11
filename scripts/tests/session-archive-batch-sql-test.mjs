import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const root = new URL('../../supabase/migrations/', import.meta.url)
const owner = '11111111-1111-4111-8111-111111111111'
const other = '22222222-2222-4222-8222-222222222222'
const db = new PGlite()
const draft = {
  sessionId:'session1', track:'DECK_OIC_NW', finished:false,
  questions:[{id:'q1'}],answers:{q1:{selectedIndex:1}}
}
const finished = {...draft,finished:true}
const saved = async (id=owner) => (await db.query(
  "select data,updated_at::text,xmin::text from public.user_learning_session_archives where user_id=$1 and session_id='session1'",[id]
)).rows[0]
const store = async (id,sessions) => (await db.query(
  'select public.upsert_learning_session_archives_if_changed($1,$2) as changed',
  [id,sessions.map(s=>({session_id:s.sessionId,data:s}))])).rows[0].changed
try {
  await db.exec('create role anon; create role authenticated; create role service_role bypassrls; create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql as $$select null::uuid$$;')
  for (const filename of [
    '20261026071721_create_user_learning_progress.sql',
    '20261102090000_preserve_saved_progress_and_session_audits.sql',
    '20261106175405_skip_unchanged_session_archives.sql'
  ]) await db.exec(await readFile(new URL(filename,root),'utf8'))
  await db.query('insert into auth.users values($1),($2)',[owner,other])
  const before = await db.query('select count(*)::integer n from public.user_learning_session_archives')
  await db.exec(await readFile(new URL('20261112011000_skip_duplicate_archive_upserts.sql',root),'utf8'))
  assert.equal((await db.query('select count(*)::integer n from public.user_learning_session_archives')).rows[0].n,
    before.rows[0].n,'Installing private archive UPSERT never modifies saved sessions')

  await db.exec('set role service_role')
  assert.equal(await store(owner,[draft]),1,'First cloud session is durably inserted')
  const first=await saved()
  for(let i=0;i<20;i++) assert.equal(await store(owner,[draft]),0)
  assert.deepEqual(await saved(),first,'Duplicate cloud sync preserves timestamp and physical tuple')
  const shuffled={answers:draft.answers,questions:draft.questions,finished:false,track:draft.track,sessionId:'session1'}
  assert.equal(await store(owner,[shuffled]),0,'JSON key order does not generate a disk write')

  const changed={...draft,answers:{q1:{selectedIndex:0}}}
  assert.equal(await store(owner,[changed]),1,'Real edits still update the row')
  assert.equal((await saved()).data.answers.q1.selectedIndex,0)
  assert.equal(await store(owner,[{...changed,finished:true}]),1)
  const protectedAudit=await saved()
  assert.equal(await store(owner,[draft]),0,
    'Completed exam never gets downgraded by a delayed draft')
  assert.deepEqual(await saved(),protectedAudit)
  assert.equal(await store(other,[draft]),1)
  assert.equal((await saved(other)).data.answers.q1.selectedIndex,1)

  const batch=[{...draft,sessionId:'session2'},{...draft,sessionId:'session3'}]
  assert.equal(await store(owner,batch),2)
  assert.equal(await store(owner,batch),0)
  assert.equal((await db.query(
    'select count(*)::integer n from public.user_learning_session_archives where user_id=$1',[owner]
  )).rows[0].n,3)

  await assert.rejects(store(owner,[draft,draft]),/Malformed or repeated/)
  await assert.rejects(store(owner,[{...draft,sessionId:''}]),/Malformed or repeated/)
  await assert.rejects(db.query(
    'select public.upsert_learning_session_archives_if_changed($1,$2)',[owner,[{session_id:'session3',data:{...draft,sessionId:'wrong'}}]]
  ),/Malformed or repeated/)
  const original=(await db.query('select count(*)::integer n from public.user_learning_session_archives')).rows[0].n
  await assert.rejects(db.query(
    'select public.upsert_learning_session_archives_if_changed($1,$2)',[owner,[]]
  ),/Invalid session archive batch size/)
  assert.equal((await db.query('select count(*)::integer n from public.user_learning_session_archives')).rows[0].n,original,
    'Invalid operations never partially save any archives')
  await db.exec('reset role; set role authenticated')
  await assert.rejects(db.query(
    'select public.upsert_learning_session_archives_if_changed($1,$2)',[owner,[{session_id:'session4',data:{...draft,sessionId:'session4'}}]]
  ),/permission denied/)
  await db.exec('reset role')
  console.log('PASS: archive conditional UPSERT, immutable completed audits, changed edits, batching, owner isolation, no-op tuple stability and private RPC grants')
} finally {
  await db.close()
}
