// Initial rollout is DDL-only. Historical cleanup is not supported by this tool.
import {readFile,writeFile} from 'node:fs/promises'
import {createHash} from 'node:crypto'
import {guardedProgressRevisionSql} from './lib/progressRevisionDeployment.mjs'
const version='20261104010000',name='optimize_progress_revision_storage'
const source=await readFile(`supabase/migrations/${version}_${name}.sql`,'utf8')
const expected=JSON.parse(await readFile('config/progress-revision-audited-baseline.json','utf8'))
if(!process.env.SUPABASE_ACCESS_TOKEN)throw Error('Secure Supabase management access is required.')
const base='https://api.supabase.com/v1/projects/'+expected.project
const headers={Authorization:`Bearer ${process.env.SUPABASE_ACCESS_TOKEN}`,'Content-Type':'application/json'}
async function request(path,options={}){const r=await fetch(base+path,{headers,...options});if(!r.ok)throw Error(`Revision deployment request failed (HTTP ${r.status}). No cleanup will be attempted.`);return r.json()}
const query=(sql,readOnly=true)=>request('/database/query',{method:'POST',body:JSON.stringify({query:sql,read_only:readOnly})})
const sha=s=>createHash('sha256').update(s).digest('hex')
const lit=s=>"'"+s.replaceAll("'","''")+"'"
const functionNames=['progress_json_or_null','canonical_learning_progress','merge_learning_progress_deletions','prepare_learning_progress','preserve_learning_progress','compare_user_learning_progress','recover_learning_progress_collections','merge_preserved_progress_items','set_user_learning_progress_updated_at','preserve_completed_session_audit']
const definitions=()=>query(`select p.proname,p.prosrc,pg_get_functiondef(p.oid) definition,p.prosecdef,p.proconfig,has_function_privilege('anon',p.oid,'EXECUTE') anon_exec,has_function_privilege('authenticated',p.oid,'EXECUTE') user_exec,has_function_privilege('service_role',p.oid,'EXECUTE') service_exec from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in (${functionNames.map(lit).join(',')})`)
const metrics=async()=> (await query(`select pg_database_size(current_database()) database_bytes,pg_total_relation_size('public.user_learning_progress_revisions') revisions_total_bytes,(select count(*)from public.user_learning_progress) current_rows,count(*) revision_rows,count(distinct user_id) revision_accounts,coalesce(sum(pg_column_size(data)),0) stored_payload_bytes,avg(pg_column_size(data))::bigint avg_payload_bytes from public.user_learning_progress_revisions`))[0]
const before=await metrics(),oldDefs=await definitions()
const backups=await request('/database/backups')
const completed=(backups.backups||[]).filter(x=>x.status==='COMPLETED').sort((a,b)=>b.inserted_at.localeCompare(a.inserted_at))
if(!completed.length)throw Error('No completed production backup is available. Do not apply this migration yet.')
const applied=(await query(`select count(*) n from supabase_migrations.schema_migrations where version=${lit(version)}`))[0].n>0
if(process.argv.includes('--apply')&&!applied){
 for(const [functionName,hash]of Object.entries(expected.functionDefinitionSha256)){
  const found=oldDefs.find(x=>x.proname===functionName)
  if(!found||sha(found.definition)!==hash)throw Error('Production progress definitions changed since the audit. Reconcile before applying.')
 }
 const ledger=`insert into supabase_migrations.schema_migrations(version,name,statements)select ${lit(version)},${lit(name)},array[${lit(source)},format('-- Guard verified unchanged current records=%s and revisions=%s',(select count(*)from revision_record_guard where kind='current'),(select count(*)from revision_record_guard where kind='revision'))];`
 await query(guardedProgressRevisionSql(source,ledger),false)
}
const afterDefs=await definitions()
if(applied||process.argv.includes('--apply')){
 for(const match of source.matchAll(/create or replace function public\.([a-z_]+)\([\s\S]*?\bas \$\$([\s\S]*?)\$\$;/g)){
  const found=afterDefs.find(x=>x.proname===match[1])
  if(!found||found.prosecdef!==['preserve_learning_progress','compare_user_learning_progress'].includes(match[1])||found.prosrc!==match[2]||found.anon_exec||found.user_exec||!found.service_exec||!found.proconfig?.includes('search_path=""'))throw Error('Deployed definition/permission verification failed for '+match[1])
 }
 for(const functionName of ['recover_learning_progress_collections','merge_preserved_progress_items','set_user_learning_progress_updated_at','preserve_completed_session_audit']){
  const found=afterDefs.find(x=>x.proname===functionName)
  if(!found||sha(found.definition)!==expected.functionDefinitionSha256[functionName])throw Error('An unrelated preservation function changed: '+functionName)
 }
}
const security=await query(`select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'SELECT,INSERT,UPDATE,DELETE') anon_access,has_table_privilege('authenticated',c.oid,'SELECT,INSERT,UPDATE,DELETE') user_access from pg_class c where c.oid in ('public.user_learning_progress'::regclass,'public.user_learning_progress_revisions'::regclass,'public.user_learning_session_archives'::regclass)`)
if(security.some(x=>!x.relrowsecurity||x.anon_access||x.user_access))throw Error('Progress table security verification failed.')
const receipt=applied||process.argv.includes('--apply')?(await query(`select statements[2] receipt from supabase_migrations.schema_migrations where version=${lit(version)}`))[0]?.receipt:null
const result={mode:applied?'verified-existing':process.argv.includes('--apply')?'applied-and-verified':'audit-only',version,backup:{status:completed[0].status,inserted_at:completed[0].inserted_at,pitr_enabled:backups.pitr_enabled},before,after:await metrics(),receipt,security}
if(process.env.HYPERION_REVISION_RECEIPT)await writeFile(process.env.HYPERION_REVISION_RECEIPT,JSON.stringify(result,null,2))
console.log(JSON.stringify(result,null,2))
