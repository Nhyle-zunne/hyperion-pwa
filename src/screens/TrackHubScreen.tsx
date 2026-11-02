import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { useHistoryStore } from '../stores/historyStore'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { useVaultStore } from '../stores/vaultStore'
import type { TrackId } from '../types/question'
import { checkOfflineQuestionPackUpdates, downloadOfflinePack, ensureOfflineFreeSamplePack, getQuestionCountsByTrack, getPublicQuestionCountByTrack } from '../lib/questionBank'
import { getCachedOfflineEntitlementSnapshot, getOfflinePackStatus } from '../lib/offlineQuestionCache'
import { supabase } from '../lib/supabase'
import './TrackHubScreen.css'

interface TrackInfo {
  trackId: TrackId
  title: string
  level: string
  freeTitle: string
  competencies?: string
  functions?: string
}

const TRACKS: Record<string, TrackInfo> = {
  oic_nw: {
    trackId: 'DECK_OIC_NW',
    title: 'OIC-NW OPERATIONAL REVIEWER',
    level: 'DECK OIC-NW OPERATIONAL LEVEL',
    freeTitle: 'OIC-NW FREE REVIEWER',
    competencies: '12 COMPETENCIES',
    functions: 'FUNCTIONS 1-3'
  },
  gmdss: {
    trackId: 'GMDSS_GOC',
    title: 'GMDSS GOC REVIEWER',
    level: 'GMDSS GOC LEVEL',
    freeTitle: 'GMDSS FREE REVIEWER',
  },
  engine_ew: {
    trackId: 'ENGINE_OIC_EW',
    title: 'ENGINE OIC-EW REVIEWER',
    level: 'ENGINE OIC-EW OPERATIONAL LEVEL',
    freeTitle: 'ENGINE OIC-EW FREE REVIEWER',
  },
  engine_mgt: {
    trackId: 'ENGINE_MGT',
    title: 'ENGINE MANAGEMENT REVIEWER',
    level: 'ENGINE MANAGEMENT LEVEL',
    freeTitle: 'ENGINE MGT FREE REVIEWER',
  },
  deck_mgt: {
    trackId: 'DECK_MGT',
    title: 'DECK MANAGEMENT REVIEWER',
    level: 'DECK MANAGEMENT LEVEL',
    freeTitle: 'DECK MGT FREE REVIEWER',
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

// Serialize background preparation across track changes and screen remounts.
let offlinePreparationInFlight: Promise<void> | null = null

export default function TrackHubScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const requestedKey = params.get('track')
  const key = requestedKey && TRACKS[requestedKey] ? requestedKey : 'oic_nw'
  const info = TRACKS[key]
  const [offlinePreparing, setOfflinePreparing] = useState(false)
  const [offlineStatus, setOfflineStatus] = useState<{ questionCount: number; groupCount: number; savedAt: number } | null>(null)
  const [offlineError, setOfflineError] = useState('')
  const [accountUserId, setAccountUserId] = useState<string | null | undefined>(undefined)
  const accountGeneration = useRef(0)
  const [freeQuestionCount, setFreeQuestionCount] = useState<number | null>(null)
  const [totalQuestionCount, setTotalQuestionCount] = useState<number | null>(null)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [offlineLicenseExpiry, setOfflineLicenseExpiry] = useState<number | null>(null)
  const [offlineLicenseAdmin, setOfflineLicenseAdmin] = useState(false)
  const [offlineLicenseChecked, setOfflineLicenseChecked] = useState(false)
  const [offlineRefreshKey, setOfflineRefreshKey] = useState(0)

  useEffect(() => {
    let active = true
    setTotalQuestionCount(null)
    void getPublicQuestionCountByTrack(info.trackId)
      .then(count => { if (active) setTotalQuestionCount(count) })
      .catch(() => { if (active) setTotalQuestionCount(null) })
    return () => { active = false }
  }, [info.trackId])

  useEffect(() => {
    let active = true
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

  const unlocked = useLicenseStore((s) => s.entitlementsVerified && (s.isTrackUnlocked(info.trackId) || s.isAllAccessUnlocked))
  const remaining = useLicenseStore((s) => s.getRemainingLabel)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const history = useHistoryStore((s) => s.entries)
  const bookmarks = useBookmarksStore((s) => s.items)
  const mistakes = useVaultStore((s) => s.items)

  useEffect(() => {
    if (!supabase) {
      setAccountUserId(null)
      return
    }
    let active = true
    const initialGeneration = accountGeneration.current
    let observedUserId: string | null | undefined
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      const userId = session?.user.id ?? null
      if (userId === observedUserId && event !== 'SIGNED_IN') return
      observedUserId = userId
      // Invalidate pending results immediately, even before React runs effect cleanup.
      accountGeneration.current += 1
      setAccountUserId(userId)
      setOfflineRefreshKey(current => current + 1)
    })
    void supabase.auth.getSession().then(({ data, error }) => {
      if (active && accountGeneration.current === initialGeneration) {
        setAccountUserId(!error ? data.session?.user.id ?? null : null)
      }
    }).catch(() => {
      if (active && accountGeneration.current === initialGeneration) setAccountUserId(null)
    })
    return () => {
      active = false
      subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    const refreshOfflineState = () => setOfflineRefreshKey(current => current + 1)
    const updateOnline = () => {
      setOnline(navigator.onLine)
      refreshOfflineState()
    }
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshOfflineState()
    }
    window.addEventListener('online', updateOnline)
    window.addEventListener('offline', updateOnline)
    window.addEventListener('focus', refreshOfflineState)
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.removeEventListener('online', updateOnline)
      window.removeEventListener('offline', updateOnline)
      window.removeEventListener('focus', refreshOfflineState)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [])

  const offlineContext = `${info.trackId}:${accountUserId ?? ''}:${unlocked}:${online}`
  const latestOfflineContext = useRef(offlineContext)
  latestOfflineContext.current = offlineContext

  useEffect(() => {
    let active = true
    const generation = accountGeneration.current
    const isCurrent = () => active && generation === accountGeneration.current && latestOfflineContext.current === offlineContext
    const track = info.trackId
    setOfflineStatus(null)
    setOfflineError('')
    setOfflinePreparing(false)
    setOfflineLicenseExpiry(null)
    setOfflineLicenseAdmin(false)
    setOfflineLicenseChecked(false)

    const loadLicense = async () => {
      if (!unlocked) return
      const snapshot = await getCachedOfflineEntitlementSnapshot(accountUserId ?? undefined)
      if (!isCurrent()) return
      const accountMatches = Boolean(snapshot && (accountUserId ? snapshot.userId === accountUserId : !online))
      setOfflineLicenseExpiry(accountMatches ? snapshot?.trackExpiries[track] ?? null : null)
      setOfflineLicenseAdmin(accountMatches && snapshot?.isAdmin === true)
    }
    const loadStatus = async () => {
      const status = await getOfflinePackStatus(track, !unlocked)
      if (isCurrent()) setOfflineStatus(status?.complete ? status : null)
      return status?.complete ? status : null
    }
    const prepareOffline = async () => {
      try {
        if (!unlocked && !online) await ensureOfflineFreeSamplePack(track)
        await loadStatus()
        await loadLicense()
        if (!isCurrent() || !unlocked || !online || !accountUserId) return

        // A previous track/account may still be finishing. Wait without starting
        // another transfer; canceled effects never enqueue replacement work.
        while (offlinePreparationInFlight) {
          await offlinePreparationInFlight
          if (!isCurrent()) return
        }
        if (navigator.onLine === false) return
        const prepare = async () => {
          const status = await loadStatus()
          if (!isCurrent()) return
          const check = status ? await checkOfflineQuestionPackUpdates(track, false) : null
          if (!isCurrent() || navigator.onLine === false) return
          if (status && check?.status !== 'available') return
          setOfflinePreparing(true)
          await downloadOfflinePack(track, false, undefined, { background: true })
          if (!isCurrent()) return
          await loadStatus()
          await loadLicense()
        }
        // Handle failure inside the shared promise so waiting effects can proceed.
        const pending = prepare().catch(() => {
          if (isCurrent()) setOfflineError('Offline preparation will retry when you reconnect or return to this screen.')
        })
        offlinePreparationInFlight = pending
        try {
          await pending
        } finally {
          if (offlinePreparationInFlight === pending) offlinePreparationInFlight = null
        }
      } catch {
        if (isCurrent()) setOfflineError('Offline readiness could not be checked. Reconnect or return to this screen to retry.')
      } finally {
        if (isCurrent()) {
          setOfflinePreparing(false)
          setOfflineLicenseChecked(true)
        }
      }
    }
    void prepareOffline()
    return () => { active = false }
  }, [info.trackId, unlocked, online, accountUserId, offlineRefreshKey, offlineContext])

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
      desc: freeQuestionCount === null
        ? 'Loading verified free-question count…'
        : `${freeQuestionCount.toLocaleString()} valid questions in the free pool`,
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
      badge: !unlocked ? 'LICENSE REQUIRED' : trackMistakes.length ? `${trackMistakes.length} SAVED` : 'EMPTY',
      icon: '✧',
      locked: !unlocked,
      onClick: gated('Mistakes Notebook', `/vault?track=${key}`)
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
          {totalQuestionCount !== null && <span>{totalQuestionCount.toLocaleString()} ITEMS</span>}
          {info.competencies && <span>{info.competencies}</span>}
          {info.functions && <span>{info.functions}</span>}
          {totalQuestionCount === null && <span>{info.level}</span>}
          {unlocked && <span>PASS: {remaining()}</span>}
        </div>
      </section>

      <section
        aria-label="Offline study readiness"
        style={{ margin: '1rem 0', padding: '1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)' }}
      >
        <h2 style={{ margin: '0 0 .5rem', fontSize: '1rem', color: 'var(--text)' }}>OFFLINE STUDY</h2>
        <p role="status" style={{ margin: 0, color: 'var(--text-muted)', fontSize: '.9rem' }}>
          {offlinePreparing
            ? 'Preparing encrypted offline study automatically…'
            : offlineStatus
              ? unlocked
                ? 'Questions are saved on this device for licensed offline study.'
                : 'Free reviewer questions are available on this device.'
              : unlocked
                ? online
                  ? 'Offline study prepares automatically while you are online and signed in.'
                  : 'Connect to prepare offline study automatically.'
                : 'Activate a track to prepare licensed offline study automatically.'}
        </p>
        {offlineStatus && unlocked && <p style={{ margin: '.5rem 0 0', color: 'var(--text-muted)', fontSize: '.82rem' }}>
          {!offlineLicenseChecked
            ? 'Checking this device’s offline license…'
            : offlineLicenseAdmin
              ? 'Administrator access is verified on this device and has no subscription expiry.'
              : offlineLicenseExpiry && offlineLicenseExpiry > Date.now()
                ? `Offline access is verified until ${new Date(offlineLicenseExpiry).toLocaleString()}. Reconnect before expiry to refresh your license.`
                : 'A valid offline license could not be verified on this device. Reconnect to refresh access before studying offline.'}
        </p>}
        <p style={{ margin: '.5rem 0 0', color: 'var(--text-muted)', fontSize: '.75rem' }}>{online ? 'DEVICE ONLINE' : 'DEVICE OFFLINE'}{offlineStatus ? ` · Last saved on this device: ${new Date(offlineStatus.savedAt).toLocaleString()}` : ''}</p>
        {offlineError && <p role="status" style={{ margin: '.5rem 0 0', color: 'var(--text-muted)', fontSize: '.82rem' }}>{offlineError}</p>}
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
        <button className="btn btn-primary hub-activate" onClick={() => openPaywall(`${info.title} · Track subscription`)}>
          VIEW SUBSCRIPTION OPTIONS
        </button>
      )}
    </div>
  )
}
