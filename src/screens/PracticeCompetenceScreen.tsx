import CompetenceDirectory from '../components/CompetenceDirectory'
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
    <CompetenceDirectory
      title={freeMode ? (track === 'DECK_OIC_NW' ? 'MARINA CRP PRACTICE' : `${LABELS[track].toUpperCase()} FREE PRACTICE`) : 'PRACTICE ALL QUESTIONS'}
      totalCount={totalCount} countError={countError}
      onBack={() => navigate(`/track?track=${key}`)} onSelect={chooseCompetence}
      items={competences.map(c => ({ ...c, count: counts[c.id], countPrefix: freeMode && track === 'DECK_OIC_NW' ? (['C1', 'C2', 'C3', 'C4', 'C5', 'C7', 'C9'].includes(c.id) ? 'F1' : ['C10', 'C11'].includes(c.id) ? 'F2' : 'F3') + ' · ' : '' }))}
    >
    {!freeMode && !unlocked && <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
      Practice All Questions requires an activated license.
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => openPaywall('Practice')}>Activate Key</button>
    </div>}
    </CompetenceDirectory>
  </div>
}
