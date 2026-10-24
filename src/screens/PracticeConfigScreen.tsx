import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { usePracticeStore } from '../stores/practiceStore'
import { listAvailableCompetences } from '../lib/questionBank'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

export default function PracticeConfigScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'

  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const startSession = usePracticeStore((s) => s.startSession)

  const competences = listAvailableCompetences(trackId)

  const start = async (competenceId?: string) => {
    if (!isUnlocked) {
      openPaywall(TRACK_LABELS[trackId])
      return
    }
    await startSession({
      mode: 'PRACTICE',
      track: trackId,
      competenceId,
      limit: 15
    })
    navigate('/practice/quiz')
  }

  return (
    <div className="screen">
      <button
        onClick={() => navigate('/tracks')}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Tracks
      </button>

      <h1 className="page-title">Practice</h1>
      <p className="subtitle">{TRACK_LABELS[trackId]} · instant feedback</p>

      {!isUnlocked && (
        <div
          className="card"
          style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          This track is locked. Activate a key to unlock full practice.
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <button className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => start()}>
          <div style={{ fontWeight: 600 }}>Mixed Practice (15 questions)</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Random questions from available banks for this track
          </div>
        </button>

        {competences.map((c) => (
          <button
            key={c.id}
            className="card"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => start(c.id)}
          >
            <div style={{ fontWeight: 600 }}>Competence {c.id}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{c.label}</div>
          </button>
        ))}

        {competences.length === 0 && (
          <div className="card" style={{ color: 'var(--text-muted)' }}>
            More competence banks will be added soon. Sample Deck C1–C4 are available.
          </div>
        )}
      </div>
    </div>
  )
}
