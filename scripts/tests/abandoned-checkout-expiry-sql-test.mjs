import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { PGlite } from '@electric-sql/pglite'

const db = new PGlite()
const migrationPath = new URL('../../supabase/migrations/20261117120000_expire_abandoned_checkout_after_30_minutes.sql', import.meta.url)
const priorPath = new URL('../../supabase/migrations/20261028093640_schedule_12_hour_abandoned_paymongo_checkout_cleanup.sql', import.meta.url)
const owner = '11111111-1111-4111-8111-111111111111'
const id = number => 'aaaaaaaa-aaaa-4aaa-8aaa-' + String(number).padStart(12, '0')
const old = minutes => new Date(Date.now() - minutes * 60_000).toISOString()
const run = async (idValue, session, batch = false) => (await db.query(
  'select public.mark_abandoned_paymongo_checkout_failed($1,$2,$3) value',
  [idValue, session, batch]
)).rows[0].value
const status = async (table, idValue) => (await db.query(
  'select status from public.' + table + ' where id=$1', [idValue]
)).rows[0].status

try {
  await db.exec([
    'create role anon;create role authenticated;create role service_role bypassrls;',
    'create schema cron;',
    'create table cron.job(jobid bigint primary key,jobname text not null,schedule text not null,command text not null);',
    "insert into cron.job values(4,'hyperion-expire-abandoned-paymongo-checkouts','*/30 * * * *','select net.http_post(...)');",
    'create function cron.alter_job(job_id bigint,schedule text) returns void language plpgsql as $$begin update cron.job set schedule=alter_job.schedule where jobid=alter_job.job_id;end$$;',
    'create table public.checkout_batches(id uuid primary key,user_id uuid,status text not null,created_at timestamptz not null,payment_method text,paymongo_checkout_session_id text);',
    'create table public.orders(id uuid primary key,user_id uuid,status text not null,created_at timestamptz not null,payment_method text,paymongo_checkout_session_id text,checkout_batch_id uuid);'
  ].join('\n'))
  const priorSql = await readFile(priorPath, 'utf8')
  const functionStart = priorSql.indexOf('create or replace function public.mark_abandoned_paymongo_checkout_failed')
  const functionEnd = priorSql.indexOf('\nrevoke all on function public.mark_abandoned_paymongo_checkout_failed', functionStart)
  assert(functionStart >= 0 && functionEnd > functionStart, 'Original service-role RPC must remain auditable')
  await db.exec(priorSql.slice(functionStart, functionEnd))
  await db.exec(
    'revoke all on function public.mark_abandoned_paymongo_checkout_failed(uuid,text,boolean) from public,anon,authenticated;'+
    'grant execute on function public.mark_abandoned_paymongo_checkout_failed(uuid,text,boolean) to service_role;'
  )

  const rows = [
    [id(1),'pending',29,'PayMongo Checkout','cs_29',null],
    [id(2),'pending',31,'PayMongo Checkout','cs_31',null],
    [id(3),'paid',70,'PayMongo Checkout','cs_paid',null],
    [id(4),'pending',65,'Manual QR Ph','manual',null],
    [id(5),'failed',70,'PayMongo Checkout','cs_old_failed',null],
    [id(6),'pending',34,'PayMongo Checkout','cs_batch_order',id(7)]
  ]
  for (const [ref, orderStatus, minutes, method, session, batchId] of rows)
    await db.query(
      'insert into public.orders(id,user_id,status,created_at,payment_method,paymongo_checkout_session_id,checkout_batch_id) values($1,$2,$3,$4,$5,$6,$7)',
      [ref,owner,orderStatus,old(minutes),method,session,batchId]
    )
  await db.query(
    'insert into public.checkout_batches(id,user_id,status,created_at,payment_method,paymongo_checkout_session_id) values($1,$2,$3,$4,$5,$6)',
    [id(7),owner,'pending',old(34),'PayMongo Checkout','cs_batch']
  )

  // Before this migration exists, a 31-minute pending order stays too_young (red baseline).
  const migration = await readFile(migrationPath, 'utf8').catch(() => '')
  if (migration) await db.exec(migration)

  await db.exec('set role service_role')
  assert.equal((await run(id(1),'cs_29')).status,'too_young','29-minute checkout remains payable')
  assert.equal(await status('orders',id(1)),'pending')
  assert.equal((await run(id(2),'cs_31')).status,'cancelled','31-minute provider-expired checkout moves to Expired')
  assert.equal(await status('orders',id(2)),'cancelled')
  assert.equal((await run(id(2),'cs_31')).status,'not_pending','Cleanup retry remains idempotent')
  assert.equal((await run(id(3),'cs_paid')).status,'already_paid','Paid checkout cannot be cancelled')
  assert.equal(await status('orders',id(3)),'paid')
  assert.equal((await run(id(4),'manual')).status,'session_mismatch','Manual requests are never automatically cancelled')
  assert.equal(await status('orders',id(4)),'pending')
  assert.equal((await run(id(5),'cs_old_failed')).status,'not_pending')
  assert.equal((await run(id(6),'cs_wrong')).status,'session_mismatch','Mismatched provider reference cannot be cancelled')
  assert.equal((await run(id(7),'cs_batch',true)).status,'cancelled','Expired batch transitions atomically')
  assert.equal(await status('checkout_batches',id(7)),'cancelled')
  assert.equal(await status('orders',id(6)),'cancelled','Batch line items follow batch expiry')
  const job = (await db.query("select schedule,command from cron.job where jobname='hyperion-expire-abandoned-paymongo-checkouts'")).rows[0]
  assert.equal(job.schedule,'*/5 * * * *','Cleanup runs within 5 minutes of age cutoff')
  assert.equal(job.command,'select net.http_post(...)','Existing authenticated invocation and timeout are unchanged')

  await db.exec('reset role')
  for (const role of ['anon','authenticated']) {
    await db.exec('set role '+role)
    await assert.rejects(run(id(1),'cs_29'),/permission denied/i)
    await db.exec('reset role')
  }
  const cleanupCode = await readFile(new URL('../../supabase/functions/expire-abandoned-checkouts/index.ts',import.meta.url),'utf8')
  assert.match(cleanupCode,/paidPayment\(session\)/,'Paid provider evidence is reconciled first')
  assert.match(cleanupCode,/hasInFlightOrUnknownPayment\(session\)/,'Pending provider payments are not expired')
  assert.match(cleanupCode,/\.status \?\? ''\)\.toLowerCase\(\) !== 'expired'/,'Provider must confirm session expiry before local status changes')
  console.log('PASS: PayMongo 30-minute expiry, batch safety, paid/manual isolation, session binding, service-role access and 5-minute scheduler')
} finally { await db.close() }
