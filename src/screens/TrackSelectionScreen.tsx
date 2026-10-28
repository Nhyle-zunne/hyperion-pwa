import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useHistoryStore } from '../stores/historyStore'
import { useStudyTimeStore, formatDurationMs } from '../stores/studyTimeStore'
import AppDrawer from '../components/AppDrawer'
import InstallPrompt from '../components/InstallPrompt'
import type { TrackId } from '../types/question'

const FB = 'https://www.facebook.com/hyperionbynhyle/'

const TRACKS: {
  id: string
  trackId: TrackId
  title: string
  regulation: string
  questions: string
  meta: string
  icon: string
  tierCheck: string
  mock: string
}[] = [
  { id: 'oic_nw', trackId: 'DECK_OIC_NW', title: 'DECK OIC-NW', regulation: 'STCW REGULATION II/1', questions: '6,448', meta: '12 COMPETENCIES · 200-ITEM MOCK', icon: '🧭', tierCheck: 'OIC', mock: '200' },
  { id: 'gmdss', trackId: 'GMDSS_GOC', title: 'GMDSS RADIO (GOC)', regulation: 'STCW REGULATION IV/2', questions: '2,260', meta: '2 COMPETENCIES · 100-ITEM MOCK', icon: '📡', tierCheck: 'GOC', mock: '100' },
  { id: 'engine_ew', trackId: 'ENGINE_OIC_EW', title: 'ENGINE OIC-EW', regulation: 'STCW REGULATION III/1', questions: '5,380', meta: '13 COMPETENCIES · 200-ITEM MOCK', icon: '🔧', tierCheck: 'EW', mock: '200' },
  { id: 'engine_mgt', trackId: 'ENGINE_MGT', title: 'ENGINE MANAGEMENT', regulation: 'STCW REGULATION III/2', questions: '5,589', meta: '14 COMPETENCIES · 200-ITEM MOCK', icon: '⚙️', tierCheck: 'EM', mock: '200' },
  { id: 'deck_mgt', trackId: 'DECK_MGT', title: 'DECK MANAGEMENT', regulation: 'STCW REGULATION II/2', questions: '6,081', meta: '18 COMPETENCIES · 200-ITEM MOCK', icon: '▲', tierCheck: 'DM', mock: '200' }
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
  const examDetailsRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    // React 18's typings do not expose inert as a JSX prop, but the native DOM property is supported.
    if (examDetailsRef.current) examDetailsRef.current.inert = !examPanelExpanded
  }, [examPanelExpanded])
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
                <span style={{ width: 28, height: 28, borderRadius: 8, background: 'var(--bg-elevated)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '0.9rem', flexShrink: 0 }}>{t.icon}</span>
                <span className="badge-verified" style={{ fontSize: '0.58rem', padding: '0.15rem 0.35rem' }}>{unlocked ? 'VERIFIED' : 'FREE TIER'}</span>
              </div>
              <div className="track-title">{t.title}</div>
              <div className="track-reg" style={{ marginTop: 2 }}>{t.regulation}</div>
              <div className="qcount">{t.questions}</div>
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
