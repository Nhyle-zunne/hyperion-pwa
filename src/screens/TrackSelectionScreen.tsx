import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useHistoryStore } from '../stores/historyStore'
import { useStudyTimeStore, formatDurationMs } from '../stores/studyTimeStore'
import AppDrawer from '../components/AppDrawer'
import InstallPrompt from '../components/InstallPrompt'
import type { TrackId } from '../types/question'
import { getPublicQuestionCountByTrack } from '../lib/questionBank'

const FB = 'https://www.facebook.com/hyperionbynhyle/'

/**
 * Android parity: Material Filled icon vectors used by TrackSelectionScreen.kt.
 * Explore, CellTower, Build, Construction, Navigation (24dp Material icons).
 * Rendering vectors instead of platform-dependent emoji keeps all five tracks
 * visually consistent with the Android app on mobile and desktop.
 */
const ANDROID_TRACK_ICON_PATHS = {
  explore: [
    'M12 10.9c-.61 0-1.1.49-1.1 1.1s.49 1.1 1.1 1.1c.61 0 1.1-.49 1.1-1.1s-.49-1.1-1.1-1.1zM12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm2.19 12.19L6 18l3.81-8.19L18 6l-3.81 8.19z'
  ],
  cellTower: [
    'M7.3,14.7l1.2-1.2c-1-1-1.5-2.3-1.5-3.5c0-1.3,0.5-2.6,1.5-3.5L7.3,5.3c-1.3,1.3-2,3-2,4.7S6,13.4,7.3,14.7z',
    'M19.1,2.9l-1.2,1.2c1.6,1.6,2.4,3.8,2.4,5.9c0,2.1-0.8,4.3-2.4,5.9l1.2,1.2c2-2,2.9-4.5,2.9-7.1C22,7.4,21,4.9,19.1,2.9z',
    'M6.1,4.1L4.9,2.9C3,4.9,2,7.4,2,10c0,2.6,1,5.1,2.9,7.1l1.2-1.2c-1.6-1.6-2.4-3.8-2.4-5.9C3.7,7.9,4.5,5.7,6.1,4.1z',
    'M16.7,14.7c1.3-1.3,2-3,2-4.7c-0.1-1.7-0.7-3.4-2-4.7l-1.2,1.2c1,1,1.5,2.3,1.5,3.5c0,1.3-0.5,2.6-1.5,3.5L16.7,14.7z',
    'M14.5,10c0-1.38-1.12-2.5-2.5-2.5S9.5,8.62,9.5,10c0,0.76,0.34,1.42,0.87,1.88L7,22h2l0.67-2h4.67L15,22h2l-3.37-10.12 C14.16,11.42,14.5,10.76,14.5,10z M10.33,18L12,13l1.67,5H10.33z'
  ],
  build: [
    'M22.7 19l-9.1-9.1c.9-2.3.4-5-1.5-6.9-2-2-5-2.4-7.4-1.3L9 6 6 9 1.6 4.7C.4 7.1.9 10.1 2.9 12.1c1.9 1.9 4.6 2.4 6.9 1.5l9.1 9.1c.4.4 1 .4 1.4 0l2.3-2.3c.5-.4.5-1.1.1-1.4z'
  ],
  construction: [
    'M17.5,10c1.93,0,3.5-1.57,3.5-3.5c0-0.58-0.16-1.12-0.41-1.6l-2.7,2.7L16.4,6.11l2.7-2.7C18.62,3.16,18.08,3,17.5,3 C15.57,3,14,4.57,14,6.5c0,0.41,0.08,0.8,0.21,1.16l-1.85,1.85l-1.78-1.78l0.71-0.71L9.88,5.61L12,3.49 c-1.17-1.17-3.07-1.17-4.24,0L4.22,7.03l1.41,1.41H2.81L2.1,9.15l3.54,3.54l0.71-0.71V9.15l1.41,1.41l0.71-0.71l1.78,1.78 l-7.41,7.41l2.12,2.12L16.34,9.79C16.7,9.92,17.09,10,17.5,10z'
  ],
  navigation: [
    'M12 2L4.5 20.29l.71.71L12 18l6.79 3 .71-.71z'
  ]
} as const

type AndroidTrackIconName = keyof typeof ANDROID_TRACK_ICON_PATHS

