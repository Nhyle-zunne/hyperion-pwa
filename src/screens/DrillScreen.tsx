import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
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
  const competences = listAvailableCompetences(trackId)

  const configure = (competenceId?: string) => {
    if (!isUnlocked) {
      openPaywall('Drill')
      return
    }
    const competence = competenceId ? `&competence=${encodeURIComponent(competenceId)}` : ''
    navigate(`/practice?track=${trackParam}&mode=drill${competence}`)
  }

  return (
    <div className="screen" style={{ paddingBottom: '2rem' }}>
      <button
        type="button"
        onClick={() => navigate(`/track?track=${trackParam}`)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back to Track
      </button>

      <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.12em', fontWeight: 800 }}>STEP 1 OF 2 · DRILL SETUP</div>
        <h1 className="page-title" style={{ marginTop: 8, marginBottom: 4 }}>Drill</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>{TRACK_LABELS[trackId]} · rapid-fire practice · streak tracking · forward-only</p>
      </div>

      {!isUnlocked && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Activate a key to unlock Drill mode and its configuration settings.
          <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => openPaywall('Drill')}>Activate Key</button>
        </div>
      )}

      <section style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.6rem' }}>CHOOSE YOUR QUESTION POOL</h2>
        <button type="button" className="card" style={{ textAlign: 'left', width: '100%', borderRadius: 2, marginBottom: 8 }} onClick={() => configure()}>
          <div style={{ fontWeight: 800 }}>MIXED DRILL</div>
          <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 4 }}>Choose question range, randomization, and answer-choice settings on the next page.</div>
        </button>
      </section>

      <section>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.6rem' }}>FOCUS ON A COMPETENCE</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)' }}>Select a competence to preselect it in the configuration page.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          {competences.map((c) => (
            <button key={c.id} type="button" className="card" style={{ textAlign: 'left', width: '100%', borderRadius: 2 }} onClick={() => configure(c.id)}>
              <div style={{ fontWeight: 800 }}>{c.label}</div>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 3 }}>Configure session →</div>
            </button>
          ))}
        </div>
      </section>

      <div style={{ marginTop: '1.25rem' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>TRACK</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {Object.entries(TRACK_MAP).map(([key, id]) => (
            <button
              key={key}
              className="btn btn-outline"
              style={{ padding: '0.4rem 0.7rem', fontSize: '0.8rem', borderColor: trackId === id ? 'var(--accent)' : undefined, color: trackId === id ? 'var(--accent)' : undefined }}
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
