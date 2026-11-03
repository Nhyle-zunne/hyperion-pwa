import {expect,mock,test} from 'bun:test'
let released=false, mismatch=false, written:any[]=[]
const current='b'.repeat(40), old='a'.repeat(40), path='engine_ew/ew_c1.csv.enc'
const question=(n:number)=>({id:'EW-C1-'+String(n).padStart(3,'0'),track:'ENGINE_OIC_EW',functionId:'F1',competenceId:'C1',topic:'Synthetic',questionText:'Question '+n,options:['Port','Starboard'],correctAnswerIndex:0,explanation:'',difficulty:'EASY'})
mock.module('../../src/lib/supabase',()=>({supabaseAnonKey:'synthetic',supabase:{auth:{getSession:async()=>({data:{session:{user:{id:'owner'},access_token:'synthetic'}}}),onAuthStateChange:()=>({data:{subscription:{unsubscribe(){}}}})},functions:{invoke:async(_name:string,{body}:any)=>{
 if(body.action==='offline-license')return{data:{token:'signed-fixture',trackIds:['ENGINE_OIC_EW']},error:null}
 if(body.action==='content-versions')return{data:{track:'ENGINE_OIC_EW',bankRevision:current,versionFormat:'github-content-sha256-v1',versions:[{path,competenceId:'C1',part:null,freeHash:'a'.repeat(64),fullHash:'b'.repeat(64)}]},error:null}
 if(body.action==='counts')return{data:{bankRevision:released?current:old,counts:[{competenceId:'C1',part:null,count:released?2:1}]},error:null}
 if(body.action==='questions')return{data:{bankRevision:mismatch?old:current,totalCount:2,questions:[question(1),question(2)].slice(body.offset,body.offset+body.limit)},error:null}
 throw Error('Unexpected action '+body.action)
}}}}))
const cache=await import('../../src/lib/offlineQuestionCache')
mock.module('../../src/lib/offlineQuestionCache',()=>({...cache,getOfflinePackManifest:async()=>null,getOfflinePackStatus:async()=>null,getOfflineQuestionCounts:async()=>null,getCachedOfflineEntitlementSnapshot:async()=>({userId:'owner',isAdmin:true,trackExpiries:{}}),saveOfflineEntitlements:async()=>true,saveOfflineQuestionPackSets:async(sets:any[])=>{written=sets}}))
Object.defineProperty(globalThis,'navigator',{configurable:true,value:{onLine:true}})
const {getQuestionCountsByTrack,downloadOfflinePack,getQuestionsByCompetence}=await import('../../src/lib/questionBank')
test('offline preparation bypasses cached old counts and includes appended questions from its pinned release',async()=>{
 expect((await getQuestionCountsByTrack('ENGINE_OIC_EW',false))[0].count).toBe(1)
 released=true
 await downloadOfflinePack('ENGINE_OIC_EW',false,undefined,{background:true})
 expect(written.find(row=>!row.freeOnly).groups.flatMap((group:any)=>group.questions)).toHaveLength(2)
})

test('a mismatched page release never commits a replacement offline pack',async()=>{
 released=true; mismatch=true; written=[]
 await expect(downloadOfflinePack('ENGINE_OIC_EW',false,undefined,{background:true})).rejects.toThrow(/release changed/i)
 expect(written).toHaveLength(0)
})

test('all-question ranges use fresh release counts instead of truncating to an old cached count',async()=>{
 released=true; mismatch=false
 expect(await getQuestionsByCompetence('ENGINE_OIC_EW','C1')).toHaveLength(2)
})
