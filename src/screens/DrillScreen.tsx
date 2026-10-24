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

export default function DrillScreen() {
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
      openPaywall('Drill')
      return
    }
    await startSession({
      mode: 'DRILL',
      track: trackId,
      competenceId,
      limit: 12
    })
    navigate('/practice/quiz')
  }

  return (
    <div className="screen">
      <button
        onClick={() => navigate('/')}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Home
      </button>

      <h1 className="page-title">Drill</h1>
      <p className="subtitle">
        Rapid-fire practice · {TRACK_LABELS[trackId]} · forward-only · streak tracking
      </p>

      {!isUnlocked && (
        <div
          className="card"
          style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          Activate a key to unlock drills.
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <button className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => start()}>
          <div style={{ fontWeight: 600 }}>Mixed Drill (12 questions)</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Random mix · instant feedback · no going back
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
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Track</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {Object.entries(TRACK_MAP).map(([key, id]) => (
            <button
              key={key}
              className="btn btn-outline"
              style={{
                padding: '0.4rem 0.7rem',
                fontSize: '0.8rem',
                borderColor: trackId === id ? 'var(--accent)' : undefined,
                color: trackId === id ? 'var(--accent)' : undefined
              }}
              onClick={() => navigate(`/drill?track=${key}`)}
            >
              {TRACK_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
