import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { createGithubBankSource, GITHUB_BANK_REVISION } from '../../supabase/functions/_shared/githubBankSource.ts'
const manifest=JSON.parse(await readFile('supabase/functions/_shared/github-bank-manifest.json','utf8'))
const manifestText=JSON.stringify(manifest), digest=createHash('sha256').update(manifestText).digest('hex')
let pointer=null, unavailable=false, bad=false
const fetcher=async input=>{const url=new URL(typeof input==='string'?input:input.url);if(url.pathname.endsWith('/hyperion-release.json'))return unavailable?new Response('',{status:503}):pointer?Response.json(pointer):new Response('',{status:404});if(url.pathname.endsWith('/hyperion-manifest.json'))return new Response(bad?'{}':manifestText);throw Error('Unexpected path '+url.pathname)}
const source=createGithubBankSource(fetcher)
assert.equal(typeof source.release,'function','Source must resolve an immutable published GitHub release')
assert.equal((await source.release()).revision,GITHUB_BANK_REVISION)
pointer={version:1,revision:'a'.repeat(40),manifestSha256:digest,publishedAt:'2026-11-03T00:00:00Z',publicationId:'test-publication',inputDigest:'b'.repeat(64)}
const next=await source.release(true);assert.equal(next.revision,pointer.revision);assert.equal(next.files.length,69)
unavailable=true;assert.equal((await source.release(true)).revision,next.revision,'Warm verified release survives an upstream outage')
await assert.rejects(()=>createGithubBankSource(fetcher).release(),/unavailable/i,'Cold outage never silently serves bootstrap')
unavailable=false;bad=true;pointer={...pointer,revision:'c'.repeat(40)}
await assert.rejects(()=>source.release(true),/integrity|manifest/i,'Invalid manifest fails closed')
bad=false;pointer={...pointer,revision:'../../other'}
await assert.rejects(()=>source.release(true),/release/i,'Only immutable commit IDs are accepted')
console.log('PASS: bootstrap, immutable release validation, warm/cold outage behavior and invalid metadata rejection.')
