import { test } from 'node:test'
import assert from 'node:assert/strict'
import { collectBankImages, checkMediaAssets, createMediaBundler, checkPublishBudget } from '../../worker/questionMediaBundler.ts'
import { buildMediaAssets } from '../../supabase/functions/question-media-build/build.ts'
import { sha256 } from '../../supabase/functions/question-media/policy.ts'
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])
const ref={track:'ENGINE_MGT',sha256:await sha256(png),mime:'image/png'} as const
const cell=(v:unknown)=>'"'+JSON.stringify(v).replaceAll('"','""')+'"'
const csv='No.,Question,A,B,C,D,Correct Answer,Explanation,HYPERION_MEDIA\n1,Which diagram?,Yes,No,Maybe,Never,A,,'+cell([{sha256:ref.sha256,mime:ref.mime,placement:'question',alt:'Diagram'}])
test('collect unique references with track derived from bank path',()=>{
 assert.deepEqual(collectBankImages([{path:'engine_mgt/em_c2.csv.enc',text:csv},{path:'engine_mgt/em_c1.csv.enc',text:csv}]),[ref])
 assert.throws(()=>collectBankImages([{path:'../secret',text:csv}]))
 assert.doesNotThrow(()=>checkPublishBudget(10,11))
 assert.throws(()=>checkPublishBudget(10,20),/limit|smaller/i)
})
test('bundler verifies exact paths, references, sizes, encryption and image hash',async()=>{
 const {assets}=await buildMediaAssets([ref],async()=>new Blob([png]))
 assert.deepEqual(await checkMediaAssets([ref],{assets}),assets)
 for(const body of [{assets:[]},{assets:[assets[0],assets[0]]},{assets:[{...assets[0],path:'../secret'}]},{assets:[{...assets[0],ciphertext:btoa('wrong')}]}]) await assert.rejects(()=>checkMediaAssets([ref],body))
 const wrong=await buildMediaAssets([{...ref,track:'ENGINE_OIC_EW'}],async()=>new Blob([png]))
 await assert.rejects(()=>checkMediaAssets([ref],wrong))
 let calls=0
 const bundler=createMediaBundler(async(url,opts)=>{
  calls++;assert.equal(url,'https://test.supabase.co/functions/v1/question-media-build')
  const headers=new Headers(opts?.headers);assert.equal(headers.get('Authorization'),'Bearer user-session');assert.equal(headers.get('apikey'),'anon');assert.equal(headers.get('X-Hyperion-Build-Auth'),null)
  assert.deepEqual(JSON.parse(String(opts?.body)),{images:[ref]});return Response.json({assets})
 },'https://test.supabase.co','anon','Bearer user-session')
 assert.deepEqual(await bundler([ref]),assets);assert.equal(calls,1)
})
