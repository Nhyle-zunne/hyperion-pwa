import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateGithubBatch, publishGithubBatch } from '../../worker/githubBankPublisher.ts'
import { createBankWorker } from '../../worker/index.ts'
import { decryptToText, deriveKeyBytes, toSearchQuestions } from '../../supabase/functions/_shared/bankCodec.ts'
import { GITHUB_BANK_ROOT, GITHUB_BANK_MANIFEST, GITHUB_BANK_RELEASE, GITHUB_BANK_FILES, githubAssetPath } from '../../supabase/functions/_shared/githubBankSource.ts'
const manifest=JSON.parse(await readFile('supabase/functions/_shared/github-bank-manifest.json','utf8'))
const path='engine_ew/ew_c1.csv.enc'
const text='No,Question,A,B,C,D,Ans\n1,First synthetic question?,Port,Starboard,Ahead,Astern,A\n2,Second synthetic question?,Port,Starboard,Ahead,Astern,A\n'
const iv=crypto.getRandomValues(new Uint8Array(12)), key=await crypto.subtle.importKey('raw',deriveKeyBytes(),'AES-GCM',false,['encrypt']), encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text)))
const original=new Uint8Array(12+encrypted.length);original.set(iv);original.set(encrypted,12)
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(x=>x.toString(16).padStart(2,'0')).join('')
Object.assign(manifest.files.find(file=>file.path===path),{bytes:original.length,sha256:await hash(original)})
const initialPointer={version:1,revision:'0'.repeat(40),manifestSha256:await hash(JSON.stringify(manifest)),publishedAt:'2026-11-03T00:00:00Z',publicationId:'fixture-initial',inputDigest:'f'.repeat(64)}
const next=text.trimEnd()+'\n999999,Publisher synthetic append question?,Port,Starboard,Ahead,Astern,A\n'
const input={requestId:'synthetic-publish-123',files:[{path,format:'csv',content:next}]}
function repository({race=false,lostResponse=false,unselectedCorrupt=false}={}){
 let head='1'.repeat(40),posts=0,sourceReads=0,stagedManifest='',pointer=null,blobBytes=null,treeCalls=0,commitCalls=0,admin=true
 const fetcher=async(input,options={})=>{
  const u=new URL(typeof input==='string'?input:input.url),method=options.method||'GET',body=options.body?JSON.parse(options.body):null
  if(u.hostname.endsWith('.supabase.co'))return Response.json(admin?{allowed:true,access:'admin'}:{allowed:false},{status:admin?200:403})
  assert.equal(u.hostname,'api.github.com');sourceReads++
  assert.equal(new Headers(options.headers||(typeof input==='object'?input.headers:undefined)).get('Authorization'),'Bearer synthetic-server-token')
  const p=u.pathname.split('/repos/Nhyle-zunne/hyperion-reviewer/')[1]
  if(method==='GET'&&p==='git/ref/heads/main')return Response.json({object:{sha:head}})
  if(method==='GET'&&p.startsWith('git/commits/'))return Response.json({tree:{sha:(p.endsWith('0'.repeat(40))?'6':'2').repeat(40)}})
  if(method==='GET'&&p.startsWith('git/trees/'))return Response.json({truncated:false,tree:[...GITHUB_BANK_FILES.map(file=>({path:`${GITHUB_BANK_ROOT}/${githubAssetPath(file.path)}`,type:'blob',mode:'100644',sha:(unselectedCorrupt&&p.includes('2'.repeat(40))&&file.path==='engine_ew/ew_c2.csv.enc'?'f':'8').repeat(40)})),{path:`${GITHUB_BANK_ROOT}/${GITHUB_BANK_MANIFEST}`,type:'blob',mode:'100644',sha:'9'.repeat(40)}]})
  if(method==='GET'&&p===`contents/${GITHUB_BANK_ROOT}/${GITHUB_BANK_MANIFEST}`)return new Response(head==='b'.repeat(40)?stagedManifest:JSON.stringify(manifest))
  if(method==='GET'&&p===`contents/${GITHUB_BANK_ROOT}/${GITHUB_BANK_RELEASE}`)return Response.json(head==='b'.repeat(40)&&pointer?pointer:initialPointer)
  if(method==='GET'&&p===`contents/${GITHUB_BANK_ROOT}/${path}`)return new Response(original)
  if(method!=='GET')posts++
  if(p==='git/blobs'){assert.equal(body.encoding,'base64');blobBytes=Buffer.from(body.content,'base64');return Response.json({sha:'3'.repeat(40)})}
  if(p==='git/trees'){
   treeCalls++
   if(treeCalls===1){assert.equal(body.base_tree,'2'.repeat(40));stagedManifest=body.tree.find(x=>x.path.endsWith('/'+GITHUB_BANK_MANIFEST)).content;assert.equal(body.tree[0].path,`${GITHUB_BANK_ROOT}/${path}`)}
   else pointer=JSON.parse(body.tree[0].content)
   return Response.json({sha:(treeCalls===1?'4':'5').repeat(40)})
  }
  if(p==='git/commits'){commitCalls++;return Response.json({sha:(commitCalls===1?'a':'b').repeat(40)})}
  if(p==='git/refs/heads/main'){
   assert.equal(body.force,false);assert.equal(body.sha,'b'.repeat(40))
   if(race){head='c'.repeat(40);return Response.json({message:'conflict'},{status:422})}
   head=body.sha;if(lostResponse){lostResponse=false;throw Error('Synthetic lost response after successful ref update')}
   return Response.json({object:{sha:head}})
  }
  throw Error('Unexpected GitHub operation '+method+' '+p)
 }
 return {fetcher,get head(){return head},get posts(){return posts},get sourceReads(){return sourceReads},get blobBytes(){return blobBytes},get pointer(){return pointer},setAdmin:v=>{admin=v}}
}
const repo=repository();const preview=await validateGithubBatch(input,repo.fetcher,'synthetic-server-token');assert.equal(repo.posts,0,'Validation never writes GitHub');assert.equal(preview.files[0].appended,1)
const publish={...input,expectedHead:preview.baseHead,validationId:preview.validationId}
const result=await publishGithubBatch(publish,repo.fetcher,'synthetic-server-token');assert.equal(repo.head,result.commit);assert.equal(repo.pointer.revision,result.revision);assert.equal(toSearchQuestions(path,await decryptToText(repo.blobBytes)).length,preview.files[0].questionCount)
assert.notEqual(repo.blobBytes.toString('utf8'),next,'GitHub stores encrypted data, never raw CSV')
const posts=repo.posts;assert.equal((await publishGithubBatch(publish,repo.fetcher,'synthetic-server-token')).alreadyPublished,true);assert.equal(repo.posts,posts)
const raced=repository({race:true});const rp=await validateGithubBatch(input,raced.fetcher,'synthetic-server-token');await assert.rejects(()=>publishGithubBatch({...input,expectedHead:rp.baseHead,validationId:rp.validationId},raced.fetcher,'synthetic-server-token'),/branch changed/i);assert.equal(raced.head,'c'.repeat(40))
const lost=repository({lostResponse:true});const lp=await validateGithubBatch(input,lost.fetcher,'synthetic-server-token');const retry={...input,expectedHead:lp.baseHead,validationId:lp.validationId};await assert.rejects(()=>publishGithubBatch(retry,lost.fetcher,'synthetic-server-token'),/retry/i);assert.equal((await publishGithubBatch(retry,lost.fetcher,'synthetic-server-token')).alreadyPublished,true)
const denied=repository();denied.setAdmin(false);const worker=createBankWorker(denied.fetcher);const env={ASSETS:{fetch:async()=>Response.json({supabaseUrl:'https://evnjoezffghtrzqacwcj.supabase.co',supabaseAnonKey:'synthetic-anon'})},GITHUB_BANK_WRITE_TOKEN:'synthetic-server-token',GITHUB_BANK_READ_TOKEN:'synthetic-server-token'}
let response=await worker(new Request('https://hyperionmaritime.org/api/question-bank/admin',{method:'POST',body:'not JSON'}),env);assert.equal(response.status,401);assert.equal(denied.sourceReads,0)
response=await worker(new Request('https://hyperionmaritime.org/api/question-bank/admin',{method:'POST',headers:{Authorization:'Bearer not-admin'},body:JSON.stringify({action:'publish',...publish})}),env);assert.equal(response.status,403);assert.equal(denied.sourceReads,0)
denied.setAdmin(true);response=await worker(new Request('https://hyperionmaritime.org/api/question-bank/admin',{method:'POST',headers:{Authorization:'Bearer admin'},body:JSON.stringify({action:'inventory'})}),env);assert.equal(response.status,200);const inventory=await response.text();assert.equal(inventory.includes('synthetic-server-token'),false);assert.equal(JSON.parse(inventory).configured,true)
const corruptRepo=repository({unselectedCorrupt:true});await assert.rejects(()=>validateGithubBatch(input,corruptRepo.fetcher,'synthetic-server-token'),/unpublished|integrity|outside/i,'Unselected out-of-band corruption must not enter a new release');assert.equal(corruptRepo.posts,0)
console.log('PASS: validation-only preview, encrypted atomic publication, non-forced concurrency, idempotent lost-response retry, admin denial and secret isolation.')
