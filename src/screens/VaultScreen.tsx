import { useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useVaultStore } from '../stores/vaultStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useLicenseStore } from '../stores/licenseStore'
import type { TrackId } from '../types/question'
import type { VaultItem } from '../stores/vaultStore'

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW', GMDSS_GOC: 'GMDSS', ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Mgt', ENGINE_MGT: 'Engine Mgt'
}
const TRACK_KEYS: Record<TrackId, string> = {
  DECK_OIC_NW: 'oic_nw', GMDSS_GOC: 'gmdss', ENGINE_OIC_EW: 'engine_ew',
  DECK_MGT: 'deck_mgt', ENGINE_MGT: 'engine_mgt'
}
const sortCompetence = (a: string, b: string) =>
  (Number(a.replace(/^C/i, '')) || Number.MAX_SAFE_INTEGER) - (Number(b.replace(/^C/i, '')) || Number.MAX_SAFE_INTEGER) || a.localeCompare(b)

export default function VaultScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedTrack = searchParams.get('track') as TrackId | null
  const items = useVaultStore((s) => s.items)
  const remove = useVaultStore((s) => s.remove)
  const clear = useVaultStore((s) => s.clear)
  const asQuestions = useVaultStore((s) => s.asQuestions)
  const entitlementsVerified = useLicenseStore((s) => s.entitlementsVerified)
  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked)
  const isTrackUnlocked = useLicenseStore((s) => s.isTrackUnlocked)
  const cloudTrackIds = useLicenseStore((s) => s.cloudTrackIds)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTracks, setExpandedTracks] = useState<string[]>([])
  const [expandedCompetencies, setExpandedCompetencies] = useState<string[]>([])
  const [expandedQuestions, setExpandedQuestions] = useState<string[]>([])

  const hasAnyActiveLicense = entitlementsVerified && (isAllAccessUnlocked || cloudTrackIds.includes('ALL') ||
    ['DECK_OIC_NW','GMDSS_GOC','ENGINE_OIC_EW','DECK_MGT','ENGINE_MGT'].some(isTrackUnlocked))
  const visibleItems = entitlementsVerified
    ? items.filter(item => isAllAccessUnlocked || cloudTrackIds.includes('ALL') || isTrackUnlocked(item.track))
    : []
  const scopedItems = requestedTrack && Object.prototype.hasOwnProperty.call(TRACK_LABELS,requestedTrack)
    ? visibleItems.filter(item => item.track === requestedTrack) : visibleItems
  const query = searchQuery.trim().toLocaleLowerCase()
  const filteredItems = useMemo(() => scopedItems.filter(item => !query || [
    item.questionText,item.id,item.functionId,item.competenceId,item.track,item.topic,item.explanation,
    ...item.options
  ].some(value => value.toLocaleLowerCase().includes(query))), [scopedItems,query])
  const groups = useMemo(() => {
    const tracks = new Map<TrackId,Map<string,VaultItem[]>>()
    for (const item of filteredItems) {
      if (!tracks.has(item.track)) tracks.set(item.track,new Map())
      const comps=tracks.get(item.track)!
      const key=item.competenceId?.trim()||'GENERAL'
      if(!comps.has(key)) comps.set(key,[])
      comps.get(key)!.push(item)
    }
    return [...tracks.entries()].map(([track,comps])=>[track,[...comps.entries()].sort((a,b)=>sortCompetence(a[0],b[0]))] as const)
  },[filteredItems])

  const practiceVault = async (track:TrackId,selected:VaultItem[],competenceId:string|null=null) => {
    const ids=new Set(selected.map(item=>item.id))
    const questions=asQuestions().filter(q=>q.track===track&&ids.has(q.id))
    if(!questions.length) return
    setSaveError(null)
    const started=await usePracticeStore.getState().startCustomSession({questions,track,competenceId})
    if(!started) return
    usePracticeStore.setState({mode:'DRILL',startedAt:Date.now(),finished:false,loading:false,error:null})
    const saved = await usePracticeStore.getState().saveProgress()
    if(!saved){setSaveError('Could not save this drill on the device. Check storage and try again before starting it.');return}
    navigate('/practice/quiz')
  }
  const toggle=(list:string[],setList:(v:string[])=>void,key:string)=>setList(list.includes(key)?list.filter(v=>v!==key):[...list,key])

  return <div className="screen">
    <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:12,flexWrap:'wrap'}}>
      <h1 className="page-title">Mistakes Notebook</h1>
      <button type="button" className="btn btn-outline" onClick={()=>navigate(requestedTrack?'/track?track='+encodeURIComponent(({DECK_OIC_NW:'oic_nw',GMDSS_GOC:'gmdss',ENGINE_OIC_EW:'engine_ew',DECK_MGT:'deck_mgt',ENGINE_MGT:'engine_mgt'} as Record<TrackId,string>)[requestedTrack]||'oic_nw'):'/')}>Back</button>
    </div>
    <p className="subtitle">{scopedItems.length} mistakes to redeem · grouped by track and competence</p>
    {saveError&&<p role="alert" style={{color:'var(--danger)'}}>{saveError}</p>}
    {!entitlementsVerified ? <div className="card" role="status">Verifying your active license…</div> :
      (!hasAnyActiveLicense||(requestedTrack&&Object.prototype.hasOwnProperty.call(TRACK_LABELS,requestedTrack)&&!(isAllAccessUnlocked||cloudTrackIds.includes('ALL')||isTrackUnlocked(requestedTrack)))) ?
      <div className="card" style={{textAlign:'center'}}>
        <h2 style={{marginTop:0}}>Mistakes Notebook is locked</h2>
        <p style={{color:'var(--text-muted)'}}>An active license is required. Your notebook shows mistakes only for tracks with an active license.</p>
        <button className="btn btn-primary" onClick={()=>requestedTrack && TRACK_KEYS[requestedTrack]
          ? navigate(`/track?track=${TRACK_KEYS[requestedTrack]}`)
          : navigate('/account')}>VIEW LICENSE OPTIONS</button>
      </div> :
      scopedItems.length===0 ? <div className="card" style={{textAlign:'center',color:'var(--text-muted)'}}>No saved mistakes for this licensed track yet. Mistakes are recorded automatically after incorrect answers.</div> :
      <>
        <div className="card" style={{marginBottom:'1rem'}}>
          <strong>Redemption queue ({scopedItems.length} questions)</strong>
          <p style={{color:'var(--text-muted)',margin:'.35rem 0 .8rem'}}>A mistake is automatically redeemed and removed after 2 consecutive correct answers. Wrong answers reset its progress.</p>
          {groups.map(([track,comps])=><button key={track} className="btn btn-outline" style={{width:'100%',marginTop:'.35rem'}} onClick={()=>void practiceVault(track,comps.flatMap(([,list])=>list))}>Drill all {TRACK_LABELS[track]} mistakes ({comps.reduce((n,[,list])=>n+list.length,0)})</button>)}
        </div>
        <label style={{display:'block',marginBottom:'.8rem'}}>
          <span className="sr-only">Search mistakes</span>
          <input value={searchQuery} onChange={e=>setSearchQuery(e.target.value)} placeholder="Search mistakes by question, item code, function, competence, option…" style={{width:'100%'}}/>
        </label>
        <h2 className="section-title">{query? `Search results (${filteredItems.length})`:'Mistakes by track & competence'}</h2>
        {filteredItems.length===0?<div className="card" style={{textAlign:'center',color:'var(--text-muted)'}}>No matching mistakes found.</div>:
          <div style={{display:'grid',gap:'.65rem'}}>
            {groups.map(([track,comps])=>{
              const trackOpen=query.length>0||expandedTracks.includes(track)
              const total=comps.reduce((n,[,list])=>n+list.length,0)
              return <section key={track} className="card" style={{padding:'.8rem'}}>
                <div style={{display:'flex',alignItems:'center',gap:'.5rem',flexWrap:'wrap'}}>
                  <button className="btn btn-outline" style={{flex:1,textAlign:'left'}} aria-expanded={trackOpen} onClick={()=>toggle(expandedTracks,setExpandedTracks,track)}>
                    {trackOpen?'▾':'▸'} <strong>{TRACK_LABELS[track]}</strong> · {total} mistake{total===1?'':'s'}
                  </button>
                  <button className="btn btn-primary" onClick={()=>void practiceVault(track,comps.flatMap(([,list])=>list))}>Practice track</button>
                </div>
                {trackOpen&&<div style={{display:'grid',gap:'.5rem',marginTop:'.6rem',paddingLeft:'.5rem'}}>
                  {comps.map(([competence,list])=>{
                    const key=track+':'+competence
                    const open=query.length>0||expandedCompetencies.includes(key)
                    return <div key={key} style={{borderLeft:'2px solid var(--border)',paddingLeft:'.65rem'}}>
                      <div style={{display:'flex',alignItems:'center',gap:'.4rem',flexWrap:'wrap'}}>
                        <button className="btn btn-outline" style={{flex:1,textAlign:'left'}} aria-expanded={open} onClick={()=>toggle(expandedCompetencies,setExpandedCompetencies,key)}>
                          {open?'▾':'▸'} {competence.startsWith('C')?competence:'C'+competence} · {list.length} to redeem
                        </button>
                        <button className="btn btn-outline" onClick={()=>void practiceVault(track,list,competence==='GENERAL'?null:competence)}>Drill</button>
                      </div>
                      {open&&<div style={{display:'grid',gap:'.5rem',marginTop:'.5rem'}}>
                        {[...list].sort((a,b)=>b.wrongCount-a.wrongCount||b.lastWrongAt-a.lastWrongAt).map(item=>{
                          const expanded=expandedQuestions.includes(item.id)
                          return <article key={item.id} className="card" style={{padding:'.75rem'}}>
                            <div style={{display:'flex',justifyContent:'space-between',gap:'.5rem',alignItems:'center'}}>
                              <span className="caption">{item.functionId||TRACK_LABELS[track]} · {competence} · ITEM {item.id} · MISSED {item.wrongCount}×</span>
                              <button className="btn btn-outline" onClick={()=>remove(item.id)}>Remove</button>
                            </div>
                            <div style={{display:'flex',alignItems:'center',justifyContent:'space-between',gap:'.5rem',marginTop:'.4rem'}}>
                              <span className="caption">Redemption progress</span>
                              <strong className="caption">{Math.min(item.consecutiveCorrect,2)}/2 CORRECT</strong>
                            </div>
                            <div role="progressbar" aria-label={`Redemption progress for item ${item.id}`} aria-valuemin={0} aria-valuemax={2} aria-valuenow={Math.min(item.consecutiveCorrect,2)} style={{height:'.35rem',borderRadius:'999px',overflow:'hidden',background:'var(--border)',marginTop:'.25rem'}}>
                              <div style={{height:'100%',width:`${Math.min(item.consecutiveCorrect,2)/2*100}%`,background:'var(--success)',transition:'width .2s ease'}} />
                            </div>
                            <button className="btn btn-outline" style={{width:'100%',textAlign:'left',marginTop:'.45rem'}} aria-expanded={expanded} onClick={()=>toggle(expandedQuestions,setExpandedQuestions,item.id)}>{expanded?'Hide details':'View question'} · {item.questionText}</button>
                            {expanded&&<div style={{marginTop:'.6rem',lineHeight:1.5}}>
                              <div>{item.questionText}</div>
                              <ol type="A" style={{paddingLeft:'1.4rem'}}>{item.options.map((option,i)=><li key={i} style={{color:i===item.correctAnswerIndex?'var(--success)':'var(--text)'}}>{option}{i===item.correctAnswerIndex?' ✓':''}</li>)}</ol>
                              {item.lastSelectedIndex!=null&&item.lastSelectedIndex!==item.correctAnswerIndex&&<p style={{color:'var(--danger)'}}>Previously selected: {String.fromCharCode(65+item.lastSelectedIndex)}. {item.options[item.lastSelectedIndex]}</p>}
                              {item.explanation&&<p style={{color:'var(--text-muted)'}}>Explanation: {item.explanation}</p>}
                            </div>}
                          </article>
                        })}
                      </div>}
                    </div>
                  })}
                </div>}
              </section>
            })}
          </div>}
      </>}
    {hasAnyActiveLicense&&scopedItems.length>0&&<button className="btn btn-outline" style={{width:'100%',marginTop:'1rem',color:'var(--danger)'}} onClick={()=>{if(confirm('Clear the mistakes notebook? This cannot be undone.'))clear()}}>Clear all mistakes</button>}
  </div>
}
