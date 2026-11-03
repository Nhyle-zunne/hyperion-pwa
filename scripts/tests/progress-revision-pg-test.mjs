// Synthetic isolated PostgreSQL only. Never accepts a remote/production database.
import {spawn} from 'node:child_process'
import {readFile,writeFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
import {guardedProgressRevisionSql,migrationBodyForGuard} from '../lib/progressRevisionDeployment.mjs'
const container=process.env.HYPERION_REVISION_TEST_CONTAINER
const base=process.env.DATABASE_URL
if(container&&!/^hyperion-revision-test-[a-z0-9-]+$/.test(container))throw Error('Use an isolated revision test container.')
if(!container){const u=new URL(base||'invalid:');if(!['localhost','127.0.0.1'].includes(u.hostname)||u.pathname!=='/hyperion_test')throw Error('Revision tests require the local synthetic CI database.')}
const env={...process.env};for(const key of ['DOCKER_HOST','DOCKER_CONTEXT','DOCKER_TLS','DOCKER_TLS_VERIFY','DOCKER_CERT_PATH'])delete env[key]
function query(db,sql,onData){
 const args=['-X','-qAt','-v','ON_ERROR_STOP=1','-U','postgres','-d',container?db:new URL('/'+db,base).href]
 const command=container?'docker':'psql'
 const argv=container?['--host=unix:///var/run/docker.sock','exec','-i',container,'psql',...args]:args
 return new Promise((resolve,reject)=>{const child=spawn(command,argv,{env,stdio:['pipe','pipe','pipe']});let out='',err='';child.stdout.on('data',data=>{out+=data;onData?.(out)});child.stderr.on('data',data=>{err+=data});child.on('error',reject);child.on('close',code=>code===0?resolve(out.trim()):reject(Error('Synthetic PostgreSQL validation failed: '+err.slice(-1500))));child.stdin.end(sql)})
}
const lit=value=>"'"+value.replaceAll("'","''")+"'"
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
const baseline=['20261026071721_create_user_learning_progress.sql','20261028181820_revoke_client_execute_on_learning_progress_trigger.sql','20261029032520_revoke_client_access_to_learning_progress.sql','20261031094513_add_low_egress_progress_snapshot_comparison.sql','20261102090000_preserve_saved_progress_and_session_audits.sql']
const migration=await readFile('supabase/migrations/20261104010000_optimize_progress_revision_storage.sql','utf8')
const exactNoops=await readFile('supabase/migrations/20261104020000_preserve_exact_progress_noops.sql','utf8')
const retention=await readFile('supabase/migrations/20261104030000_bound_future_progress_revisions.sql','utf8')
const rollback=await readFile('supabase/rollbacks/20261104010000_revision_storage.sql','utf8')
const question=i=>({id:'synthetic-'+i,track:'DECK_OIC_NW',questionText:Array.from({length:70},(_,n)=>`Synthetic navigation ${i} sector ${(n*17+i)%997}.`).join(' '),options:['Port '+i,'Starboard '+i],correctAnswerIndex:i%2,savedAt:100+i})
const snapshot={version:1,savedAt:100,changedSections:[],activeSessionChangedAt:10,activeSession:null,storage:{'hyperion-bookmarks':JSON.stringify({version:0,state:{items:Array.from({length:75},(_,i)=>question(i))}}),'hyperion-vault':JSON.stringify({version:0,state:{items:[{...question(90),lastWrongAt:100,wrongCount:1}]}}),'hyperion-history':JSON.stringify({version:0,state:{entries:[{id:'audit',answers:{q1:1}}],savedSessions:[]}}),'hyperion-progress-deletions':JSON.stringify({version:1,bookmarks:{},vault:{}})}}
const results={synthetic_logical_bytes:Buffer.byteLength(JSON.stringify(snapshot))}
for(const [label,optimized]of [['legacy',false],['optimized',true]]){
 const db='hyperion_revisions_'+label
 await query(container?'postgres':'hyperion_test',`drop database if exists ${db} with(force);create database ${db};`)
 await query(db,`do $$begin if not exists(select1 from pg_roles where rolname='anon')then create role anon;end if;if not exists(select1 from pg_roles where rolname='authenticated')then create role authenticated;end if;if not exists(select1 from pg_roles where rolname='service_role')then create role service_role bypassrls;end if;end$$;create schema auth;create table auth.users(id uuid primary key);create function auth.uid()returns uuid language sql as $$select null::uuid$$;`.replaceAll('select1','select 1'))
 for(const file of baseline)await query(db,await readFile('supabase/migrations/'+file,'utf8'))
 await query(db,`insert into auth.users values('${a}'),('${b}');insert into user_learning_progress(user_id,data)values('${a}',${lit(JSON.stringify(snapshot))}::jsonb),('${b}',${lit(JSON.stringify(snapshot))}::jsonb);update user_learning_progress set data=data where user_id='${a}';`)
 if(optimized)await query(db,migration+exactNoops)
 const measured=await query(db,`create table benchmark_result(value jsonb);do $$declare i int;k text;r public.user_learning_progress%rowtype;candidate jsonb;writes int:=0;old_seq bigint;started timestamptz;wal pg_lsn;begin select last_value into old_seq from user_learning_progress_revisions_id_seq;started:=clock_timestamp();wal:=pg_current_wal_insert_lsn();for i in1..100 loop select * into r from user_learning_progress where user_id='${a}';candidate:=jsonb_set(r.data,'{savedAt}',to_jsonb(i));candidate:=jsonb_set(candidate,'{changedSections}','["bookmarks"]'::jsonb);foreach k in array array['hyperion-bookmarks','hyperion-vault','hyperion-history','hyperion-progress-deletions']loop candidate:=jsonb_set(candidate,array['storage',k],to_jsonb(jsonb_pretty((candidate->'storage'->>k)::jsonb)));end loop;if compare_user_learning_progress('${a}',r.updated_at,candidate)='changed'then update user_learning_progress set data=candidate where user_id='${a}'and updated_at=r.updated_at;writes:=writes+1;end if;end loop;insert into benchmark_result values(jsonb_build_object('autosaves',100,'progress_writes',writes,'revision_inserts',(select last_value from user_learning_progress_revisions_id_seq)-old_seq,'retained_revision_rows',(select count(*) from user_learning_progress_revisions),'retained_payload_bytes',(select sum(pg_column_size(data))from user_learning_progress_revisions),'revision_relation_bytes',pg_total_relation_size('user_learning_progress_revisions'),'wall_ms',round((extract(epoch from clock_timestamp()-started)*1000)::numeric,2),'wal_bytes',pg_wal_lsn_diff(pg_current_wal_insert_lsn(),wal)));end$$;select value from benchmark_result;`.replace('in1..100','in 1..100'))
 results[label]=JSON.parse(measured)
 assert.equal(results[label].progress_writes,optimized?0:100)
 assert.equal(results[label].revision_inserts,optimized?0:100)
 const genuine=await query(db,`truncate benchmark_result;do $$declare i int;old_seq bigint;started timestamptz;wal pg_lsn;begin select last_value into old_seq from user_learning_progress_revisions_id_seq;started:=clock_timestamp();wal:=pg_current_wal_insert_lsn();for i in 1..20 loop update user_learning_progress set data=jsonb_set(data,'{storage,syntheticMeaningfulProgress}',to_jsonb(i))where user_id='${a}';end loop;insert into benchmark_result values(jsonb_build_object('meaningful_updates',20,'revision_inserts',(select last_value from user_learning_progress_revisions_id_seq)-old_seq,'wall_ms',round((extract(epoch from clock_timestamp()-started)*1000)::numeric,2),'wal_bytes',pg_wal_lsn_diff(pg_current_wal_insert_lsn(),wal)));end$$;select value from benchmark_result;`)
 results[label].genuine=JSON.parse(genuine)
 assert.equal(results[label].genuine.revision_inserts,20)
}
const db='hyperion_revisions_optimized'
const before=JSON.parse(await query(db,`select json_build_object('updated_at',updated_at,'data',data,'revision_count',(select count(*)from user_learning_progress_revisions))from user_learning_progress where user_id='${a}';`))
let lockedResolve;const locked=new Promise(resolve=>{lockedResolve=resolve})
const first=query(db,`begin;update user_learning_progress set data=jsonb_set(data,'{storage,deviceA}','"offline A"'::jsonb)where user_id='${a}'and updated_at=${lit(before.updated_at)}::timestamptz returning 'A_WON';select 'LOCKED_A';select pg_sleep(0.5);commit;`,out=>{if(out.includes('LOCKED_A'))lockedResolve()})
const timeout=new Promise((_,reject)=>{const t=setTimeout(()=>reject(Error('Writer A did not acquire the test lock')),5000);t.unref()})
await Promise.race([locked,timeout])
const second=query(db,`begin;update user_learning_progress set data=jsonb_set(data,'{storage,deviceB}','"offline B"'::jsonb)where user_id='${a}'and updated_at=${lit(before.updated_at)}::timestamptz returning 'B_WON';commit;`)
const [won,lost]=await Promise.all([first,second]);assert.ok(won.includes('A_WON'));assert.equal(lost.includes('B_WON'),false)
assert.equal(await query(db,`select compare_user_learning_progress('${a}',${lit(before.updated_at)}::timestamptz,${lit(JSON.stringify(before.data))}::jsonb);`),'conflict')
const after=JSON.parse(await query(db,`select json_build_object('updated_at',updated_at,'data',data,'revision_count',(select count(*)from user_learning_progress_revisions))from user_learning_progress where user_id='${a}';`))
assert.equal(after.revision_count,before.revision_count+1)
assert.equal(after.data.storage.deviceA,'offline A')
const retry=structuredClone(before.data);retry.storage.deviceB='offline B'
await query(db,`update user_learning_progress set data=${lit(JSON.stringify(retry))}::jsonb where user_id='${a}'and updated_at=${lit(after.updated_at)}::timestamptz;`)
const merged=JSON.parse(await query(db,`select data from user_learning_progress where user_id='${a}';`))
assert.equal(merged.storage.deviceA,'offline A');assert.equal(merged.storage.deviceB,'offline B')
// The future-only policy must not change existing records when installed.
const protectedBefore=await query(db,"select md5(string_agg(id::text||user_id::text||data::text||captured_at::text,'' order by id)) from user_learning_progress_revisions")
await query(db,guardedProgressRevisionSql(migrationBodyForGuard(retention)))
const cutoff=Number(await query(db,"select protected_through_id from user_learning_progress_revision_retention"))
assert.ok(cutoff>0,'Capture a real existing-revision watermark')
assert.equal(
 await query(db,`select md5(string_agg(id::text||user_id::text||data::text||captured_at::text,'' order by id)) from user_learning_progress_revisions where id<=${cutoff}`),
 protectedBefore,
 'Installing the future cap cannot touch previously retained progress'
)
await query(db,`do $revisions$ begin for i in 1..25 loop
 update user_learning_progress set data=jsonb_set(data,'{futureWrite}',to_jsonb(i))
 where user_id='${a}';
end loop;end $revisions$;`)
const futures=Number(await query(db,`select count(*) from user_learning_progress_revisions where user_id='${a}' and id>${cutoff}`))
assert.equal(futures,10,'Keep the ten newest future full snapshots for each account')
assert.equal(
 await query(db,`select md5(string_agg(id::text||user_id::text||data::text||captured_at::text,'' order by id)) from user_learning_progress_revisions where id<=${cutoff}`),
 protectedBefore,
 'Future pruning may never delete an older recovery snapshot'
)
results.futureRetention='25 genuine future updates -> 10 newest snapshots; all pre-migration records intact'
const stateSql=`select json_build_object('current',md5(string_agg(user_id::text||data::text||updated_at::text,''order by user_id)),'revisions',(select md5(string_agg(id::text||user_id::text||data::text||captured_at::text,''order by id))from user_learning_progress_revisions))from user_learning_progress;`
const fingerprints=await query(db,stateSql)
await assert.rejects(query(db,guardedProgressRevisionSql("update user_learning_progress set data=jsonb_set(data,'{guardProbe}','true'::jsonb);")),/Non-destructive migration guard/)
assert.equal(await query(db,stateSql),fingerprints,'Guard rejection must roll back all record changes')
await query(db,guardedProgressRevisionSql(rollback));assert.equal(await query(db,stateSql),fingerprints,'Safety rollback must not modify records')
await query(db,guardedProgressRevisionSql(migration+exactNoops+migrationBodyForGuard(retention)));assert.equal(await query(db,stateSql),fingerprints,'Reapplying definitions must not modify records')
results.concurrency='two real PostgreSQL sessions: one winner, stale writer rejected, retry preserves both devices'
results.rollback='definition-only rollback/reapply retain every current/revision fingerprint'
console.log(JSON.stringify(results,null,2))
if(process.env.HYPERION_REVISION_BENCH_OUTPUT)await writeFile(process.env.HYPERION_REVISION_BENCH_OUTPUT,JSON.stringify(results,null,2))
