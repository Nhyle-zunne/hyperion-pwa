import {PGlite} from '@electric-sql/pglite'
import {readFile} from 'node:fs/promises'
import assert from 'node:assert/strict'
const migration='20261104010000_optimize_progress_revision_storage.sql'
const baseline=['20261026071721_create_user_learning_progress.sql','20261028181820_revoke_client_execute_on_learning_progress_trigger.sql','20261029032520_revoke_client_access_to_learning_progress.sql','20261031094513_add_low_egress_progress_snapshot_comparison.sql','20261102090000_preserve_saved_progress_and_session_audits.sql']
const db=new PGlite()
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222'
const wrap=items=>JSON.stringify({version:0,state:{items}})
const snapshot=()=>({version:1,savedAt:100,changedSections:[],activeSessionChangedAt:10,activeSession:{sessionId:'active',track:'DECK_OIC_NW',answers:{q1:{selectedIndex:1}},questions:[{id:'q1'}]},storage:{'hyperion-bookmarks':wrap([{id:'b1',savedAt:100}]),'hyperion-vault':wrap([{id:'v1',lastWrongAt:100,wrongCount:1}]),'hyperion-progress-deletions':JSON.stringify({version:1,bookmarks:{},vault:{}}),'hyperion-history':JSON.stringify({version:0,state:{entries:[{id:'completed',answers:{q1:1}}],savedSessions:[{id:'active'}]}}),'hyperion-study-time':JSON.stringify({version:0,state:{segments:[{id:'t1',durationMs:5000}],dailyCheckInCount:3}})}})
const row=async id=>(await db.query('select data,updated_at::text from user_learning_progress where user_id=$1',[id])).rows[0]
const count=async()=>Number((await db.query('select count(*) n from user_learning_progress_revisions')).rows[0].n)
const write=async(data,id=a)=>db.query('update user_learning_progress set data=$2 where user_id=$1',[id,data])
try{
 await db.exec(`create role anon;create role authenticated;create role service_role;create schema auth;create table auth.users(id uuid primary key);create function auth.uid() returns uuid language sql as $$select null::uuid$$;`)
 for(const file of baseline)await db.exec(await readFile('supabase/migrations/'+file,'utf8'))
 await db.query('insert into auth.users values($1),($2)',[a,b])
 await db.query('insert into user_learning_progress(user_id,data) values($1,$2),($3,$4)',[a,snapshot(),b,snapshot()])
 await write(snapshot()) // Existing server canonicalizes collection wrappers.
 const before=await db.query('select id,user_id,data,captured_at::text from user_learning_progress_revisions order by id')
 // An absent migration is RED: run remaining checks against current behavior first.
 let source;try{source=await readFile('supabase/migrations/'+migration,'utf8')}catch{}
 if(source){await db.exec(source);await db.exec(await readFile('supabase/migrations/20261104020000_preserve_exact_progress_noops.sql','utf8'))}
 assert.deepEqual((await db.query('select id,user_id,data,captured_at::text from user_learning_progress_revisions order by id')).rows,before.rows,'Migration must not alter existing recovery records')
 // Preserve exact no-ops even when a first-inserted legacy collection is unsorted.
 const raw=snapshot();raw.storage['hyperion-vault']=wrap([{id:'older',lastWrongAt:1},{id:'newer',lastWrongAt:2}]);delete raw.storage['hyperion-bookmarks']
 await db.exec('alter table user_learning_progress disable trigger preserve_learning_progress')
 await db.query('update user_learning_progress set data=$2 where user_id=$1',[a,raw])
 await db.exec('alter table user_learning_progress enable trigger preserve_learning_progress')
 const rawRow=await row(a),rawCount=await count()
 assert.equal((await db.query('select compare_user_learning_progress($1,$2,$3) value',[a,rawRow.updated_at,raw])).rows[0].value,'unchanged')
 await write(raw);assert.equal(await count(),rawCount);assert.deepEqual((await row(a)).data,raw)
 await write(snapshot())
 const saved=await row(a),noOp=structuredClone(saved.data);noOp.savedAt=999;noOp.changedSections=['bookmarks']
 for(const [key,value] of Object.entries(noOp.storage))if(typeof value==='string'){const parsed=JSON.parse(value);noOp.storage[key]=JSON.stringify(parsed,null,2)}
 const comparison=(await db.query('select compare_user_learning_progress($1,$2,$3) value',[a,saved.updated_at,noOp])).rows[0].value
 assert.equal(comparison,'unchanged','Formatting-only autosaves must not force a write')
 await db.query('select pg_sleep(0.005)')
 const n=await count();await write(noOp);assert.equal(await count(),n,'Direct no-op updates must not produce full revisions')
 assert.notEqual((await row(a)).updated_at,saved.updated_at,'Direct updates retain existing timestamp/version behavior')
 const version=(await row(a)).updated_at
 assert.equal((await db.query('select compare_user_learning_progress($1,$2,$3) value',[a,saved.updated_at,noOp])).rows[0].value,'conflict','Stale versions conflict even for equivalent content')
 assert.equal((await db.query('select compare_user_learning_progress($1,$2,$3) value',[a,version,noOp])).rows[0].value,'unchanged')
 await write({version:1,storage:{}})
 const decodeStorage=storage=>Object.fromEntries(Object.entries(storage).map(([key,value])=>[key,typeof value==='string'?JSON.parse(value):value]))
 assert.deepEqual(decodeStorage((await row(a)).data.storage),decodeStorage(noOp.storage),'Omitted fields must not erase saved sections')
 assert.equal((await row(a)).data.activeSession.answers.q1.selectedIndex,1)
 const added=structuredClone((await row(a)).data);const items=JSON.parse(added.storage['hyperion-bookmarks']);items.state.items.push({id:'b2',savedAt:200});added.storage['hyperion-bookmarks']=JSON.stringify(items)
 const beforeAdd=await count();await write(added);assert.equal(await count(),beforeAdd+1)
 const deletion=structuredClone((await row(a)).data);deletion.storage['hyperion-progress-deletions']=JSON.stringify({version:1,bookmarks:{b1:{at:300,deleted:true}},vault:{}})
 await write(deletion)
 let data=(await row(a)).data
 assert.deepEqual(JSON.parse(data.storage['hyperion-bookmarks']).state.items.map(x=>x.id),['b2'])
 const offlineOld=structuredClone(data);offlineOld.storage['hyperion-bookmarks']=wrap([{id:'b1',savedAt:100},{id:'b2',savedAt:200}]);delete offlineOld.storage['hyperion-progress-deletions']
 offlineOld.storage['hyperion-progress-deletions']=JSON.stringify({version:1,bookmarks:{b1:{at:300,deleted:false}},vault:{}})
 const beforeOffline=await count();await write(offlineOld)
 assert.equal(await count(),beforeOffline,'Stale offline omissions cannot discard tombstones or resurrect records')
 assert.deepEqual(JSON.parse((await row(a)).data.storage['hyperion-bookmarks']).state.items.map(x=>x.id),['b2'])
 const restore=structuredClone((await row(a)).data);restore.storage['hyperion-progress-deletions']=JSON.stringify({version:1,bookmarks:{b1:{at:400,deleted:false}},vault:{}});restore.storage['hyperion-bookmarks']=wrap([{id:'b1',savedAt:400}]);await write(restore)
 assert.ok(JSON.parse((await row(a)).data.storage['hyperion-bookmarks']).state.items.some(x=>x.id==='b1'))
 const changed=structuredClone((await row(a)).data);changed.activeSession.answers.q1.selectedIndex=0;changed.storage['hyperion-vault']=wrap([{id:'v1',lastWrongAt:500,wrongCount:2}]);await write(changed)
 assert.equal(JSON.parse((await row(a)).data.storage['hyperion-vault']).state.items[0].wrongCount,2)
 const expired=structuredClone((await row(a)).data);expired.activeSession=null
 const expiryCount=await count();await write(expired)
 assert.equal((await row(a)).data.activeSession.answers.q1.selectedIndex,0,'An expiry-filtered or older payload must retain the saved active answers')
 assert.equal(await count(),expiryCount)
 const intentionalClear=structuredClone((await row(a)).data);intentionalClear.activeSession=null;intentionalClear.activeSessionChangedAt=11;await write(intentionalClear)
 assert.equal((await row(a)).data.activeSession,null,'An explicitly newer session-clear marker still works')
 const legacyState={version:1,storage:{'hyperion-study-time':JSON.stringify({version:0,state:{segments:[{id:'native',durationMs:1234}]}})}}
 await write(legacyState)
 assert.equal(JSON.parse((await row(a)).data.storage['hyperion-study-time']).state.dailyCheckInCount,3,'Older native payloads retain web-only state properties')
 await assert.rejects(db.query('update user_learning_progress set user_id=$2 where user_id=$1',[a,b]),/ownership cannot be changed/)
 const legacyActive=structuredClone((await row(a)).data);legacyActive.activeSession=snapshot().activeSession;legacyActive.activeSessionChangedAt=0;await write(legacyActive)
 const emptyLegacy=structuredClone(legacyActive);emptyLegacy.activeSession=null;await write(emptyLegacy)
 assert.deepEqual((await row(a)).data.activeSession,legacyActive.activeSession,'Legacy clock-zero answers remain protected')
 // Actual legacy row: clock key predates this protocol, not merely numeric zero.
 await db.exec('alter table user_learning_progress disable trigger preserve_learning_progress')
 await db.query("update user_learning_progress set data=data-'activeSessionChangedAt' where user_id=$1",[a])
 await db.exec('alter table user_learning_progress enable trigger preserve_learning_progress')
 const missingClock=structuredClone((await row(a)).data);missingClock.activeSession=null
 const missingCount=await count();await write(missingClock)
 assert.deepEqual((await row(a)).data.activeSession,legacyActive.activeSession)
 assert.equal('activeSessionChangedAt' in (await row(a)).data,false,'Preserve an absent legacy clock without SQL NULL propagation')
 assert.equal(await count(),missingCount)
 const safe=await row(a);const safeCount=await count()
 for(const invalid of [{},{version:1,storage:null},{version:2,storage:{}},{version:1,storage:{'hyperion-history':'corrupt'}},{version:1,storage:{'hyperion-history':JSON.stringify({state:{entries:[null]}})}},{version:1,storage:{'hyperion-study-time':JSON.stringify({state:{segments:[{}]}})}},{version:1,storage:{'hyperion-question-attempt-history':JSON.stringify({state:{entries:{q:null}}})}},{version:1,storage:{},activeSession:{}},{version:1,storage:{},activeSessionChangedAt:'bad'}]){
  await assert.rejects(write(invalid));assert.deepEqual((await row(a)).data,safe.data);assert.equal(await count(),safeCount)
 }
 const historyDraft=structuredClone((await row(a)).data)
 const historyWrapper=JSON.parse(historyDraft.storage['hyperion-history']);historyWrapper.futureWrapper='keep'
 historyWrapper.state.entries[0].deletedAt=700
 historyDraft.storage['hyperion-history']=JSON.stringify(historyWrapper);await write(historyDraft)
 const historyRestore=structuredClone((await row(a)).data);const restoredHistory=JSON.parse(historyRestore.storage['hyperion-history']);delete restoredHistory.state.entries[0].deletedAt;historyRestore.storage['hyperion-history']=JSON.stringify(restoredHistory);await write(historyRestore)
 assert.equal(JSON.parse((await row(a)).data.storage['hyperion-history']).state.entries[0].deletedAt,undefined,'Intentional history restore remains valid')
 const historyDelete={version:1,storage:{'hyperion-history':JSON.stringify({version:0,state:{entries:[],savedSessions:[]}})}}
 await write(historyDelete)
 const clearedHistory=JSON.parse((await row(a)).data.storage['hyperion-history'])
 assert.deepEqual(clearedHistory.state.entries,[],'Explicit history deletion must not resurrect records')
 assert.deepEqual(clearedHistory.state.savedSessions,[],'Explicit saved-session discard remains valid')
 assert.equal(clearedHistory.futureWrapper,'keep','Older clients retain unknown wrapper metadata')
 for(let i=0;i<25;i++){const progress=structuredClone((await row(a)).data);progress.storage['hyperion-study-time']=JSON.stringify({version:0,state:{segments:[{id:'time-'+i,durationMs:i+1000}]}});await write(progress)}
 assert.ok(await count()>20,'Initial rollout must not delete historical points at the old boundary')
 for(const old of before.rows)assert.deepEqual((await db.query('select id,user_id,data,captured_at::text from user_learning_progress_revisions where id=$1',[old.id])).rows[0],old)
 const recoverable=structuredClone((await row(a)).data);recoverable.storage['hyperion-bookmarks']=wrap([{id:'recovered',savedAt:900}])
 await db.query('insert into user_learning_progress_revisions(user_id,data) values($1,$2)',[a,recoverable])
 const beforeRecovery=await count();await db.query('select recover_learning_progress_collections($1,true)',[a])
 assert.ok(JSON.parse((await row(a)).data.storage['hyperion-bookmarks']).state.items.some(x=>x.id==='recovered'))
 assert.equal(await count(),beforeRecovery+1,'A genuine recovery creates one full backup')
 const recoveredCount=await count();await db.query('select recover_learning_progress_collections($1,true)',[a]);assert.equal(await count(),recoveredCount,'Repeated recovery adds no redundant snapshots')
 assert.deepEqual((await row(b)).data,snapshot(),'Changes must not cross account boundaries')
 const liveBeforeRollback=(await db.query('select user_id,data,updated_at::text from user_learning_progress order by user_id')).rows
 const backupsBeforeRollback=(await db.query('select id,user_id,data,captured_at::text from user_learning_progress_revisions order by id')).rows
 await db.exec(await readFile('supabase/rollbacks/20261104010000_revision_storage.sql','utf8'))
 assert.deepEqual((await db.query('select user_id,data,updated_at::text from user_learning_progress order by user_id')).rows,liveBeforeRollback)
 assert.deepEqual((await db.query('select id,user_id,data,captured_at::text from user_learning_progress_revisions order by id')).rows,backupsBeforeRollback)
 await write((await row(a)).data);assert.equal(await count(),backupsBeforeRollback.length+1,'Safety rollback restores revision-on-update without deleting old points')
 await db.exec(source)
 await db.exec(await readFile('supabase/migrations/20261104020000_preserve_exact_progress_noops.sql','utf8'))
 await db.exec('set role authenticated')
 for(const sql of ['select * from user_learning_progress','select * from user_learning_progress_revisions',"select canonical_learning_progress('{}'::jsonb)","select prepare_learning_progress('{}'::jsonb,'{}'::jsonb)",`select recover_learning_progress_collections('${a}',true)`])await assert.rejects(db.query(sql),/permission denied/)
 await db.exec('reset role')
 console.log('PASS: revision no-ops, version conflicts, genuine changes, omissions, tombstones, restoration, answers/mistakes, malformed data, ownership, permissions and no-delete retention boundary.')
}finally{await db.close()}
