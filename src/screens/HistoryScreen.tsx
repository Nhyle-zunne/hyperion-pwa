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
  const savedSessions = useHistoryStore((s) => s.savedSessions)
  const clear = useHistoryStore((s) => s.clear)

  const totalSessions = entries.length
  const avgPercent =
    totalSessions === 0
      ? 0
      : Math.round(entries.reduce((a, e) => a + e.percent, 0) / totalSessions)
  const bestPercent = totalSessions === 0 ? 0 : Math.max(...entries.map((e) => e.percent))
  const byMode = { PRACTICE: 0, DRILL: 0, MOCK: 0 }
  for (const e of entries) byMode[e.mode]++

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
            {totalSessions}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Sessions</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--accent)' }}>
            {avgPercent}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Avg score</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '1.5rem', fontWeight: 700, color: 'var(--success)' }}>
            {bestPercent}%
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>Best</div>
        </div>
        <div className="card" style={{ textAlign: 'center' }}>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
            P {byMode.PRACTICE} · D {byMode.DRILL} · M {byMode.MOCK}
          </div>
          <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>By mode</div>
        </div>
      </div>

      {savedSessions.length > 0 && (
        <section style={{ marginBottom: '1.25rem' }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 900, marginBottom: '.65rem' }}>Saved sessions · Resume</h2>
          <div style={{ display: 'grid', gap: '.6rem' }}>
            {savedSessions.map((session) => (
              <div key={session.id} className="card">
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                  <div>
                    <div style={{ fontWeight: 800 }}>{MODE_LABEL[session.mode]} · {session.competenceId || 'All competences'}</div>
                    <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 3 }}>{TRACK_LABELS[session.track]} · Saved {formatDate(session.savedAt)}</div>
                    <div style={{ fontSize: '.8rem', color: 'var(--text-muted)', marginTop: 3 }}>Question {Math.min(session.currentIndex + 1, session.total)} of {session.total} · {session.answered} answered</div>
                  </div>
                  <button className="btn btn-primary" type="button" onClick={() => navigate('/practice/quiz')}>Resume</button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {entries.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          No completed sessions yet. Finish a Practice, Drill, or Mock Exam to see results here.
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
