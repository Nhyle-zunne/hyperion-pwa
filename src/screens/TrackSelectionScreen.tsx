import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'

const TRACKS = [
  {
    id: 'oic_nw',
    title: 'OIC-NW Deck',
    subtitle: 'Operational Level · STCW II/1',
    tierCheck: 'OIC'
  },
  {
    id: 'gmdss',
    title: 'GMDSS GOC',
    subtitle: 'Radio Operator · STCW IV/2',
    tierCheck: 'GOC'
  },
  {
    id: 'engine_ew',
    title: 'OIC-EW Engine',
    subtitle: 'Operational Level · STCW III/1',
    tierCheck: 'EW'
  },
  {
    id: 'deck_mgt',
    title: 'Deck Management',
    subtitle: 'Management Level · STCW II/2',
    tierCheck: 'DM'
  },
  {
    id: 'engine_mgt',
    title: 'Engine Management',
    subtitle: 'Management Level · STCW III/2',
    tierCheck: 'EM'
  }
]

export default function TrackSelectionScreen() {
  const navigate = useNavigate()
  const { isAllAccessUnlocked, isTrackUnlocked } = useLicenseStore()
  const openPaywall = useUIStore((s) => s.openPaywall)

  const select = (track: (typeof TRACKS)[0]) => {
    const unlocked = isAllAccessUnlocked || isTrackUnlocked(track.tierCheck)
    if (!unlocked) {
      openPaywall(track.title)
      return
    }
    // For now navigate to practice placeholder with track id
    navigate(`/practice?track=${track.id}`)
  }

  return (
    <div className="screen">
      <h1 className="page-title">Select Track</h1>
      <p className="subtitle">Choose the competence track you want to study</p>

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        {TRACKS.map((t) => {
          const unlocked = isAllAccessUnlocked || isTrackUnlocked(t.tierCheck)
          return (
            <button
              key={t.id}
              className="card"
              onClick={() => select(t)}
              style={{
                textAlign: 'left',
                width: '100%',
                opacity: unlocked ? 1 : 0.75,
                cursor: 'pointer'
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{t.title}</div>
                  <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{t.subtitle}</div>
                </div>
                <span
                  style={{
                    fontSize: '0.75rem',
                    padding: '0.25rem 0.5rem',
                    borderRadius: 6,
                    background: unlocked ? 'rgba(34,197,94,0.15)' : 'rgba(148,163,184,0.15)',
                    color: unlocked ? 'var(--success)' : 'var(--text-muted)'
                  }}
                >
                  {unlocked ? 'Unlocked' : 'Locked'}
                </span>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
