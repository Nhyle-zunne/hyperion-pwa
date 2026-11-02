import { createRequire } from 'node:module'
import { readFile } from 'node:fs/promises'
import assert from 'node:assert/strict'
const { PGlite } = createRequire(process.env.HYPERION_TEST_TOOLS || import.meta.url)('@electric-sql/pglite')
const db = new PGlite()
const first = '11111111-1111-4111-8111-111111111111'
const second = '22222222-2222-4222-8222-222222222222'
const envelope = items => JSON.stringify({ version: 0, state: { items } })
const snapshot = (bookmarks, vault = [], ledger = {}) => ({ version: 1, storage: { 'hyperion-bookmarks': envelope(bookmarks), 'hyperion-vault': envelope(vault), 'hyperion-progress-deletions': JSON.stringify(ledger) } })
try {
  await db.exec(`create role anon; create role authenticated; create role service_role; create schema auth; create table auth.users(id uuid primary key); create table public.user_learning_progress(user_id uuid primary key references auth.users(id), data jsonb not null);`)
  await db.query('insert into auth.users values ($1),($2)', [first, second])
  await db.query('insert into user_learning_progress values ($1,$2),($3,$4)', [first, snapshot([{ id: 'b1', savedAt: 100 }], [{ id: 'v1', lastWrongAt: 100 }]), second, snapshot([{ id: 'other', savedAt: 100 }])])
  await db.exec(await readFile(new URL('../../supabase/migrations/20261102090000_preserve_saved_progress_and_session_audits.sql', import.meta.url), 'utf8'))
  await db.query('update user_learning_progress set data=$2 where user_id=$1', [first, snapshot([])])
  const read = async id => (await db.query('select data from user_learning_progress where user_id=$1', [id])).rows[0].data
  let row = await read(first)
  assert.equal(JSON.parse(row.storage['hyperion-bookmarks']).state.items[0].id, 'b1')
  assert.equal(JSON.parse(row.storage['hyperion-vault']).state.items[0].id, 'v1')
  const ledger = { version: 1, bookmarks: { b1: { deleted: true, at: 200 } }, vault: {} }
  await db.query('update user_learning_progress set data=$2 where user_id=$1', [first, snapshot([{ id: 'b2', savedAt: 400 }], [], ledger)])
  row = await read(first)
  assert.deepEqual(JSON.parse(row.storage['hyperion-bookmarks']).state.items.map(item => item.id), ['b2'])
  await db.query('insert into user_learning_progress_revisions(user_id,data) values($1,$2)', [first, snapshot([{ id: 'b3', savedAt: 300 }, { id: 'b1', savedAt: 100 }])])
  const dry = (await db.query('select recover_learning_progress_collections($1,false) result', [first])).rows[0].result
  assert.equal(dry.bookmarks.before, 1)
  assert.equal(dry.bookmarks.after, 2)
  assert.equal(JSON.parse((await read(first)).storage['hyperion-bookmarks']).state.items.length, 1)
  await db.query('select recover_learning_progress_collections($1,true)', [first])
  assert.deepEqual(JSON.parse((await read(first)).storage['hyperion-bookmarks']).state.items.map(item => item.id).sort(), ['b2', 'b3'])
  assert.deepEqual(JSON.parse((await read(second)).storage['hyperion-bookmarks']).state.items.map(item => item.id), ['other'])
  const malformed = await db.query('select merge_preserved_progress_items($1,$2,$3,$4) value', ['invalid', envelope([{ id: 'preserved', savedAt: 1 }]), '{}', 'bookmarks'])
  assert.equal(JSON.parse(malformed.rows[0].value).state.items[0].id, 'preserved')
  await db.query('insert into user_learning_session_archives(user_id,session_id,data) values($1,$2,$3)', [first, 'finished', { finished: true, answers: { q1: 1 } }])
  await db.query('update user_learning_session_archives set data=$3 where user_id=$1 and session_id=$2', [first, 'finished', { finished: false, answers: {} }])
  assert.equal((await db.query('select data from user_learning_session_archives where user_id=$1', [first])).rows[0].data.finished, true)
  await db.exec('set role authenticated')
  await assert.rejects(db.query('select * from user_learning_progress_revisions'), /permission denied/)
  await assert.rejects(db.query('select recover_learning_progress_collections($1,true)', [first]), /permission denied/)
  await assert.rejects(db.query('select * from user_learning_session_archives'), /permission denied/)
  await db.exec('reset role')
  console.log('PASS: PostgreSQL migration, empty-update preservation, explicit deletions, recovery dry-run/apply, account isolation, malformed input protection and client permission denial.')
} finally { await db.close() }
