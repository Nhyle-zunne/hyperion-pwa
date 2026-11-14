import assert from 'node:assert/strict'
import { createBankWorker } from '../../worker/index.ts'
import { SOURCE_ASSETS, deriveKeyBytes } from '../../supabase/functions/_shared/bankCodec.ts'
import { sha256 } from '../../supabase/functions/_shared/githubBankSource.ts'

const prefix = 'https://hyperionmaritime.org'
const revision = 'b'.repeat(40)
const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['encrypt'])
async function encrypt(bytes) {
  const nonce = crypto.getRandomValues(new Uint8Array(12))
  return new Uint8Array([...nonce, ...new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv:nonce},key,bytes))])
}
const imageBytes = Array.from({length:9},(_,i)=>Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,i]))
const refs = await Promise.all(imageBytes.map(async bytes=>({sha256:await sha256(bytes),mime:'image/png'})))
const images = new Map(await Promise.all(refs.map(async(ref,i)=>[ref.sha256,await encrypt(imageBytes[i])])))
function row(number, items) {
  const media = JSON.stringify(items.map(ref=>({...ref,placement:'question',alt:'Synthetic diagram'}))).replaceAll('"','""')
  return `${number},Synthetic question ${number},one,two,three,four,A,,"${media}"`
}
const csv = ['No,Question,A,B,C,D,Answer,Explanation,HYPERION_MEDIA',row(1,refs.slice(0,4)),row(2,refs.slice(4,8)),row(3,[refs[8]]),row(4,[]),row(5,[])].join('\n')
const ciphertext = await encrypt(new TextEncoder().encode(csv))
const digest = await sha256(ciphertext)
const manifest = new TextEncoder().encode(JSON.stringify({version:1,encrypted:true,files:SOURCE_ASSETS.map(path=>({path,bytes:ciphertext.length,sha256:digest}))}))
const pointer = JSON.stringify({version:1,revision,manifestSha256:await sha256(manifest),publishedAt:'2026-11-14T00:00:00Z',publicationId:'fixture',inputDigest:'a'.repeat(64)})
let requests=0, grants=0, allowed=true
const cache={ async match(){ requests++; return undefined },async put(){ requests++ } }
const fetcher=async(input,options)=>{
 requests++
 const url=new URL(typeof input==='string'?input:input.url)
 if(url.hostname.endsWith('.supabase.co')) { grants++; return new Response(JSON.stringify({allowed,track:'DECK_MGT',access:'licensed'}),{status:allowed?200:403}) }
 if(url.pathname.endsWith('/hyperion-release.json')) return new Response(pointer)
 if(url.pathname.endsWith('/hyperion-manifest.json')) return new Response(manifest)
 if(url.pathname.includes('/question-media/')) return new Response(images.get(url.pathname.match(/([a-f0-9]{64})\.png\.enc$/)?.[1]),{status:200})
 if(url.pathname.endsWith('.csv.enc')) return new Response(ciphertext)
 throw new Error('Unexpected request '+url.pathname)
}
const assets={async fetch(){ requests++; return new Response(JSON.stringify({supabaseUrl:'https://evnjoezffghtrzqacwcj.supabase.co',supabaseAnonKey:'fixture'})) }}
const call=(worker,freeOnly,selected,authorization='Bearer fixture')=>worker(new Request(prefix+'/api/question-bank/media',{method:'POST',headers:{'Content-Type':'application/json',...(authorization?{Authorization:authorization}:{})},body:JSON.stringify({track:'DECK_MGT',freeOnly,images:selected})}),{ASSETS:assets})
let worker=createBankWorker(fetcher,cache)
let response=await call(worker,false,refs.slice(0,8))
assert.equal(response.status,200); assert.equal((await response.json()).images.length,8); assert.equal(grants,1)
assert(requests<=50,`Cold batch used ${requests} subrequests`)
allowed=false; assert.equal((await call(worker,false,[refs[0]])).status,403,'Warm cache must respect revoked access')
worker=createBankWorker(fetcher,cache); requests=0; grants=0
response=await call(worker,true,refs.slice(0,8),'')
assert.equal(response.status,403,'Free Reviewer must not unlock images')
assert.equal(grants,0,'Free image requests must never check a license or cause Supabase traffic')
assert.equal(requests,0,'Free image requests must not fetch GitHub ciphertext or configuration')
assert.equal((await call(worker,true,[refs[0]],'Bearer fixture')).status,403,'A client cannot bypass the full-reviewer image gate with freeOnly')
assert.equal((await call(worker,true,[refs[0],refs[0]],'')).status,400)
assert.equal((await call(worker,true,refs,'')).status,400)
assert.equal((await call(worker,false,[refs[0]],'')).status,401)
console.log('PASS: licensed media batch, revocation, free-image denial before any I/O and bounded inputs.')
