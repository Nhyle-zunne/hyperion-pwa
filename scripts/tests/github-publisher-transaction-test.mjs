import { buildMediaAssets } from '../../supabase/functions/question-media-build/build.ts'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { validateGithubBatch, publishGithubBatch } from '../../worker/githubBankPublisher.ts'
import { createBankWorker } from '../../worker/index.ts'
import { decryptToText, deriveKeyBytes, toSearchQuestions } from '../../supabase/functions/_shared/bankCodec.ts'
import { GITHUB_BANK_ROOT, GITHUB_BANK_MANIFEST, GITHUB_BANK_RELEASE, GITHUB_BANK_FILES, githubAssetPath } from '../../supabase/functions/_shared/githubBankSource.ts'
const manifest=JSON.parse(await readFile('supabase/functions/_shared/github-bank-manifest.json','utf8'))
const path='deck/oic_nw_c1.csv.enc'
const text='No,Question,A,B,C,D,Ans,Explanation\n1,First synthetic question?,Port,Starboard,Ahead,Astern,A,Existing answer rationale one\n2,Second synthetic question?,Port,Starboard,Ahead,Astern,A,Existing answer rationale two\n'
const iv=crypto.getRandomValues(new Uint8Array(12)), key=await crypto.subtle.importKey('raw',deriveKeyBytes(),'AES-GCM',false,['encrypt','decrypt']), encrypted=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv},key,new TextEncoder().encode(text)))
const original=new Uint8Array(12+encrypted.length);original.set(iv);original.set(encrypted,12)
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',typeof value==='string'?new TextEncoder().encode(value):value))].map(x=>x.toString(16).padStart(2,'0')).join('')
Object.assign(manifest.files.find(file=>file.path===path),{bytes:original.length,sha256:await hash(original)})
const initialPointer={version:1,revision:'0'.repeat(40),manifestSha256:await hash(JSON.stringify(manifest)),publishedAt:'2026-11-03T00:00:00Z',publicationId:'fixture-initial',inputDigest:'f'.repeat(64)}
const next='No,Question,A,B,C,D,Ans,Explanation\n1,First synthetic question?,Port,Starboard,Ahead,Astern,A,\n2,Second synthetic question?,Port,Starboard,Ahead,Astern,A,\n999999,Publisher synthetic append question?,Port,Starboard,Ahead,Astern,A,\n'
const input={requestId:'synthetic-publish-123',files:[{path,format:'csv',content:next}]}
function repository({race=false,lostResponse=false,unselectedCorrupt=false}={}){
 let bankEntries=[], blobContents=[], head='1'.repeat(40),posts=0,sourceReads=0,stagedManifest='',pointer=null,blobBytes=null,treeCalls=0,commitCalls=0,admin=true
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
  if(p==='git/blobs'){blobContents.push(body.content);assert.equal(body.encoding,'base64');blobBytes=Buffer.from(body.content,'base64');return Response.json({sha:'3'.repeat(40)})}
  if(p==='git/trees'){
   treeCalls++
   if(treeCalls===1){bankEntries=body.tree;assert.equal(body.base_tree,'2'.repeat(40));stagedManifest=body.tree.find(x=>x.path.endsWith('/'+GITHUB_BANK_MANIFEST)).content;assert.equal(body.tree[0].path,`${GITHUB_BANK_ROOT}/${path}`)}
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
 return {fetcher,get bankEntries(){return bankEntries},get blobContents(){return blobContents},get head(){return head},get posts(){return posts},get sourceReads(){return sourceReads},get blobBytes(){return blobBytes},get pointer(){return pointer},setAdmin:v=>{admin=v}}
}
const repo=repository();const preview=await validateGithubBatch(input,repo.fetcher,'synthetic-server-token');assert.equal(repo.posts,0,'Validation never writes GitHub');assert.equal(preview.files[0].appended,1)
const publish={...input,expectedHead:preview.baseHead,validationId:preview.validationId}
const result=await publishGithubBatch(publish,repo.fetcher,'synthetic-server-token');assert.equal(repo.head,result.commit);assert.equal(repo.pointer.revision,result.revision);const publishedQuestions=toSearchQuestions(path,await decryptToText(repo.blobBytes));assert.equal(publishedQuestions.length,preview.files[0].questionCount);assert.deepEqual(publishedQuestions.slice(0,2).map(q=>q.explanation),['Existing answer rationale one','Existing answer rationale two']);assert.equal(preview.files[0].explanationsPreserved,2)
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

// Referenced images must join the same bank commit as binary encrypted blobs.
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])
const imageRef={sha256:await hash(png),mime:'image/png',placement:'question',alt:'Synthetic diagram'}
const mediaCell='"'+JSON.stringify([imageRef]).replaceAll('"','""')+'"'
const imageCsv=next.trim().split('\n').map((row,index)=>row+','+(index===0?'HYPERION_MEDIA':index===1?mediaCell:'')).join('\n')
const imageInput={...input,requestId:'synthetic-with-images',files:[{path,format:'csv',content:imageCsv}]}
const imageRepo=repository(), imagePreview=await validateGithubBatch(imageInput,imageRepo.fetcher,'synthetic-server-token')
assert.equal(imageRepo.posts,0)
const imagePublish={...imageInput,expectedHead:imagePreview.baseHead,validationId:imagePreview.validationId}
await assert.rejects(()=>publishGithubBatch(imagePublish,imageRepo.fetcher,'synthetic-server-token'),/bundled/)
assert.equal(imageRepo.posts,0)
let bundles=0
const bundle=async refs=>{bundles++;assert.deepEqual(refs,[{track:'DECK_OIC_NW',sha256:imageRef.sha256,mime:imageRef.mime}]);return (await buildMediaAssets(refs,async()=>new Blob([png]))).assets}
const imageResult=await publishGithubBatch(imagePublish,imageRepo.fetcher,'synthetic-server-token',bundle)
assert.equal(bundles,1)
assert.ok(imageRepo.bankEntries.some(entry=>entry.path===`app/src/main/assets/question-media/DECK_OIC_NW/${imageRef.sha256}.png.enc`&&entry.sha==='3'.repeat(40)&&entry.content===undefined))
const imageBytes=Buffer.from(imageRepo.blobContents[1],'base64')
assert.equal(imageBytes.length,png.length+28)
assert.deepEqual(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:imageBytes.subarray(0,12)},key,imageBytes.subarray(12))),png)
assert.equal((await publishGithubBatch(imagePublish,imageRepo.fetcher,'synthetic-server-token',bundle)).alreadyPublished,true)
assert.equal(bundles,1,'Idempotent retry does not re-export images')
assert.equal(imageRepo.head,imageResult.commit)
const badMediaRepo=repository(), badPreview=await validateGithubBatch(imageInput,badMediaRepo.fetcher,'synthetic-server-token')
await assert.rejects(()=>publishGithubBatch({...imageInput,expectedHead:badPreview.baseHead,validationId:badPreview.validationId},badMediaRepo.fetcher,'synthetic-server-token',async()=>[]),/incomplete/)
assert.equal(badMediaRepo.posts,0,'Failed media verification never writes GitHub objects')
console.log('PASS: media bundled into atomic bank tree as binary blobs; missing/corrupt export blocks writes; idempotent retries skip export.')
