// Side-effect-free V2 planner. The active v1 full snapshot sync does not use
// this module yet; it becomes eligible only after server/client rollout gates.
const BOOKMARKS='hyperion-bookmarks', VAULT='hyperion-vault'
const DELETIONS='hyperion-progress-deletions'
const KEYS=new Set([
  'hyperion-history','hyperion-study-time',VAULT,BOOKMARKS,
  'hyperion-saved-practice','hyperion-mock-exam-plan-v1',
  'hyperion-question-attempt-history',DELETIONS
])
const MAX_SECTION_BYTES=524288
const fallback=()=>({updates:[],needsFullRecovery:true})
const canonical = value => {
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']'
  if(value&&typeof value==='object')return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}'
  return JSON.stringify(value)
}
const parse = input => typeof input==='string' ? JSON.parse(input) : input
export function progressSectionEquivalent(before,after) {
  if(before===after)return true
  try {return canonical(parse(before))===canonical(parse(after))}
  catch {return false}
}
const validWrapper=raw=>{
  const p=parse(raw)
  if(!p||typeof p!=='object'||!p.state||!Array.isArray(p.state.items))throw Error('Invalid saved question collection')
  if(p.state.items.some(x=>!x||typeof x.id!=='string'||!x.id))throw Error('Missing question identity')
  if(new Set(p.state.items.map(x=>x.id)).size!==p.state.items.length)throw Error('Duplicate question identity')
  return p
}
const emptyWrapper=()=>({version:0,state:{items:[]}})
const ledgerObject=raw=>{
  const p=raw==null?{version:1,bookmarks:{},vault:{}}:parse(raw)
  if(!p||typeof p!=='object'||Array.isArray(p))throw Error('Invalid deletion ledger')
  for(const col of ['bookmarks','vault']){
    if(p[col]!==undefined && (typeof p[col]!=='object'||p[col]===null||Array.isArray(p[col])))throw Error('Invalid deletion ledger collection')
  }
  return p
}
const verifiedDeletion=(ledger,collection,id,old)=>{
  const marker=ledger[collection]?.[id]
  const stamp=Number(old?.[collection==='bookmarks'?'savedAt':'lastWrongAt'])||0
  return marker?.deleted===true && Number.isFinite(Number(marker.at)) && Number(marker.at)>=stamp
}
function itemPatch(key,prior,next,ledger) {
  const before=prior==null?emptyWrapper():validWrapper(prior)
  const after=next==null?emptyWrapper():validWrapper(next)
  const beforeById=new Map(before.state.items.map(item=>[item.id,item]))
  const afterById=new Map(after.state.items.map(item=>[item.id,item]))
  const collection=key===BOOKMARKS?'bookmarks':'vault'
  for(const [id,record] of beforeById) {
    if(!afterById.has(id) && !verifiedDeletion(ledger,collection,id,record))throw Error('Missing explicit deletion marker')
  }
  const changed=after.state.items.filter(item=>!beforeById.has(item.id) ||
    !progressSectionEquivalent(beforeById.get(item.id),item))
  const beforeMetadata={...before,state:{...before.state,items:[]}}
  const afterMetadata={...after,state:{...after.state,items:[]}}
  if(!progressSectionEquivalent(beforeMetadata,afterMetadata))return next
  if(!changed.length)return null
  return JSON.stringify({...after,state:{...after.state,items:changed}})
}
function ledgerPatch(prior,next){
  const before=ledgerObject(prior),after=ledgerObject(next)
  const output={version:1,bookmarks:{},vault:{}}
  let changed=false
  for(const collection of ['bookmarks','vault']){
    for(const [id,marker] of Object.entries(after[collection]||{})){
      if(!marker||typeof marker!=='object'||!Number.isFinite(Number(marker.at)) ||
        typeof marker.deleted!=='boolean')throw Error('Invalid deletion marker')
      if(!progressSectionEquivalent(before[collection]?.[id],marker)){
        output[collection][id]=marker
        changed=true
      }
    }
    if(Object.keys(before[collection]||{}).some(id=>!Object.hasOwn(after[collection]||{},id)))
      throw Error('Deletion tombstone removed without replacement')
  }
  return changed?JSON.stringify(output):null
}
/**
 * Generate up to eight independently versioned patches, never a complete
 * progress snapshot. Empty patch = no-op. Unknown version / unsafe omission /
 * malformed payload / oversized section => fallback to v1 recovery *without*
 * acknowledging any of the pending changes.
 */
export function planProgressSectionUpdates(previousStorage,currentStorage,versions,dirtyKeys){
  if(!previousStorage||!currentStorage||!versions||!Array.isArray(dirtyKeys))return fallback()
  if(dirtyKeys.length>8||new Set(dirtyKeys).size!==dirtyKeys.length)return fallback()
  const updates=[]
  try{
    const nextLedger=ledgerObject(currentStorage[DELETIONS])
    for(const key of dirtyKeys){
      if(!KEYS.has(key) || !/^[a-f0-9]{32}$/i.test(versions[key]||''))return fallback()
      const prior=previousStorage[key]??null, next=currentStorage[key]??null
      if(progressSectionEquivalent(prior,next))continue
      if(next!==null && typeof next!=='string')return fallback()
      let value=next
      if(key===BOOKMARKS||key===VAULT){
        value=itemPatch(key,prior,next,nextLedger)
        if(value===null)continue
      }else if(key===DELETIONS){
        value=ledgerPatch(prior,next)
        if(value===null)continue
      }else if(value!==null){
        // Never allow malformed state to be certified as synced.
        parse(value)
      }
      if(value!==null && new TextEncoder().encode(value).byteLength>MAX_SECTION_BYTES)return fallback()
      updates.push({key,value,expected_version:versions[key]})
    }
    // Collection removals are effective only if their ledger update travels
    // in the same operation (or was already acknowledged in the baseline).
    for(const key of [BOOKMARKS,VAULT]){
      if(!dirtyKeys.includes(key))continue
      const prev=previousStorage[key],curr=currentStorage[key]
      if(prev==null||curr==null)continue
      const removed=validWrapper(prev).state.items.filter(item=>
        !new Set(validWrapper(curr).state.items.map(x=>x.id)).has(item.id))
      if(removed.length && !dirtyKeys.includes(DELETIONS))return fallback()
    }
    return {updates,needsFullRecovery:false}
  }catch{return fallback()}
}
