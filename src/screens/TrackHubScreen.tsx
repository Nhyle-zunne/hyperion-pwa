import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { useHistoryStore } from '../stores/historyStore'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { useVaultStore } from '../stores/vaultStore'
import type { TrackId } from '../types/question'
import { downloadOfflinePack, getQuestionCountsByTrack } from '../lib/questionBank'
import { getOfflineEntitlementExpiry, getOfflinePackStatus } from '../lib/offlineQuestionCache'
import { supabase } from '../lib/supabase'
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
    freeDesc: '2,065 free questions',
    totalQuestions: '6,448 ITEMS',
    competencies: '12 COMPETENCIES',
    functions: 'FUNCTIONS 1-3'
  },
  gmdss: {
    trackId: 'GMDSS_GOC',
    title: 'GMDSS GOC REVIEWER',
    level: 'GMDSS GOC LEVEL',
    freeTitle: 'GMDSS FREE REVIEWER',
    freeDesc: '1,030 free questions (C1: 900 · C2: 130).'
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
  const [offlineDownloading, setOfflineDownloading] = useState(false)
  const [offlineProgress, setOfflineProgress] = useState({ downloaded: 0, total: 0 })
  const [offlineStatus, setOfflineStatus] = useState<{ questionCount: number; groupCount: number; savedAt: number } | null>(null)
  const [offlineError, setOfflineError] = useState('')
  const [freeQuestionCount, setFreeQuestionCount] = useState<number | null>(null)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [offlineLicenseExpiry, setOfflineLicenseExpiry] = useState<number | null>(null)
  const [offlineLicenseChecked, setOfflineLicenseChecked] = useState(false)
  const [offlineRefreshKey, setOfflineRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    if (key === 'oic_nw' || key === 'gmdss') {
      setFreeQuestionCount(null)
      return () => { active = false }
    }

    setFreeQuestionCount(null)
    void getQuestionCountsByTrack(info.trackId, true)
      .then(counts => {
        if (active) setFreeQuestionCount(counts.reduce((total, item) => total + item.count, 0))
      })
      .catch(() => {
        if (active) setFreeQuestionCount(null)
      })

    return () => { active = false }
  }, [key, info.trackId])

  const unlocked = useLicenseStore((s) => s.isTrackUnlocked(info.trackId) || s.isAllAccessUnlocked)
  const remaining = useLicenseStore((s) => s.getRemainingLabel)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const history = useHistoryStore((s) => s.entries)
  const bookmarks = useBookmarksStore((s) => s.items)
  const mistakes = useVaultStore((s) => s.items)

  useEffect(() => {
    const refreshOfflineState = () => setOfflineRefreshKey(current => current + 1)
    const updateOnline = () => {
      setOnline(navigator.onLine)
      refreshOfflineState()
    }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('focus', refreshOfflineState)
    document.addEventListener('visibilitychange', refreshOfflineState)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('focus', refreshOfflineState)
      document.removeEventListener('visibilitychange', refreshOfflineState)
    }
  }, [])

  useEffect(() => {
    let active = true
    const loadOfflineState = async () => {
      setOfflineLicenseChecked(false)
      try {
        const status = await getOfflinePackStatus(info.trackId, !unlocked)
        if (active) setOfflineStatus(status?.complete ? status : null)
      } catch {
        if (active) setOfflineStatus(null)
      }

      if (!unlocked || !supabase) {
        if (active) {
          setOfflineLicenseExpiry(null)
          setOfflineLicenseChecked(true)
        }
        return
      }

      try {
        const { data, error } = await supabase.auth.getSession()
        const userId = !error ? data.session?.user?.id : undefined
        const expiry = userId ? await getOfflineEntitlementExpiry(userId, info.trackId) : null
        if (active) {
          setOfflineLicenseExpiry(expiry)
          setOfflineLicenseChecked(true)
        }
      } catch {
        if (active) {
          setOfflineLicenseExpiry(null)
          setOfflineLicenseChecked(true)
        }
      }
    }
    void loadOfflineState()
    return () => { active = false }
  }, [info.trackId, unlocked, online, offlineRefreshKey])

  const startOfflineDownload = async () => {
    setOfflineDownloading(true)
    setOfflineError('')
    setOfflineProgress({ downloaded: 0, total: 0 })
    try {
      const result = await downloadOfflinePack(info.trackId, !unlocked, (downloaded, total) => {
        setOfflineProgress({ downloaded, total })
      })
      const status = await getOfflinePackStatus(info.trackId, !unlocked)
      setOfflineStatus(status?.complete ? status : { ...result, savedAt: Date.now() })
    } catch (error) {
      setOfflineError(error instanceof Error ? error.message : 'Offline download failed. Please try again while online.')
    } finally {
      setOfflineDownloading(false)
    }
  }

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
      desc: key === 'oic_nw' || key === 'gmdss'
        ? info.freeDesc
        : freeQuestionCount === null
          ? 'Free sample: 40% of every competence.'
          : `${freeQuestionCount.toLocaleString()} free questions`,
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
      badge: 'FREE ACCESS',
      icon: '◴',
      locked: false,
      onClick: () => navigate(`/mock?track=${key}`)
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
        <button type="button" className="btn btn-primary hub-account-button" onClick={() => navigate('/account')}>Account / Purchases</button>
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

      <section
        aria-label="Offline question pack"
        style={{ margin: '1rem 0', padding: '1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
          <span aria-hidden="true" style={{ fontSize: '1.4rem' }}>⇩</span>
          <h2 style={{ margin: 0, fontSize: '1rem', color: 'var(--text)' }}>OFFLINE ACCESS</h2>
          {offlineStatus && <span style={{ color: 'var(--success, #16803d)', fontSize: '0.75rem', fontWeight: 800 }}>DOWNLOADED</span>}
          <span style={{ marginLeft: 'auto', padding: '.25rem .45rem', borderRadius: 999, border: '1px solid var(--border)', color: online ? 'var(--success, #16803d)' : 'var(--warning, #c2410c)', fontSize: '0.7rem', fontWeight: 850 }}>{online ? 'DEVICE ONLINE' : 'DEVICE OFFLINE'}</span>
        </div>
        <p style={{ margin: '0 0 0.8rem', color: 'var(--text-muted)', fontSize: '0.9rem' }}>
          {offlineStatus
            ? unlocked
              ? `${offlineStatus.questionCount.toLocaleString()} paid questions are saved on this device.`
              : `${offlineStatus.questionCount.toLocaleString()} free reviewer questions are saved on this device.`
            : unlocked
              ? 'Download the full question bank for this track to practice without internet.'
              : 'Download the free reviewer questions for use without internet.'}
        </p>
        {offlineStatus && unlocked && <p role="status" style={{ margin: '0 0 .8rem', padding: '.65rem .75rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', color: offlineLicenseExpiry && offlineLicenseExpiry > Date.now() ? 'var(--success, #16803d)' : 'var(--warning, #c2410c)', fontSize: '.84rem', lineHeight: 1.5 }}>
          {!offlineLicenseChecked
            ? 'Checking this device’s offline license…'
            : offlineLicenseExpiry && offlineLicenseExpiry > Date.now()
              ? `Offline access is verified until ${new Date(offlineLicenseExpiry).toLocaleString()}. Reconnect before expiry to refresh your license.`
              : 'Your paid question pack is saved, but a valid offline license could not be verified on this device. Reconnect to refresh access before going offline.'}
        </p>}
        {offlineStatus && <p style={{ margin: '0 0 .8rem', color: 'var(--text-muted)', fontSize: '.78rem' }}>
          Last saved on this device: {new Date(offlineStatus.savedAt).toLocaleString()}.
        </p>}
        {offlineDownloading && (
          <div style={{ marginBottom: 10 }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 5 }}>
              <span>Downloading questions…</span>
              <span>{offlineProgress.downloaded.toLocaleString()} / {offlineProgress.total.toLocaleString()}</span>
            </div>
            <progress value={offlineProgress.downloaded} max={Math.max(1, offlineProgress.total)} style={{ width: '100%', height: 8 }} />
          </div>
        )}
        {offlineError && <p role="alert" style={{ color: 'var(--danger, #b42318)', fontSize: '0.85rem' }}>{offlineError}</p>}
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => void startOfflineDownload()}
          disabled={!online || offlineDownloading}
          style={{ width: '100%', minHeight: 44 }}
        >
          {offlineDownloading ? 'DOWNLOADING…' : offlineStatus ? 'UPDATE OFFLINE QUESTION PACK' : unlocked ? 'DOWNLOAD FULL BANK FOR OFFLINE' : 'DOWNLOAD FREE QUESTIONS FOR OFFLINE'}
        </button>
        {!online && !offlineStatus && <p style={{ margin: '0.65rem 0 0', fontSize: '0.82rem', color: 'var(--text-muted)' }}>Connect to the internet to download this pack first.</p>}
        <p style={{ margin: '0.65rem 0 0', fontSize: '0.78rem', color: 'var(--text-muted)' }}>
          Packs are stored on this device. Paid offline access requires a valid server-signed license; reconnect periodically to refresh it. Revocation cannot reach a device while it remains fully offline.
        </p>
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
