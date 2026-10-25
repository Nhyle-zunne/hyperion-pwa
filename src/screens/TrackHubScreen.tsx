import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { useHistoryStore } from '../stores/historyStore'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { useVaultStore } from '../stores/vaultStore'
import type { TrackId } from '../types/question'
import './TrackHubScreen.css'

interface TrackInfo {
  trackId: TrackId
  title: string
  level: string
  freeTitle: string
  freeDesc: string
  totalQuestions?: string
  competencies?: string
  functions?: string
}

const TRACKS: Record<string, TrackInfo> = {
  oic_nw: {
    trackId: 'DECK_OIC_NW',
    title: 'OIC-NW OPERATIONAL REVIEWER',
    level: 'DECK OIC-NW OPERATIONAL LEVEL',
    freeTitle: 'OIC-NW FREE REVIEWER',
    freeDesc: '2,065 questions across 12 competencies (F1, F2, F3).',
    totalQuestions: '6,448 ITEMS',
    competencies: '12 COMPETENCIES',
    functions: 'FUNCTIONS 1-3'
  },
  gmdss: {
    trackId: 'GMDSS_GOC',
    title: 'GMDSS GOC REVIEWER',
    level: 'GMDSS GOC LEVEL',
    freeTitle: 'GMDSS FREE REVIEWER',
    freeDesc: '1,150 free questions (C1: 1,000 · C2: 150).'
  },
  engine_ew: {
    trackId: 'ENGINE_OIC_EW',
    title: 'ENGINE OIC-EW REVIEWER',
    level: 'ENGINE OIC-EW OPERATIONAL LEVEL',
    freeTitle: 'ENGINE OIC-EW FREE REVIEWER',
    freeDesc: 'Free sample: 40% of every competence.'
  },
  engine_mgt: {
    trackId: 'ENGINE_MGT',
    title: 'ENGINE MANAGEMENT REVIEWER',
    level: 'ENGINE MANAGEMENT LEVEL',
    freeTitle: 'ENGINE MGT FREE REVIEWER',
    freeDesc: 'Free sample: 40% of every competence.'
  },
  deck_mgt: {
    trackId: 'DECK_MGT',
    title: 'DECK MANAGEMENT REVIEWER',
    level: 'DECK MANAGEMENT LEVEL',
    freeTitle: 'DECK MGT FREE REVIEWER',
    freeDesc: 'Free sample: 40% of every competence.'
  }
}

interface Mode {
  title: string
  desc: string
  badge: string
  icon: string
  locked: boolean
  className?: string
  onClick: () => void
}

