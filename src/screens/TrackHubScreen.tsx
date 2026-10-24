import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import type { TrackId } from '../types/question'

interface TrackInfo {
  trackId: TrackId
  title: string
  level: string
  freeTitle: string
  freeDesc: string
}

const TRACKS: Record<string, TrackInfo> = {
  oic_nw: {
    trackId: 'DECK_OIC_NW',
    title: 'DECK OIC-NW',
    level: 'DECK OIC-NW OPERATIONAL LEVEL',
    freeTitle: 'OIC-NW FREE REVIEWER',
    freeDesc: '2,065 free questions across 12 competencies.'
  },
  gmdss: {
    trackId: 'GMDSS_GOC',
    title: 'GMDSS RADIO (GOC)',
    level: 'GMDSS GOC LEVEL',
    freeTitle: 'GMDSS FREE REVIEWER',
    freeDesc: '1,150 free questions (C1: 1,000 · C2: 150).'
  },
  engine_ew: {
    trackId: 'ENGINE_OIC_EW',
    title: 'ENGINE OIC-EW',
    level: 'ENGINE OIC-EW OPERATIONAL LEVEL',
    freeTitle: 'ENGINE OIC-EW FREE REVIEWER',
    freeDesc: 'Free sample: 40% of every competence.'
  },
  engine_mgt: {
    trackId: 'ENGINE_MGT',
    title: 'ENGINE MANAGEMENT',
    level: 'ENGINE MANAGEMENT LEVEL',
    freeTitle: 'ENGINE MGT FREE REVIEWER',
    freeDesc: 'Free sample: 40% of every competence.'
  },
  deck_mgt: {
    trackId: 'DECK_MGT',
    title: 'DECK MANAGEMENT',
    level: 'DECK MANAGEMENT LEVEL',
    freeTitle: 'DECK MGT FREE REVIEWER',
    freeDesc: 'Free sample: 40% of every competence.'
  }
}

interface Mode {
  title: string
  desc: string
  badge: string
  locked: boolean
  onClick: () => void
}

export default function TrackHubScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const key = params.get('track') && TRACKS[params.get('track')!] ? params.get('track')! : 'oic_nw'
  const info = TRACKS[key]

  const unlocked = useLicenseStore((s) => s.isTrackUnlocked(info.trackId) || s.isAllAccessUnlocked)
  const remaining = useLicenseStore((s) => s.getRemainingLabel)
  const openPaywall = useUIStore((s) => s.openPaywall)

  const gated = (feature: string, path: string) => () => {
    if (!unlocked) {
      openPaywall(`${info.title} · ${feature}`)
      return
    }
    navigate(path)
  }

  const modes: Mode[] = [
    {
      title: info.freeTitle,
      desc: info.freeDesc,
      badge: 'FREE ACCESS',
      locked: false,
      onClick: () => navigate(`/practice?track=${key}&free=1`)
    },
    {
      title: 'PRACTICE ALL QUESTIONS',
      desc: 'Full question bank, by competence or mixed.',
      badge: unlocked ? 'CUSTOMIZABLE' : 'LOCKED',
      locked: !unlocked,
      onClick: gated('Practice', `/practice?track=${key}`)
    },
    {
      title: 'DRILL',
      desc: 'Rapid-fire · streak tracking · forward-only.',
      badge: unlocked ? 'RAPID FIRE' : 'LOCKED',
      locked: !unlocked,
      onClick: gated('Drill', `/drill?track=${key}`)
    },
    {
      title: 'TIMED MOCK EXAM',
      desc: '70% cutoff · timed · MARINA format.',
      badge: unlocked ? 'STCW MOCK' : 'LOCKED',
      locked: !unlocked,
      onClick: gated('Mock Exam', `/mock?track=${key}`)
    },
    {
      title: 'FLASHCARD REVISION',
      desc: 'Active recall · tap to flip cards.',
      badge: unlocked ? 'ACTIVE RECALL' : 'LOCKED',
      locked: !unlocked,
      onClick: gated('Flashcards', `/flashcards?track=${key}`)
    },
    {
      title: 'SEARCH QUESTION BANK',
      desc: 'Search by keyword, item code, or competence.',
      badge: unlocked ? 'DATABASE' : 'LOCKED',
      locked: !unlocked,
      onClick: gated('Search', `/search?track=${key}`)
    }
  ]

  return (
    <div className="screen">
      <button
        onClick={() => navigate('/tracks')}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Tracks
      </button>

      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
        <div>
          <h1 className="page-title" style={{ marginBottom: 2 }}>
            {info.title}
          </h1>
          <p className="subtitle">{info.level}</p>
        </div>
        <span className="badge-verified" style={!unlocked ? { borderColor: 'var(--text-muted)', color: 'var(--text-muted)' } : undefined}>
          {unlocked ? 'VERIFIED' : 'FREE TIER'}
        </span>
      </div>

      {unlocked && (
        <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '0.75rem' }}>
          Access Pass: {remaining()}
        </p>
      )}

      <div style={{ fontSize: '0.72rem', fontWeight: 800, letterSpacing: '0.08em', margin: '0.5rem 0 0.6rem' }}>
        EXAMINATION MODES
      </div>

      <div style={{ display: 'grid', gap: '0.65rem' }}>
        {modes.map((m) => (
          <button
            key={m.title}
            type="button"
            className="card"
            onClick={m.onClick}
            style={{
              textAlign: 'left',
              width: '100%',
              cursor: 'pointer',
              opacity: m.locked ? 0.6 : 1,
              borderColor: m.badge === 'FREE ACCESS' ? 'var(--accent)' : undefined
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
              <div style={{ fontWeight: 700, fontSize: '0.92rem' }}>{m.title}</div>
              <span
                className="badge-verified"
                style={m.locked ? { borderColor: 'var(--text-muted)', color: 'var(--text-muted)' } : undefined}
              >
                {m.badge}
              </span>
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>{m.desc}</div>
          </button>
        ))}
      </div>

      {!unlocked && (
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginTop: '1rem' }}
          onClick={() => navigate('/activation')}
        >
          ACTIVATE KEY
        </button>
      )}
    </div>
  )
}