function AndroidTrackIcon({ name }: { name: AndroidTrackIconName }) {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false">
      {ANDROID_TRACK_ICON_PATHS[name].map((path, index) => <path key={index} d={path} />)}
      {name === 'construction' && (
        <rect x="16.34" y="12.87" width="3" height="8.48" transform="matrix(0.7071 -0.7071 0.7071 0.7071 -6.8717 17.6255)" />
      )}
    </svg>
  )
}

const TRACKS: {
  id: string
  trackId: TrackId
  title: string
  regulation: string
  questions: string
  meta: string
  icon: AndroidTrackIconName
  tierCheck: string
  mock: string
}[] = [
  { id: 'oic_nw', trackId: 'DECK_OIC_NW', title: 'DECK OIC-NW', regulation: 'STCW REGULATION II/1', questions: '', meta: '12 COMPETENCIES · 200-ITEM MOCK', icon: 'explore', tierCheck: 'OIC', mock: '200' },
  { id: 'gmdss', trackId: 'GMDSS_GOC', title: 'GMDSS RADIO (GOC)', regulation: 'STCW REGULATION IV/2', questions: '', meta: '2 COMPETENCIES · 100-ITEM MOCK', icon: 'cellTower', tierCheck: 'GOC', mock: '100' },
  { id: 'engine_ew', trackId: 'ENGINE_OIC_EW', title: 'ENGINE OIC-EW', regulation: 'STCW REGULATION III/1', questions: '', meta: '13 COMPETENCIES · 200-ITEM MOCK', icon: 'build', tierCheck: 'EW', mock: '200' },
  { id: 'engine_mgt', trackId: 'ENGINE_MGT', title: 'ENGINE MANAGEMENT', regulation: 'STCW REGULATION III/2', questions: '', meta: '14 COMPETENCIES · 200-ITEM MOCK', icon: 'construction', tierCheck: 'EM', mock: '200' },
  { id: 'deck_mgt', trackId: 'DECK_MGT', title: 'DECK MANAGEMENT', regulation: 'STCW REGULATION II/2', questions: '', meta: '18 COMPETENCIES · 200-ITEM MOCK', icon: 'navigation', tierCheck: 'DM', mock: '200' }
]

function dayKey(ts = Date.now()) {
  const d = new Date(ts)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function addDaysToKey(dateKey: string, offset: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, month - 1, day, 12, 0, 0, 0)
  date.setDate(date.getDate() + offset)
  return dayKey(date.getTime())
}

