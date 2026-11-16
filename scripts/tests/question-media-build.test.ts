import { test } from 'node:test'
import assert from 'node:assert/strict'
import { authorizeBuild, buildMediaAssets, validateBuildImages } from '../../supabase/functions/question-media-build/build.ts'
import { deriveKeyBytes } from '../../supabase/functions/_shared/bankCodec.ts'
import { sha256, MAX_IMAGE_BYTES } from '../../supabase/functions/question-media/policy.ts'
const png = new Uint8Array([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])
const ref = { track: 'ENGINE_MGT', sha256: await sha256(png), mime: 'image/png' } as const
test('build auth requires verified allowlisted user or fixed repository maintain/admin permission', async () => {
 const user = async () => ({ id:'user',email:'admin@example.com' })
 const github: typeof fetch = async (url, options) => {
  assert.equal(url,'https://api.github.com/repos/Nhyle-zunne/hyperion-reviewer')
  assert.equal(new Headers(options?.headers).get('Authorization'),'Bearer opaque')
  assert.equal(options?.redirect,'error')
  return Response.json({full_name:'Nhyle-zunne/hyperion-reviewer',private:false,permissions:{admin:true}})
 }
 const auth = (mode:string|null, fetcher:typeof fetch=github, getUser:()=>Promise<{id?:string;email?:string}|null>=user) => authorizeBuild('Bearer opaque',mode,'admin@example.com',getUser,fetcher)
 assert.equal(await auth(null),true)
 assert.equal(await auth(null,undefined,async()=>null),false)
 assert.equal(await auth(null,undefined,async()=>({id:'user',email:'other@example.com'})),false)
 assert.equal(await auth('github'),true)
 assert.equal(await auth('github',async()=>Response.json({full_name:'Nhyle-zunne/hyperion-reviewer',permissions:{maintain:true}})),true)
 for(const data of [{full_name:'elsewhere/repo',permissions:{admin:true}},{full_name:'Nhyle-zunne/hyperion-reviewer',permissions:{push:true}},{}]) assert.equal(await auth('github',async()=>Response.json(data)),false)
 for(const status of [401,403]) assert.equal(await auth('github',async()=>new Response('',{status})),false)
 assert.equal(await auth('unknown'),false)
 assert.equal(await authorizeBuild(null,null,'admin@example.com',user,fetch),false)
})
test('references, object hashes, image signatures and response size are bounded',async()=>{
 for(const body of [{images:[]},{images:Array(21).fill(ref)},{images:[{...ref,track:'../secret'}]},{images:[{...ref,sha256:'bad'}]},{images:[{...ref,mime:'image/svg+xml'}]},{images:[ref,ref]}]) assert.throws(()=>validateBuildImages(body))
 assert.deepEqual(validateBuildImages({images:[ref]}),[ref])
 await assert.rejects(()=>buildMediaAssets([ref],async()=>null))
 await assert.rejects(()=>buildMediaAssets([ref],async()=>new Blob([new Uint8Array(16)])))
 await assert.rejects(()=>buildMediaAssets([ref],async()=>new Blob([new Uint8Array(MAX_IMAGE_BYTES+1)])))
 await assert.rejects(()=>buildMediaAssets([{...ref,sha256:'a'.repeat(64)}],async()=>new Blob([png])))
 await assert.rejects(()=>buildMediaAssets([ref],async()=>new Blob([png]),43))
})
test('binary build output uses Android AssetCrypto nonce+ciphertext+tag format',async()=>{
 const {assets}=await buildMediaAssets([ref],async(path)=>{assert.equal(path,`ENGINE_MGT/${ref.sha256}.png`);return new Blob([png])})
 assert.equal(assets[0].path,`question-media/ENGINE_MGT/${ref.sha256}.png.enc`)
 const bytes=Uint8Array.from(atob(assets[0].ciphertext),c=>c.charCodeAt(0))
 assert.equal(bytes.length,png.length+28)
 const key=await crypto.subtle.importKey('raw',deriveKeyBytes(),'AES-GCM',false,['decrypt'])
 assert.deepEqual(new Uint8Array(await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(0,12),tagLength:128},key,bytes.slice(12))),png)
})
