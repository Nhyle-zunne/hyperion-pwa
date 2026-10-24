import { useNavigate } from 'react-router-dom'
import { useHistoryStore, type SessionMode } from '../stores/historyStore'
import type { TrackId } from '../types/question'

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Mgt',
  ENGINE_MGT: 'Engine Mgt'
}

const MODE_LABEL: Record<SessionMode, string> = {
  PRACTICE: 'Practice',
  DRILL: 'Drill',
  MOCK: 'Mock Exam'
}

function formatDate(ts: number) {
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit'
    })
  } catch {
    return '—'
  }
}

function formatDuration(ms: number) {
  const sec = Math.floor(ms / 1000)
  if (sec < 60) return `${sec}s`
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return `${m}m ${s}s`
  const h = Math.floor(m / 60)
  return `${h}h ${m % 60}m`
}

export default function HistoryScreen() {
  const navigate = useNavigate()
  const entries = useHistoryStore((s) => s.entries)
  const stats = useHistoryStore((s) => s.stats())
  const clear = useHistoryStore((s) => s.clear)

  return (
    <div className="screen">
      <h1 className="page-title">History</h1>
      <p className="subtitle">Completed practice, drills, and mock exams</p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: '0.75rem',
          marginBottom: '1.25rem'
        }}
      >
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>
            {stats.totalSessions}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sessions</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>
            {stats.avgPercent}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Avg score</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
            {stats.bestPercent}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Best</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            P {stats.byMode.PRACTICE} · D {stats.byMode.DRILL} · M {stats.byMode.MOCK}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>By mode</div>
        </div>
      </div>

      {entries.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          No sessions yet. Finish a Practice, Drill, or Mock Exam to see it here.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {entries.map((e) => (
            <div key={e.id} className="card">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{ fontWeight: 600 }}>
                    {MODE_LABEL[e.mode]}
                    {e.competenceId ? ` · ${e.competenceId}` : ''}
                  </div>
                  <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 2 }}>
                    {TRACK_LABELS[e.track]} · {formatDate(e.finishedAt)}
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div
                    style={{
                      fontWeight: 700,
                      color:
                        e.percent >= 80
                          ? 'var(--success)'
                          : e.percent >= 60
                            ? 'var(--accent)'
                            : 'var(--danger)'
                    }}
                  >
                    {e.percent}%
                  </div>
                  <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                    {e.correct}/{e.total} · {formatDuration(e.durationMs)}
                  </div>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {entries.length > 0 && (
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginTop: '1.25rem', color: 'var(--danger)' }}
          onClick={() => {
            if (confirm('Clear all history on this device?')) clear()
          }}
        >
          Clear History
        </button>
      )}
    </div>
  )
}
