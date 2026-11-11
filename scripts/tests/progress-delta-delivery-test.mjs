import assert from 'node:assert/strict'
import { ProgressDeltaOutbox } from '../../src/lib/progressDeltaOutbox.mjs'
import { deliverProgressOperation, prepareProgressOperation, INCREMENTAL_PROGRESS_V2_ENABLED } from '../../src/lib/progressDeltaDelivery.mjs'

assert.equal(INCREMENTAL_PROGRESS_V2_ENABLED,false,'V2 must be OFF in production')
const owner='11111111-1111-4111-8111-111111111111'
const other='22222222-2222-4222-8222-222222222222'
const opId='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa'
const newId='bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb'
const version='a'.repeat(32)
const changed={key:'hyperion-history',value:'{"version":0,"state":{"entries":[{"id":"one"}]}}',expected_version:version}
const driver=new Map()
const outbox=new ProgressDeltaOutbox({
 get:async k=>driver.get(k)??null,
 set:async(k,v)=>{driver.set(k,v)},
 remove:async k=>{driver.delete(k)}
})
let loggedIn=owner
let requestCount=0
let lastSent=''
let fail=true
const getCurrentUserId=async()=>loggedIn
const send=async body=>{
  requestCount++
  const raw=JSON.stringify(body)
  if(lastSent&&fail)assert.equal(raw,lastSent,'Ambiguous delivery cannot change operation bytes')
  lastSent=raw
  if(fail)throw Error('Simulated lost response after commit')
  return {status:200,body:{ok:true,operation_id:opId,versions:{'hyperion-history':'b'.repeat(32)}}}
}
let r=await deliverProgressOperation({owner,outbox,getCurrentUserId,send,updates:[changed],newId:opId})
assert.equal(r.status,'retry')
assert.equal(requestCount,1)
assert.equal((await outbox.pending(owner)).operation_id,opId)

loggedIn=other
r=await deliverProgressOperation({owner,outbox,getCurrentUserId,send,
 updates:[{...changed,value:'unsafe-newer'}],newId})
assert.equal(r.status,'paused')
assert.equal(requestCount,1,'Account switch makes zero unauthorized requests')
assert.equal((await outbox.pending(owner)).operation_id,opId)
assert.equal(await outbox.pending(other),null,'Other owner never accesses prior outbox')

loggedIn=owner
fail=false
r=await deliverProgressOperation({owner,outbox,getCurrentUserId,send,updates:[],newId})
assert.equal(r.status,'acknowledged')
assert.equal(requestCount,2)
assert.equal(await outbox.pending(owner),null)

r=await deliverProgressOperation({owner,outbox,getCurrentUserId,send,updates:[changed],newId:newId})
assert.equal(r.status,'retry','Wrong operation ID cannot ACK another operation')
assert.equal((await outbox.pending(owner)).operation_id,newId)
const previous=await outbox.pending(owner)
const conflictTransport=async()=>({status:409,body:{conflicts:['hyperion-history']}})
r=await deliverProgressOperation({owner,outbox,getCurrentUserId,send:conflictTransport})
assert.deepEqual(r,{status:'conflict',conflicts:['hyperion-history']})
assert.deepEqual(await outbox.pending(owner),previous,'Confirmed 409 does not erase local edits')
r=await deliverProgressOperation({owner,outbox,getCurrentUserId,send:async()=>({status:409,body:{conflicts:['foreign-key']}})})
assert.equal(r.status,'retry','Unverified conflict cannot cause rebase')
assert.deepEqual(await outbox.pending(owner),previous)

const another=new ProgressDeltaOutbox({
 get:async k=>driver.get(k)??null,
 set:async(k,v)=>{driver.set(k,v)},
 remove:async k=>{driver.delete(k)}
})
assert.deepEqual(await another.pending(owner),previous,'Restart replays identical durable operation')

const original={ 'hyperion-history':'{"version":0,"state":{"entries":[]}}' }
const current={ 'hyperion-history':'{"version":0,"state":{"entries":[{"id":"saved"}]}}' }
const planned=prepareProgressOperation({
 baseline:original,current,versions:{'hyperion-history':version},dirtyKeys:['hyperion-history']
})
assert.equal(planned.needsFullRecovery,false)
assert.equal(planned.updates.length,1)
const bad=prepareProgressOperation({
 baseline:original,current,versions:{},dirtyKeys:['hyperion-history']
})
assert.equal(bad.needsFullRecovery,true)
assert.equal(bad.updates.length,0)
console.log('PASS: V2 OFF; exact crash replay, owner switch, ACK, 409 conflict and unknown-version V1 recovery')