export default function TrackHubScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedKey = params.get('track')
  const key = requestedKey && TRACKS[requestedKey] ? requestedKey : 'oic_nw'
  const info = TRACKS[key]

  const unlocked = useLicenseStore((s) => s.isTrackUnlocked(info.trackId) || s.isAllAccessUnlocked)
  const remaining = useLicenseStore((s) => s.getRemainingLabel)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const history = useHistoryStore((s) => s.entries)
  const bookmarks = useBookmarksStore((s) => s.items)
  const mistakes = useVaultStore((s) => s.items)

  const trackHistory = history.filter((entry) => entry.track === info.trackId)
  const trackMistakes = mistakes.filter((item) => item.track === info.trackId)
  const trackBookmarks = bookmarks.filter((item) => item.track === info.trackId)
  const averageScore = trackHistory.length
    ? Math.round(trackHistory.reduce((total, entry) => total + entry.percent, 0) / trackHistory.length)
    : null

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
      icon: '▰',
      locked: false,
      className: 'hub-mode-free',
      onClick: () => navigate(`/practice/competences?track=${key}&free=1`)
    },
    {
      title: 'PRACTICE ALL QUESTIONS',
      desc: 'Full question bank, by competence or mixed.',
      badge: unlocked ? 'CUSTOMIZABLE' : 'LOCKED',
      icon: '☷',
      locked: !unlocked,
      onClick: gated('Practice', `/practice/competences?track=${key}`)
    },
    {
      title: 'QUICK SCAN MODE',
      desc: 'Browse questions sequentially with correct answers highlighted. Select a competence to begin.',
      badge: unlocked ? 'READ-ONLY REVIEW' : 'LOCKED',
      icon: '⌕',
      locked: !unlocked,
      onClick: gated('Quick Scan', `/quick-scan?track=${key}`)
    },
    {
      title: 'TIMED MOCK EXAM',
      desc: '70% cutoff · timed · MARINA format.',
      badge: unlocked ? 'STCW MOCK' : 'LOCKED',
      icon: '◴',
      locked: !unlocked,
      onClick: gated('Mock Exam', `/mock?track=${key}`)
    },
    {
      title: 'FLASHCARD REVISION',
      desc: 'Active recall · tap to flip cards.',
      badge: unlocked ? 'ACTIVE RECALL' : 'LOCKED',
      icon: '▱',
      locked: !unlocked,
      onClick: gated('Flashcards', `/flashcards?track=${key}`)
    },
    {
      title: 'MISTAKES NOTEBOOK',
      desc: `${trackMistakes.length} questions to review. Track your wrong answers.`,
      badge: trackMistakes.length ? `${trackMistakes.length} SAVED` : 'EMPTY',
      icon: '✧',
      locked: false,
      onClick: () => navigate(`/vault?track=${key}`)
    },
    {
      title: 'SESSION LOG',
      desc: 'Past practice sessions, mock attempts and scores.',
      badge: `${trackHistory.length} LOGS`,
      icon: '▥',
      locked: false,
      onClick: () => navigate(`/history?track=${key}`)
    },
    {
      title: 'SEARCH QUESTION BANK',
      desc: 'Search by keyword, item code, or competence.',
      badge: unlocked ? 'DATABASE' : 'LOCKED',
      icon: '⌕',
      locked: !unlocked,
      onClick: gated('Search', `/search?track=${key}`)
    }
  ]

  return (
    <div className="screen track-hub-screen">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
        <button className="hub-back" onClick={() => navigate('/tracks')}>
          <span aria-hidden="true">←</span> Tracks
        </button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/account')}>Account / Purchases</button>
      </div>

      <section className="hub-hero" aria-label="Track information">
        <div className="hub-hero-top">
          <span className="hub-regulation">STCW '78 AS AMENDED</span>
          <span className={`hub-terminal ${unlocked ? 'is-verified' : 'is-free'}`}>
            {unlocked ? 'VERIFIED TERMINAL' : 'FREE TIER'}
          </span>
        </div>
        <p className="hub-eyebrow">HYPERION MARITIME LICENSURE</p>
        <h1>{info.title}</h1>
        <div className="hub-meta">
          {info.totalQuestions && <span>{info.totalQuestions}</span>}
          {info.competencies && <span>{info.competencies}</span>}
          {info.functions && <span>{info.functions}</span>}
          {!info.totalQuestions && <span>{info.level}</span>}
          {unlocked && <span>PASS: {remaining()}</span>}
        </div>
      </section>

      <section className="hub-performance" aria-labelledby="hub-performance-title">
        <h2 id="hub-performance-title" className="hub-section-title">PERFORMANCE OVERVIEW</h2>
        <div className="hub-stats">
          <div className="hub-stat">
            <strong>{trackHistory.length}</strong>
            <span>EXAMS TAKEN</span>
          </div>
          <div className="hub-stat">
            <strong>{averageScore === null ? '--' : `${averageScore}%`}</strong>
            <span>AVG SCORE</span>
          </div>
          <div className="hub-stat">
            <strong>{trackMistakes.length}</strong>
            <span>MISTAKES</span>
          </div>
          <div className="hub-stat">
            <strong>{trackBookmarks.length}</strong>
            <span>BOOKMARKS</span>
          </div>
        </div>
      </section>

      <section className="hub-modes" aria-labelledby="hub-modes-title">
        <h2 id="hub-modes-title" className="hub-section-title">EXAMINATION MODES</h2>
        <div className="hub-mode-grid">
          {modes.map((mode) => (
            <button
              key={mode.title}
              type="button"
              className={`hub-mode-card ${mode.className ?? ''} ${mode.locked ? 'is-locked' : ''}`}
              onClick={mode.onClick}
              aria-label={`${mode.title}${mode.locked ? ', locked' : ''}`}
            >
              <div className="hub-mode-top">
                <span className="hub-mode-icon" aria-hidden="true">{mode.icon}</span>
                <span className={`hub-mode-badge ${mode.locked ? 'badge-muted' : ''} ${mode.className ?? ''}`}>
                  {mode.badge}
                </span>
              </div>
              <h3>{mode.title}</h3>
              <p>{mode.desc}</p>
              <span className="hub-mode-action">
                SELECT MODE <span aria-hidden="true">→</span>
              </span>
            </button>
          ))}
        </div>
      </section>

      {!unlocked && (
        <button className="btn btn-primary hub-activate" onClick={() => navigate('/account')}>
          VIEW SUBSCRIPTION OPTIONS
        </button>
      )}
    </div>
  )
}
