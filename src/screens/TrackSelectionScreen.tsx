import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useHistoryStore } from '../stores/historyStore'
import { useVaultStore } from '../stores/vaultStore'
import { useStudyTimeStore, formatDurationMs } from '../stores/studyTimeStore'
import AppDrawer from '../components/AppDrawer'
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

export default function TrackSelectionScreen() {
  const navigate = useNavigate()
  const [drawerOpen, setDrawerOpen] = useState(false)
  const [targetDate, setTargetDate] = useState(() => {
    try {
      return localStorage.getItem('hyperion-target-date') || ''
    } catch {
      return ''
    }
  })

  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked || s.cloudTrackIds.includes('ALL'))
  const isTrackUnlocked = useLicenseStore((s) => s.isTrackUnlocked)
  const segments = useStudyTimeStore((s) => s.segments)
  const vaultCount = useVaultStore((s) => s.items.length)
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

  const streakDays = useMemo(() => {
    const active = new Set<string>()
    for (const s of segments) active.add(s.day)
    for (const h of history) active.add(dayKey(h.finishedAt))
    const days: boolean[] = []
    for (let i = 6; i >= 0; i--) {
      const key = dayKey(Date.now() - i * 86_400_000)
      days.push(active.has(key))
    }
    return days
  }, [segments, history])

  const streakCount = streakDays.filter(Boolean).length
  const select = (track: (typeof TRACKS)[0]) => navigate(`/track?track=${track.id}`)
  const saveTarget = () => {
    const el = document.getElementById('target-date-input') as HTMLInputElement | null
    el?.showPicker?.()
    el?.click()
  }

  return (
    <div className="screen" style={{ paddingTop: 0 }}>
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />

      <div className="dash-header">
        <div>
          <h1>Hyperion Maritime</h1>
          <div className="sub">STCW ’78 AS AMENDED · MARINA CRP</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '0.85rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
          <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
            <span style={{ fontSize: '1.2rem' }}>📅</span>
            <div>
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', fontWeight: 600 }}>MARINA LICENSURE EXAM</div>
              <div style={{ fontWeight: 700, fontSize: '0.95rem' }}>
                {targetDate ? `Target · ${new Date(targetDate + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}` : 'SET TARGET DATE'}
              </div>
            </div>
          </div>
          <button className="btn btn-primary" style={{ padding: '0.5rem 0.85rem', fontSize: '0.8rem' }} onClick={saveTarget}>SET DATE →</button>
          <input id="target-date-input" type="date" value={targetDate} onChange={(e) => {
            setTargetDate(e.target.value)
            try { localStorage.setItem('hyperion-target-date', e.target.value) } catch { /* ignore */ }
          }} style={{ position: 'absolute', opacity: 0, pointerEvents: 'none', width: 0, height: 0 }} />
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)', textAlign: 'center' }}>
          <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>TODAY</div><div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{formatDurationMs(todayMs)}</div></div>
          <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>OVERALL ACCURACY</div><div style={{ fontWeight: 800, fontSize: '1.05rem' }}>{avgPercent}%</div></div>
          <div><div style={{ fontSize: '0.65rem', color: 'var(--text-muted)', fontWeight: 600 }}>OFFLINE VAULT</div><div style={{ fontWeight: 800, fontSize: '1.05rem', color: 'var(--accent)' }}>⚡ {vaultCount} HYPE</div></div>
        </div>

        <div style={{ marginTop: 14 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>ROLLING 7-DAY STREAK</span>
            <span style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)' }}>{streakCount} / 7 DAYS</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: 6 }}>
            {streakDays.map((on, i) => (
              <div key={i} style={{ aspectRatio: '1', borderRadius: 8, border: on ? '2px solid var(--accent)' : '1px solid var(--border)', background: on ? 'var(--accent-soft)' : 'var(--streak-empty)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', fontSize: '0.65rem', fontWeight: 700, color: on ? 'var(--accent)' : 'var(--text-muted)' }}>
                <span>D{i + 1}</span><span>{on ? '✓' : '–'}</span>
              </div>
            ))}
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
