import { planProgressSectionUpdates } from './progressSectionDelta.mjs'

// V2 is deliberately disabled until native Android, PWA hydration and
// cross-device conflict integration tests pass. This module is the transport
// boundary only: it NEVER changes V1 canonical sync or marks stores clean.
export const INCREMENTAL_PROGRESS_V2_ENABLED = false

/**
 * One durable owner-scoped V2 attempt. Call under the SAME cross-tab/account
 * sync lock used for V1. The caller must supply fresh, server-verified user
 * identity (not a cached local entitlement) before and after network I/O.
 *
 * send(body) -> {status:number,body:object}. A lost response is ambiguous;
 * the stored operation must be retried byte-for-byte with the same ID.
 * A confirmed 409 retains the outbox for an explicit three-way rebase.
 *
 * Never treat 404/503 as permission to clear queued data or silently upgrade
 * to a V1 overwrite. The caller may invoke V1 full recovery after resolving
 * the pending V2 op, but not before.
 */
export async function deliverProgressOperation({ owner, outbox, getCurrentUserId, send, updates, newId }) {
  if(typeof owner!=='string'||!outbox||typeof getCurrentUserId!=='function'||typeof send!=='function')
    throw Error('Incremental progress requires an owner and validated transport.')
  let pending=await outbox.pending(owner)
  if(!pending){
    if(!Array.isArray(updates)||updates.length===0)return {status:'nothing-to-send'}
    if(typeof newId!=='string')throw Error('A new durable V2 operation requires a UUID.')
    // Persist the complete, immutable operation before the first network call.
    pending=await outbox.stage(owner,updates,newId)
  }
  // The callback MUST check current signed Supabase user, not merely localStorage
  // OWNER_KEY. Pausing here leaves the encrypted journal intact.
  if(await getCurrentUserId()!==owner)return {status:'paused'}
  let response
  try {
    response=await send({
      action:'write-sections',
      operation_id:pending.operation_id,
      updates:pending.updates
    })
  }catch{
    return {status:'retry'}
  }
  if(await getCurrentUserId()!==owner)return {status:'paused'}
  if(response?.status===409){
    const conflicts=response.body?.conflicts
    if(!Array.isArray(conflicts)||!conflicts.length||
       conflicts.some(key=>!pending.updates.some(u=>u.key===key)))
      return {status:'retry'}
    return {status:'conflict',conflicts}
  }
  if(response?.status!==200)return {status:'retry'}
  if(!await outbox.acknowledge(owner,pending.operation_id,response.body))
    return {status:'retry'}
  return {status:'acknowledged',versions:response.body.versions,updated_at:response.body.updated_at}
}

/** Plan from the already-ACKed remote baseline. If unsafe, do not stage a
 * partial operation. The caller must first recover and merge using V1. */
export function prepareProgressOperation({ baseline, current, versions, dirtyKeys }) {
  return planProgressSectionUpdates(baseline,current,versions,dirtyKeys)
}
