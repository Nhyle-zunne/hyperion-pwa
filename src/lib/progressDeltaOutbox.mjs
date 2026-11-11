// Durable, owner-scoped V2 operation journal. Writes are injected so the
// PWA can use its encrypted IndexedDB, and tests can simulate a restart.
// THIS MODULE IS NOT ENABLED BY THE ACTIVE V1 SYNC PATH.
// All callers must hold the existing per-account sync lock across network I/O.
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const TOKEN=/^[a-f0-9]{32}$/i
const outboxKey=owner=>'hyperion:delta-outbox:'+owner
const isChange=update=>update && typeof update.key==='string' &&
  (typeof update.value==='string'||update.value===null) &&
  TOKEN.test(update.expected_version)
function validate(owner,op) {
  if(!op||op.version!==1||op.owner!==owner||!UUID.test(op.operation_id) ||
      !Array.isArray(op.updates)||op.updates.length<1||op.updates.length>8||
      !op.updates.every(isChange)||new Set(op.updates.map(x=>x.key)).size!==op.updates.length)
    throw Error('Corrupted or foreign-account delta operation; full recovery required.')
}
export class ProgressDeltaOutbox {
  constructor(driver){this.driver=driver}
  async pending(owner){
    const text=await this.driver.get(outboxKey(owner))
    if(text==null)return null
    let op
    try {op=JSON.parse(text);validate(owner,op)}
    catch {throw Error('Pending progress delta could not be verified; preserving it for recovery.')}
    return op
  }
  async stage(owner,updates,id){
    const existing=await this.pending(owner)
    if(existing)return existing // Never mutate an in-flight operation's retry bytes.
    if(!UUID.test(id)||!Array.isArray(updates)||!updates.length||updates.length>8||
       !updates.every(isChange)||new Set(updates.map(x=>x.key)).size!==updates.length)
      throw Error('Invalid incremental progress operation.')
    const record={version:1,owner,operation_id:id,updates:JSON.parse(JSON.stringify(updates)),created_at:Date.now()}
    validate(owner,record)
    await this.driver.set(outboxKey(owner),JSON.stringify(record))
    const durable=await this.pending(owner)
    if(!durable||durable.operation_id!==id)throw Error('Delta operation was not durably persisted.')
    return durable
  }
  async acknowledge(owner,id,server){
    const op=await this.pending(owner)
    if(!op||op.operation_id!==id||server?.ok!==true||server.operation_id!==id ||
      !server.versions||typeof server.versions!=='object')return false
    if(!op.updates.every(update=>TOKEN.test(server.versions[update.key]||'')))return false
    await this.driver.remove(outboxKey(owner))
    return true
  }
  async replaceConflicted(owner,previousId,newUpdates,newId){
    const current=await this.pending(owner)
    if(!current||current.operation_id!==previousId)
      throw Error('Cannot rebase a missing or different pending operation.')
    if(newId===previousId||!UUID.test(newId)||!Array.isArray(newUpdates)||!newUpdates.length||
       newUpdates.length>8||!newUpdates.every(isChange)||
       new Set(newUpdates.map(x=>x.key)).size!==newUpdates.length)
      throw Error('Invalid rebase operation.')
    const newRecord={version:1,owner,operation_id:newId,
      updates:JSON.parse(JSON.stringify(newUpdates)),created_at:Date.now()}
    validate(owner,newRecord)
    // A definite 409 proves the old attempt did not commit. Replace it in
    // one atomic encrypted IndexedDB write without first deleting old data.
    await this.driver.set(outboxKey(owner),JSON.stringify(newRecord))
    const stored=await this.pending(owner)
    if(!stored||stored.operation_id!==newId)throw Error('Rebase was not durably persisted.')
    return stored
  }
}