export default function TrackSelectionScreen() {
  const navigate = useNavigate()
  const location = useLocation()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [examPanelExpanded, setExamPanelExpanded] = useState(false)
  const [publishedQuestionCounts, setPublishedQuestionCounts] = useState<Partial<Record<TrackId, number>>>({})
  const examDetailsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // React 18's typings do not expose inert as a JSX prop, but the native DOM property is supported.
    if (examDetailsRef.current) examDetailsRef.current.inert = !examPanelExpanded
  }, [examPanelExpanded])
  useEffect(() => {
    let active = true
    const loadPublishedCounts = async () => {
      const results = await Promise.allSettled(
        TRACKS.map(async track => [track.trackId, await getPublicQuestionCountByTrack(track.trackId)] as const)
      )
      if (!active) return
      setPublishedQuestionCounts(current => {
        const next = { ...current }
        for (const result of results) {
          if (result.status === 'fulfilled') next[result.value[0]] = result.value[1]
        }
        return next
      })
    }
    void loadPublishedCounts()
    return () => { active = false }
  }, [])

  const targetDate = useStudyTimeStore((s) => s.targetDate)
  const setTargetDate = useStudyTimeStore((s) => s.setTargetDate)

  // Wait until account progress has finished restoring before migrating old local dates,
  // so a stale device-local value cannot replace a newer date from another device.
  useEffect(() => {
    const migrateTargetDate = () => {
      const state = useStudyTimeStore.getState()
      if (state.targetDate && state.targetDateUpdatedAt === 0) state.setTargetDate(state.targetDate)
    }
    window.addEventListener('hyperion:learning-progress-restored', migrateTargetDate)
    return () => window.removeEventListener('hyperion:learning-progress-restored', migrateTargetDate)
  }, [])

  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked || s.cloudTrackIds.includes('ALL'))
  const isTrackUnlocked = useLicenseStore((s) => s.isTrackUnlocked)
  const segments = useStudyTimeStore((s) => s.segments)
  const dailyCheckInStartDate = useStudyTimeStore((s) => s.dailyCheckInStartDate)
  const dailyCheckInLastDate = useStudyTimeStore((s) => s.dailyCheckInLastDate)
  const dailyCheckInCount = useStudyTimeStore((s) => s.dailyCheckInCount)
  const history = useHistoryStore((s) => s.entries)

  const todayMs = useMemo(() => {
    const key = dayKey()
    return segments.filter((s) => s.day === key).reduce((a, s) => a + s.durationMs, 0)
  }, [segments])

  const avgPercent = useMemo(() => {
    if (history.length === 0) return 0
    const sum = history.reduce((a, e) => a + e.percent, 0)
    return Math.round(sum / history.length)
  }, [history])

  const todayKey = dayKey()
  const yesterdayKey = addDaysToKey(todayKey, -1)
  // Predict today's increment for display while account progress is being restored.
  // The persisted store records the actual check-in once per local calendar day.
  const displayedStreakCount = dailyCheckInLastDate === todayKey
    ? dailyCheckInCount
    : dailyCheckInLastDate === yesterdayKey && dailyCheckInCount > 0
      ? dailyCheckInCount + 1
      : 0
  const displayStartDate = displayedStreakCount > 0 && dailyCheckInStartDate ? dailyCheckInStartDate : todayKey
  const firstVisibleDay = displayedStreakCount > 7 ? displayedStreakCount - 6 : 1
  const streakDays = useMemo(() => {
    const days: { dayNumber: number; active: boolean; label: string; dateLabel: string }[] = []
    for (let offset = 0; offset < 7; offset++) {
      const dayNumber = firstVisibleDay + offset
      const dateKey = addDaysToKey(displayStartDate, dayNumber - 1)
      const date = new Date(`${dateKey}T12:00:00`)
      const formattedDate = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(date)
      const dateLabel = dateKey === todayKey ? `TODAY · ${formattedDate}` : formattedDate
      days.push({ dayNumber, active: dayNumber <= displayedStreakCount, label: `DAY ${dayNumber}`, dateLabel })
    }
    return days
  }, [displayStartDate, displayedStreakCount, firstVisibleDay, todayKey])

  const streakStatus = displayedStreakCount <= 7
    ? `${displayedStreakCount} / 7 DAYS`
    : `${displayedStreakCount} DAY STREAK`
  const select = (track: (typeof TRACKS)[0]) => navigate(`/track?track=${track.id}`)
  const saveTarget = () => {
    const el = document.getElementById('target-date-input') as HTMLInputElement | null
    el?.showPicker?.()
    el?.click()
  }

  return (
    <div className="screen dashboard-screen" style={{ paddingTop: 0 }}>
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      {location.pathname === '/' && <InstallPrompt variant="modal" />}

      <div className={`dash-header dashboard-header-with-exam${examPanelExpanded ? ' is-expanded' : ''}`}>
        <div className="dashboard-header-main">
          <div className="dashboard-header-brand">
            <h1>Hyperion Maritime</h1>
            <div className="sub">STCW ’78 AS AMENDED · MARINA CRP</div>
          </div>
          <button
            type="button"
            className="dashboard-exam-panel__toggle"
            aria-expanded={examPanelExpanded}
            aria-controls="dashboard-exam-details"
            onClick={() => setExamPanelExpanded((open) => !open)}
          >
            <span className="dashboard-exam-panel__icon" aria-hidden="true">📅</span>
            <span className="dashboard-exam-panel__summary">
              <span className="dashboard-exam-panel__eyebrow">MARINA LICENSURE EXAM</span>
              <span className="dashboard-exam-panel__target">
                {targetDate ? `Target · ${new Date(targetDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'Set your target date'}
              </span>
            </span>
            <span className="dashboard-exam-panel__streak">{streakStatus}</span>
            <span className={`dashboard-exam-panel__chevron${examPanelExpanded ? ' is-open' : ''}`} aria-hidden="true">
              <svg viewBox="0 0 24 24" width="16" height="16" focusable="false">
                <path d="m6.5 9 5.5 5.5L17.5 9" fill="none" stroke="currentColor" strokeWidth="2.25" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
          </button>
        </div>

        <div
          id="dashboard-exam-details"
          ref={examDetailsRef}
          className={`dashboard-exam-panel__details${examPanelExpanded ? ' is-expanded' : ''}`}
          aria-hidden={!examPanelExpanded}
        >
          <div className="dashboard-exam-panel__detail-actions">
            <span className="dashboard-exam-panel__detail-caption">YOUR PREPARATION</span>
            <button type="button" className="btn btn-primary" onClick={saveTarget}>SET DATE →</button>
            <input id="target-date-input" className="dashboard-exam-panel__date-input" type="date" value={targetDate} onChange={(e) => setTargetDate(e.target.value)} aria-label="MARINA licensure exam target date" />
          </div>

          <div className="dashboard-exam-panel__stats">
            <div><div className="dashboard-exam-panel__stat-label">TODAY</div><div className="dashboard-exam-panel__stat-value">{formatDurationMs(todayMs)}</div></div>
            <div><div className="dashboard-exam-panel__stat-label">OVERALL ACCURACY</div><div className="dashboard-exam-panel__stat-value">{avgPercent}%</div></div>
          </div>

          <div className="dashboard-exam-panel__streak-area">
            <div className="dashboard-exam-panel__streak-heading">
              <span>DAILY CHECK-IN STREAK</span>
              <span>{streakStatus}</span>
            </div>
            <div className="daily-streak-grid">
              {streakDays.map((day) => (
                <div
                  key={day.dayNumber}
                  className={`daily-streak-day${day.active ? ' is-active' : ''}`}
                  aria-label={`Day ${day.dayNumber}, ${day.label}, ${day.dateLabel}: ${day.active ? 'checked in' : 'no check-in'}`}
                  title={`${day.label} · ${day.dateLabel}`}
                >
                  <span className="daily-streak-label">{day.label}</span>
                  <span className="daily-streak-date">{day.dateLabel}</span>
                  <span className="daily-streak-status" aria-hidden="true">{day.active ? '✓' : '—'}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <div className="track-grid">
        {TRACKS.map((t) => {
          const unlocked = isAllAccessUnlocked || isTrackUnlocked(t.tierCheck)
          return (
            <button key={t.id} type="button" className="track-card" onClick={() => select(t)}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 4 }}>
                <span style={{ width: 32, height: 32, borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text)', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }} aria-hidden="true"><AndroidTrackIcon name={t.icon} /></span>
                <span className="badge-verified" style={{ fontSize: '0.58rem', padding: '0.15rem 0.35rem' }}>{unlocked ? 'VERIFIED' : 'FREE TIER'}</span>
              </div>
              <div className="track-title">{t.title}</div>
              <div className="track-reg" style={{ marginTop: 2 }}>{t.regulation}</div>
              <div className="qcount">{(publishedQuestionCounts[t.trackId] ?? null)?.toLocaleString() ?? '—'}</div>
              <div className="track-meta">QUESTIONS AVAILABLE</div>
              <div className="track-meta" style={{ marginTop: 4 }}>{t.meta}</div>
              <div style={{ marginTop: 'auto', paddingTop: 8, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="track-meta">PROGRESS 0%</span>
                <span style={{ width: 26, height: 26, borderRadius: 6, background: 'var(--accent)', color: 'var(--btn-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '0.85rem', flexShrink: 0 }}>→</span>
              </div>
            </button>
          )
        })}

        <a href={FB} target="_blank" rel="noopener noreferrer" className="track-card" style={{ borderColor: '#1877F2', textDecoration: 'none' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <span style={{ width: 32, height: 32, borderRadius: 8, background: '#1877F2', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800, fontSize: '1.1rem' }}>f</span>
            <span className="badge-verified" style={{ borderColor: '#1877F2', color: '#1877F2' }}>COMMUNITY</span>
          </div>
          <div style={{ fontWeight: 800, fontSize: '0.88rem', marginTop: 10 }}>CONNECT WITH US</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600, marginTop: 2 }}>OFFICIAL PAGE & SUPPORT</div>
          <div className="qcount" style={{ fontSize: '1.35rem' }}>FACEBOOK</div>
          <div style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>UPDATES & INQUIRIES</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: 4 }}>@hyperionbynhyle</div>
          <div style={{ marginTop: 'auto', paddingTop: 10, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span style={{ fontSize: '0.68rem', color: 'var(--text-muted)', fontWeight: 600 }}>VISIT PAGE</span>
            <span style={{ width: 28, height: 28, borderRadius: 6, background: 'var(--accent)', color: 'var(--btn-primary-text)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 800 }}>→</span>
          </div>
        </a>
      </div>
      <footer style={{ marginTop: '1.5rem', padding: '1rem 0', borderTop: '1px solid var(--border)', textAlign: 'center', fontSize: '0.85rem' }}>
        <button type="button" onClick={() => navigate('/privacy-policy')} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 700 }}>Privacy Policy</button>
      </footer>
    </div>
  )
}
