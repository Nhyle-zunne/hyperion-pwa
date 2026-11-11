import assert from 'node:assert/strict'
import { planProgressSectionUpdates, progressSectionEquivalent } from '../../src/lib/progressSectionDelta.mjs'

const B='hyperion-bookmarks', V='hyperion-vault', H='hyperion-history', D='hyperion-progress-deletions'
const wrap = items => JSON.stringify({ version:0, state:{ items } })
const ledger = (bookmarks={}, vault={}) => JSON.stringify({ version:1, bookmarks, vault })
const ver = Object.fromEntries([B,V,H,D].map((key,i)=>[key,String(i).repeat(32)]))
const book = (id, savedAt=100)=>({id,track:'DECK_OIC_NW',questionText:'synthetic '+id,savedAt})
const mistakes = (id, count=1)=>({id,track:'DECK_OIC_NW',lastWrongAt:100,wrongCount:count})
const original = { [B]:wrap([book('q1'),book('q2')]), [V]:wrap([mistakes('v1')]),
  [D]:ledger(), [H]:JSON.stringify({version:0,state:{entries:[{id:'history-a',finishedAt:100}]}}) }
const next = structuredClone(original)
next[B]=wrap([book('q1'),book('q2'),book('q3',200)])
next[V]=wrap([mistakes('v1',2)])
next[D]=ledger({q2:{at:500,deleted:true}})
next[B]=wrap([book('q1'),book('q3',200)])
next[H]=JSON.stringify({version:0,state:{entries:[{id:'history-a',finishedAt:100},{id:'history-b',finishedAt:200}]}})

const result=planProgressSectionUpdates(original,next,ver,[B,V,D,H])
assert.equal(result.needsFullRecovery,false)
assert.deepEqual(result.updates.map(x=>x.key),[B,V,D,H])
const bookmarkPatch=JSON.parse(result.updates[0].value)
assert.deepEqual(bookmarkPatch.state.items.map(x=>x.id),['q3'],'Saving one bookmark uploads only that new item')
assert.deepEqual(JSON.parse(result.updates[1].value).state.items.map(x=>x.wrongCount),[2])
assert.deepEqual(Object.keys(JSON.parse(result.updates[2].value).bookmarks),['q2'])
assert.equal(JSON.parse(result.updates[3].value).state.entries.length,2,
  'History remains section-based until record-by-ID merging is available')
assert.deepEqual(result.updates.map(x=>x.expected_version),[ver[B],ver[V],ver[D],ver[H]])

assert.equal(progressSectionEquivalent('{"state":{"items":[{"id":"q1"}]},"version":0}',
  '{ "version": 0, "state": { "items": [{"id":"q1"}] } }'),true)
assert.equal(planProgressSectionUpdates(original,{...original,[B]:JSON.stringify(JSON.parse(original[B]),null,2)},ver,[B]).updates.length,0)
assert.equal(planProgressSectionUpdates(original,original,ver,[B,V,D,H]).updates.length,0)

const unsafeRemoval=planProgressSectionUpdates(original,
  {...original,[B]:wrap([book('q1')])},ver,[B])
assert.equal(unsafeRemoval.needsFullRecovery,true,'A deletion without an explicit tombstone cannot be acknowledged as synced')
assert.deepEqual(unsafeRemoval.updates,[])
assert.equal(planProgressSectionUpdates(original,{...original,[B]:wrap([book('q1')])},ver,[B,D]).needsFullRecovery,true)
assert.equal(planProgressSectionUpdates(original,next,{...ver,[B]:undefined},[B]).needsFullRecovery,true,
  'An unknown section version must not cause a blind overwrite')
const malformed=planProgressSectionUpdates(original,{...original,[B]:'oops'},ver,[B])
assert.equal(malformed.needsFullRecovery,true,'Malformed persisted question collection fails closed')
assert.equal(malformed.updates.length,0)

const oversized=planProgressSectionUpdates(original,{
  ...original, [H]:'X'.repeat(524289)
},ver,[H])
assert.equal(oversized.needsFullRecovery,true)
assert.deepEqual(oversized.updates,[])
console.log('PASS: minimal bookmark and mistake payloads, tombstones, section isolation, unknown versions and fail-safe fallback')
