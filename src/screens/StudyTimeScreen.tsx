import { useNavigate } from 'react-router-dom'
import { useStudyTimeStore, formatDurationMs } from '../stores/studyTimeStore'
import { useHistoryStore } from '../stores/historyStore'

export default function StudyTimeScreen() {
  const navigate = useNavigate()
  const todayMs = useStudyTimeStore((s) => s.todayMs())
  const weekMs = useStudyTimeStore((s) => s.weekMs())
  const totalMs = useStudyTimeStore((s) => s.totalMs())
  const byDay = useStudyTimeStore((s) => s.byDay(14))
  const clear = useStudyTimeStore((s) => s.clear)
  const historyCount = useHistoryStore((s) => s.entries.length)
  const maxDay = Math.max(1, ...byDay.map((d) => d.ms))

  return (
    <div className="screen">
      <h1 className="page-title">Study Time</h1>
      <p className="subtitle">Time spent in Practice, Drill, and Mock sessions</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}
      >
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent)' }}>
            {formatDurationMs(todayMs)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Today</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--accent)' }}>
            {formatDurationMs(weekMs)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Last 7 days</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 700, color: 'var(--success)' }}>
            {formatDurationMs(totalMs)}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>All time</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.35rem', fontWeight: 700 }}>{historyCount}</div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sessions</div>
        </div>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>Last 14 days</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {byDay.map(({ day, ms }) => {
            const pct = Math.round((ms / maxDay) * 100)
            const label = day.slice(5) // MM-DD
            return (
              <div key={day} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span
                  style={{
                    width: 44,
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)',
                    fontVariantNumeric: 'tabular-nums'
                  }}
                >
                  {label}
                </span>
                <div
                  style={{
                    flex: 1,
                    height: 10,
                    background: 'var(--bg-elevated)',
                    borderRadius: 4,
                    overflow: 'hidden'
                  }}
                >
                  <div
                    style={{
                      width: `${pct}%`,
                      height: '100%',
                      background: ms > 0 ? 'var(--accent)' : 'transparent',
                      borderRadius: 4
                    }}
                  />
                </div>
                <span
                  style={{
                    width: 56,
                    textAlign: 'right',
                    fontSize: '0.75rem',
                    color: 'var(--text-muted)'
                  }}
                >
                  {ms > 0 ? formatDurationMs(ms) : '—'}
                </span>
              </div>
            )
          })}
        </div>
      </div>

      <button className="btn btn-outline" style={{ width: '100%', marginBottom: 8 }} onClick={() => navigate('/history')}>
        View session history
      </button>

      {totalMs > 0 && (
        <button
          className="btn btn-outline"
          style={{ width: '100%', color: 'var(--danger)' }}
          onClick={() => {
            if (confirm('Reset all study time data on this device?')) clear()
          }}
        >
          Reset study time
        </button>
      )}
    </div>
  )
}
