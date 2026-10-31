import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { authorizeQuestionSet } from '../lib/questionBank'
import type { BookmarkedQuestion } from '../stores/bookmarksStore'
import type { TrackId } from '../types/question'

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

export default function BookmarksScreen() {
  const navigate = useNavigate()
  const items = useBookmarksStore((s) => s.items)
  const remove = useBookmarksStore((s) => s.remove)
  const clear = useBookmarksStore((s) => s.clear)
  const asQuestions = useBookmarksStore((s) => s.asQuestions)
  const startCustomSession = usePracticeStore((s) => s.startCustomSession)
  const isTrackUnlocked = useLicenseStore((s) => s.isTrackUnlocked)
  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked)
  const entitlementsVerified = useLicenseStore((s) => s.entitlementsVerified)
  const cloudTrackIds = useLicenseStore((s) => s.cloudTrackIds)
  const [verifiedFreeItems, setVerifiedFreeItems] = useState<string[]>([])
  const [validatingBookmarks, setValidatingBookmarks] = useState(true)
  const [searchQuery, setSearchQuery] = useState('')
  const [expandedTracks, setExpandedTracks] = useState<string[]>([])
  const [expandedCompetencies, setExpandedCompetencies] = useState<string[]>([])
  const [expandedQuestions, setExpandedQuestions] = useState<string[]>([])
  const openPaywall = useUIStore((s) => s.openPaywall)

  useEffect(() => {
    let cancelled = false
    async function validateBookmarks() {
      setValidatingBookmarks(true)
      if (!entitlementsVerified) {
        if (!cancelled) { setVerifiedFreeItems([]); setValidatingBookmarks(false) }
        return
      }
      const valid = new Set<string>()
      const questions = asQuestions()
      const tracks = [...new Set(items.map(item => item.track))]
      for (const track of tracks) {
        if (isAllAccessUnlocked || cloudTrackIds.includes('ALL') || isTrackUnlocked(track)) continue
        const candidates = items.filter(item => item.track === track && item.paidAtSave === false)
        if (!candidates.length) continue
        const ids = new Set(candidates.map(item => item.id))
        const candidateQuestions = questions.filter(question => question.track === track && ids.has(question.id))
        try {
          if (candidateQuestions.length === candidates.length && await authorizeQuestionSet(track, candidateQuestions)) candidates.forEach(item => valid.add(item.id))
        } catch { /* Fail closed when the protected question service cannot verify saved text. */ }
      }
      if (!cancelled) { setVerifiedFreeItems([...valid]); setValidatingBookmarks(false) }
    }
    void validateBookmarks()
    return () => { cancelled = true }
  }, [items, entitlementsVerified, cloudTrackIds, isAllAccessUnlocked, isTrackUnlocked, asQuestions])

  const visibleItems = entitlementsVerified
    ? items.filter(item => verifiedFreeItems.includes(item.id) || isAllAccessUnlocked || cloudTrackIds.includes('ALL') || isTrackUnlocked(item.track))
    : []
  const query = searchQuery.trim().toLocaleLowerCase()
  const filteredItems = useMemo(() => visibleItems.filter(q => !query || [
    q.questionText, q.id, q.functionId, q.competenceId, q.track, q.topic, q.explanation, ...q.options
  ].some(value => value.toLocaleLowerCase().includes(query))), [visibleItems, query])
  const groups = useMemo(() => {
    const tracks = new Map<TrackId, Map<string, BookmarkedQuestion[]>>()
    for (const item of filteredItems) {
      if (!tracks.has(item.track)) tracks.set(item.track, new Map())
      const comps = tracks.get(item.track)!
      const key = item.competenceId?.trim() || 'GENERAL'
      if (!comps.has(key)) comps.set(key, [])
      comps.get(key)!.push(item)
    }
    return [...tracks.entries()].map(([track, comps]) => [track, [...comps.entries()].sort((a,b) => sortCompetence(a[0],b[0]))] as const)
  }, [filteredItems])

  const practice = async (track: TrackId, selected: BookmarkedQuestion[], competenceId: string | null = null) => {
    const ids = new Set(selected.map(item => item.id))
    const questions = asQuestions().filter(q => q.track === track && ids.has(q.id))
    if (!questions.length) return
    const started = await startCustomSession({ questions, track, competenceId })
    if (started) navigate('/practice/quiz')
    else {
      navigate(`/track?track=${TRACK_KEYS[track]}`)
      openPaywall('These saved questions could not be authorized. Renew access or remove unavailable bookmarks.')
    }
  }
  const toggle = (list: string[], setList: (v: string[]) => void, key: string) =>
    setList(list.includes(key) ? list.filter(v => v !== key) : [...list, key])

  return <div className="screen">
    <h1 className="page-title">Bookmarked Questions</h1>
    <p className="subtitle">{visibleItems.length} saved items · grouped by track and competence</p>
    <div className="card" style={{ marginBottom: '1rem' }}>
      <strong>Saved question collection</strong>
      <p style={{ color: 'var(--text-muted)', margin: '.35rem 0 .8rem' }}>Practice your complete bookmark collection, or focus on a specific track or competence.</p>
      {groups.map(([track, comps]) => {
        const all = comps.flatMap(([,list]) => list)
        return <button key={track} className="btn btn-outline" style={{ width:'100%', marginTop:'.35rem' }} onClick={() => void practice(track, all)}>
          Practice all {TRACK_LABELS[track]} bookmarks ({all.length})
        </button>
      })}
    </div>
    <label style={{ display:'block', marginBottom:'.8rem' }}>
      <span className="sr-only">Search bookmarks</span>
      <input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="Search bookmarks by question, item code, function, competence, option…" style={{ width:'100%' }} />
    </label>
    <h2 className="section-title">{query ? `Search results (${filteredItems.length})` : 'Bookmarks by track & competence'}</h2>
    {validatingBookmarks ? <div className="card" role="status">Verifying saved question access…</div> :
      visibleItems.length === 0 ? <div className="card" style={{textAlign:'center',color:'var(--text-muted)'}}>No available bookmarks. Bookmarks from paid question banks require an active license; free-sample bookmarks are verified before display.</div> :
      filteredItems.length === 0 ? <div className="card" style={{textAlign:'center',color:'var(--text-muted)'}}>No matching bookmarks found.</div> :
      <div style={{display:'grid',gap:'.65rem'}}>
        {groups.map(([track, comps]) => {
          const trackKey = track
          const trackOpen = query.length > 0 || expandedTracks.includes(trackKey)
          const total = comps.reduce((n,[,list]) => n + list.length,0)
          return <section key={track} className="card" style={{padding:'.8rem'}}>
            <div style={{display:'flex',alignItems:'center',gap:'.5rem',flexWrap:'wrap'}}>
              <button className="btn btn-outline" style={{flex:1,textAlign:'left'}} aria-expanded={trackOpen} onClick={() => toggle(expandedTracks,setExpandedTracks,trackKey)}>
                {trackOpen ? '▾' : '▸'} <strong>{TRACK_LABELS[track]}</strong> · {total} bookmark{total===1?'':'s'}
              </button>
              <button className="btn btn-primary" onClick={() => void practice(track,comps.flatMap(([,list])=>list))}>Practice track</button>
            </div>
            {trackOpen && <div style={{display:'grid',gap:'.5rem',marginTop:'.6rem',paddingLeft:'.5rem'}}>
              {comps.map(([competence,list]) => {
                const key = track + ':' + competence
                const open = query.length > 0 || expandedCompetencies.includes(key)
                return <div key={key} style={{borderLeft:'2px solid var(--border)',paddingLeft:'.65rem'}}>
                  <div style={{display:'flex',gap:'.4rem',alignItems:'center',flexWrap:'wrap'}}>
                    <button className="btn btn-outline" style={{flex:1,textAlign:'left'}} aria-expanded={open} onClick={() => toggle(expandedCompetencies,setExpandedCompetencies,key)}>
                      {open?'▾':'▸'} {competence.startsWith('C')?competence:'C'+competence} · {list.length} saved
                    </button>
                    <button className="btn btn-outline" onClick={() => void practice(track,list,competence==='GENERAL'?null:competence)}>Practice</button>
                  </div>
                  {open && <div style={{display:'grid',gap:'.5rem',marginTop:'.5rem'}}>
                    {list.map(item => {
                      const expanded = expandedQuestions.includes(item.id)
                      return <article key={item.id} className="card" style={{padding:'.75rem'}}>
                        <div style={{display:'flex',justifyContent:'space-between',gap:'.5rem',alignItems:'center'}}>
                          <span className="caption">{item.functionId || TRACK_LABELS[track]} · {competence} · ITEM {item.id}</span>
                          <button className="btn btn-outline" onClick={() => remove(item.id)}>Remove</button>
                        </div>
                        <button className="btn btn-outline" style={{width:'100%',textAlign:'left',marginTop:'.45rem'}} aria-expanded={expanded} onClick={() => toggle(expandedQuestions,setExpandedQuestions,item.id)}>
                          {expanded?'Hide details':'View question'} · {item.questionText}
                        </button>
                        {expanded && <div style={{marginTop:'.6rem',lineHeight:1.5}}>
                          <div>{item.questionText}</div>
                          <ol type="A" style={{paddingLeft:'1.4rem'}}>{item.options.map((option,i)=><li key={i} style={{color:i===item.correctAnswerIndex?'var(--success)':'var(--text)'}}>{option}{i===item.correctAnswerIndex?' ✓':''}</li>)}</ol>
                          {item.explanation && <p style={{color:'var(--text-muted)'}}>Explanation: {item.explanation}</p>}
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
    {items.length>0 && <button className="btn btn-outline" style={{width:'100%',marginTop:'1rem',color:'var(--danger)'}} onClick={() => {if(confirm('Clear all bookmarks? This cannot be undone.')) clear()}}>Clear all bookmarks</button>}
  </div>
}
