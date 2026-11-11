import assert from 'node:assert/strict'
import { ProgressDeltaOutbox } from '../../src/lib/progressDeltaOutbox.mjs'

const data=new Map()
let failWrite=false
const store={
  get: async key => data.get(key) ?? null,
  set: async (key,value) => {
    if(failWrite)throw Error('Synthetic storage unavailable')
    data.set(key,value)
  },
  remove: async key=>data.delete(key)
}
const ownerA='11111111-1111-4111-8111-111111111111'
const ownerB='22222222-2222-4222-8222-222222222222'
const action={key:'hyperion-bookmarks',value:'{"version":0,"state":{"items":[{"id":"q1"}]}}',expected_version:'a'.repeat(32)}
const a=new ProgressDeltaOutbox(store)
const first=await a.stage(ownerA,[action],'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa')
assert.equal(first.owner,ownerA)
assert.equal(first.updates.length,1)
assert.equal((await a.pending(ownerA)).operation_id,first.operation_id)
assert.equal(await a.pending(ownerB),null,'Other signed-in accounts never see A pending work')
assert.deepEqual(await a.stage(ownerA,[{...action,value:'new content'}]),first,
  'A second change must not rewrite a possibly already committed network operation')
const reloaded=new ProgressDeltaOutbox(store)
assert.deepEqual(await reloaded.pending(ownerA),first,'Restart replays exact original ID and content')
const wrongAck=await reloaded.acknowledge(ownerA,first.operation_id,{
  ok:true,operation_id:'ffffffff-ffff-4fff-8fff-ffffffffffff',versions:{'hyperion-bookmarks':'b'.repeat(32)}
})
assert.equal(wrongAck,false)
assert.deepEqual(await a.pending(ownerA),first,'Never clear outbox on unrelated acknowledgment')
const incomplete=await reloaded.acknowledge(ownerA,first.operation_id,{
  ok:true,operation_id:first.operation_id,versions:{}
})
assert.equal(incomplete,false)
assert.deepEqual(await a.pending(ownerA),first,'Every updated section requires its server version')
assert.equal(await reloaded.acknowledge(ownerA,first.operation_id,{
  ok:true,operation_id:first.operation_id,versions:{'hyperion-bookmarks':'b'.repeat(32)}
}),true)
assert.equal(await a.pending(ownerA),null,'Only the exact fully verified ACK clears pending data')

failWrite=true
await assert.rejects(a.stage(ownerA,[action],'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'),/storage unavailable/)
assert.equal(await a.pending(ownerA),null,'Persistence failure does not fabricate an acknowledged operation')
failWrite=false
const staged=await a.stage(ownerA,[action],'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb')
await assert.rejects(
  a.replaceConflicted(ownerA,staged.operation_id,[{...action,expected_version:'c'.repeat(32)}],
    'cccccccc-cccc-4ccc-8ccc-cccccccccccc'),
  /confirmed HTTP 409/,
  'A timeout or ambiguous response must never replace an in-flight operation'
)
await a.replaceConflicted(ownerA,staged.operation_id,[{...action,expected_version:'c'.repeat(32)}],
  'cccccccc-cccc-4ccc-8ccc-cccccccccccc',true)
const replacement=await a.pending(ownerA)
assert.equal(replacement.operation_id,'cccccccc-cccc-4ccc-8ccc-cccccccccccc')
assert.equal(replacement.updates[0].expected_version,'c'.repeat(32))
assert.equal(await a.acknowledge(ownerA,staged.operation_id,{
  ok:true,operation_id:staged.operation_id,versions:{'hyperion-bookmarks':'d'.repeat(32)}
}),false,'Old acknowledgments cannot clear a rebased operation')
assert.equal((await a.pending(ownerA)).operation_id,replacement.operation_id)

const b=await a.stage(ownerB,[action],'dddddddd-dddd-4ddd-8ddd-dddddddddddd')
assert.equal((await a.pending(ownerA)).operation_id,replacement.operation_id)
assert.equal((await a.pending(ownerB)).operation_id,b.operation_id)
assert.equal(await a.acknowledge(ownerB,replacement.operation_id,{ok:true,operation_id:replacement.operation_id,versions:{'hyperion-bookmarks':'e'.repeat(32)}}),false)
assert.deepEqual((await a.pending(ownerB)).updates,b.updates)
console.log('PASS: owner-bound durable outbox, exact idempotent retries, fail-closed ACK, crash recovery, conflict rebase, storage errors')

await assert.rejects(a.stage(ownerA,[{...action,key:'unknown-progress-data'}],
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),/Invalid incremental progress operation/,
  'Unknown keys are refused even if the caller bypasses the planner')
await assert.rejects(a.stage(ownerA,[{...action,value:'x'.repeat(524289)}],
  'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee'),/Invalid incremental progress operation/,
  'Oversized values cannot enter the encrypted outbox')
