import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getQuestionCountsByTrack, listAvailableCompetences } from '../lib/questionBank'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}
const LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

export default function PracticeCompetenceScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const key = params.get('track') || 'oic_nw'
  const track = TRACK_MAP[key] || 'DECK_OIC_NW'
  const freeMode = params.get('free') === '1'
  const unlocked = useLicenseStore(s => s.isTrackUnlocked(track) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore(s => s.openPaywall)
  const competences = listAvailableCompetences(track)
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [totalCount, setTotalCount] = useState<number | null>(null)
  const [countError, setCountError] = useState('')

  useEffect(() => {
    let cancelled = false
    async function loadCounts() {
      const restrictedToFreePool = freeMode || !unlocked
      setCountError('')
      setTotalCount(null)
      try {
        const items = await getQuestionCountsByTrack(track, restrictedToFreePool)
        const next: Record<string, number> = {}
        for (const competence of competences) {
          next[competence.id] = items.filter(item => item.competenceId === competence.id).reduce((sum, item) => sum + item.count, 0)
        }
        if (!cancelled) {
          setCounts(next)
          setTotalCount(items.reduce((sum, item) => sum + item.count, 0))
        }
      } catch {
        if (!cancelled) {
          setCounts({})
          setTotalCount(null)
          setCountError('Protected question storage is not ready yet. Please refresh later or contact the administrator.')
        }
      }
    }
    void loadCounts()
    return () => { cancelled = true }
  }, [track, freeMode, unlocked])

  const chooseCompetence = (id: string) => {
    if (!freeMode && !unlocked) {
      openPaywall('Practice')
      return
    }
    navigate(`/practice?track=${key}&competence=${encodeURIComponent(id)}${freeMode ? '&free=1' : ''}`)
  }

  return <div className="screen practice-competence-screen" style={{ padding: '0 0 2rem', color: 'var(--text)' }}>
    <button type="button" onClick={() => navigate(`/track?track=${key}`)} style={{ color: 'var(--text-muted)', margin: '0 0 1.2rem', padding: '0.5rem 0' }}>← Back to Track</button>
    <div className="card" style={{ borderRadius: 0, border: '1px solid #087f63', borderTop: '3px solid #00e5a0', background: 'linear-gradient(120deg, #172b31, #17252d)', padding: '1.2rem', marginBottom: '3rem' }}>
      <h1 style={{ fontSize: '1.35rem', lineHeight: 1.25, margin: '0 0 .4rem', fontWeight: 900 }}>{freeMode ? (track === 'DECK_OIC_NW' ? 'MARINA CRP PRACTICE' : `${LABELS[track].toUpperCase()} FREE PRACTICE`) : 'PRACTICE ALL QUESTIONS'}</h1>
      <p style={{ color: '#9af1d1', fontWeight: 700, lineHeight: 1.45, margin: 0 }}>
        {countError
          ? 'Verified question counts are currently unavailable.'
          : totalCount === null
            ? 'Loading verified question counts…'
            : `${totalCount.toLocaleString()} valid questions across ${competences.length} competencies.`}
      </p>
    </div>
    <h2 style={{ fontSize: '.95rem', letterSpacing: '.13em', fontWeight: 900, borderTop: '3px solid #334155', paddingTop: '1rem', margin: '0 0 1.5rem' }}>COMPETENCE DIRECTORY ({competences.length})</h2>
    {countError && <p role="status" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{countError}</p>}
    {!freeMode && !unlocked && <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
      Practice All Questions requires an activated license.
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => openPaywall('Practice')}>Activate Key</button>
    </div>}
    <div style={{ display: 'grid', gap: '1rem' }}>
      {competences.map(c => <button key={c.id} type="button" className="card" onClick={() => chooseCompetence(c.id)} style={{ display: 'grid', gridTemplateColumns: '3rem minmax(0,1fr) 1.25rem', alignItems: 'center', gap: '.8rem', textAlign: 'left', width: '100%', borderRadius: 0, border: '1px solid #334155', background: '#1e293b', padding: '1.1rem', minHeight: 90 }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#334155', color: '#22c55e', fontWeight: 900, minHeight: 38, padding: '0 .4rem' }}>{c.id}</span>
        <span style={{ minWidth: 0 }}>
          <strong style={{ display: 'block', fontSize: '1rem', lineHeight: 1.45, fontWeight: 900, textTransform: 'uppercase' }}>{c.label.replace(/^C\d+ · /, '')}</strong>
          <span style={{ display: 'block', color: '#94a3b8', fontSize: '.83rem', fontWeight: 700, marginTop: '.2rem' }}>{freeMode ? (track === 'DECK_OIC_NW' ? (c.id === 'C1' || c.id === 'C2' || c.id === 'C3' || c.id === 'C4' || c.id === 'C5' || c.id === 'C7' || c.id === 'C9' ? 'F1' : c.id === 'C10' || c.id === 'C11' ? 'F2' : 'F3') + ' · ' : '') : ''}{counts[c.id] ?? '…'} official review questions</span>
        </span>
        <span style={{ color: '#94a3b8', fontSize: '1.4rem' }}>→</span>
      </button>)}
    </div>
  </div>
}
