import { useEffect } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { usePracticeStore } from '../stores/practiceStore'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

/** Official-ish sizes for demo (full banks later) */
const MOCK_SIZE: Record<TrackId, number> = {
  DECK_OIC_NW: 30,
  GMDSS_GOC: 25,
  ENGINE_OIC_EW: 30,
  DECK_MGT: 30,
  ENGINE_MGT: 30
}

export default function MockExamScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'

  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const startSession = usePracticeStore((s) => s.startSession)

  const size = MOCK_SIZE[trackId]
  // 90 seconds per question for demo pacing
  const timeLimitSec = size * 90

  const start = async () => {
    if (!isUnlocked) {
      openPaywall('Mock Exam')
      return
    }
    await startSession({
      mode: 'MOCK',
      track: trackId,
      limit: size,
      timeLimitSec
    })
    navigate('/mock/exam')
  }

  return (
    <div className="screen">
      <button
        onClick={() => navigate('/')}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Home
      </button>

      <h1 className="page-title">Mock Exam</h1>
      <p className="subtitle">Timed exam · no instant feedback · question palette</p>

      {!isUnlocked && (
        <div
          className="card"
          style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          Activate a key to unlock mock exams.
        </div>
      )}

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontWeight: 600, marginBottom: 8 }}>{TRACK_LABELS[trackId]}</div>
        <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.6 }}>
          <div>Questions: {size}</div>
          <div>
            Time limit: {Math.floor(timeLimitSec / 60)} min
          </div>
          <div>Answers locked until submit · flag questions for review</div>
        </div>
      </div>

      <button className="btn btn-primary" style={{ width: '100%', marginBottom: 12 }} onClick={start}>
        Start Mock Exam
      </button>

      <div style={{ marginTop: '0.5rem' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Track</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {Object.entries(TRACK_MAP).map(([key, id]) => (
            <button
              key={key}
              className="btn btn-outline"
              style={{
                padding: '0.4rem 0.7rem',
                fontSize: '0.8rem',
                borderColor: trackId === id ? 'var(--accent)' : undefined,
                color: trackId === id ? 'var(--accent)' : undefined
              }}
              onClick={() => navigate(`/mock?track=${key}`)}
            >
              {TRACK_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

export function MockExamRunner() {
  const navigate = useNavigate()
  const {
    questions,
    currentIndex,
    answers,
    loading,
    error,
    finished,
    timeLeftSec,
    selectAnswer,
    toggleFlag,
    goTo,
    finish,
    tick,
    score,
    reset
  } = usePracticeStore()

  useEffect(() => {
    if (finished || questions.length === 0) return
    const id = setInterval(() => tick(), 1000)
    return () => clearInterval(id)
  }, [finished, questions.length, tick])

  if (loading) {
    return (
      <div className="screen">
        <p>Preparing exam…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="screen">
        <p style={{ color: 'var(--danger)' }}>{error}</p>
        <button className="btn btn-outline" onClick={() => navigate('/mock')}>
          Back
        </button>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="screen">
        <p>No exam active.</p>
        <button className="btn btn-primary" onClick={() => navigate('/mock')}>
          Mock Hub
        </button>
      </div>
    )
  }

  if (finished) {
    const s = score()
    return (
      <div className="screen">
        <h1 className="page-title">Exam Results</h1>
        <div className="card" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent)' }}>
            {s.percent}%
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            {s.correct} / {s.total} correct
          </div>
        </div>

        <div className="card" style={{ marginBottom: '1rem', maxHeight: 280, overflow: 'auto' }}>
          {questions.map((q, i) => {
            const a = answers[q.id]
            const ok = a?.isCorrect
            return (
              <div
                key={q.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  padding: '0.4rem 0',
                  borderBottom: '1px solid var(--border)',
                  fontSize: '0.85rem'
                }}
              >
                <span>
                  Q{i + 1} · {q.competenceId}
                </span>
                <span style={{ color: ok ? 'var(--success)' : 'var(--danger)' }}>
                  {a?.selectedIndex == null ? 'Blank' : ok ? 'Correct' : 'Wrong'}
                </span>
              </div>
            )
          })}
        </div>

        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => {
            reset()
            navigate('/mock')
          }}
        >
          New Exam
        </button>
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => {
            reset()
            navigate('/history')
          }}
        >
          History
        </button>
        <button
          className="btn btn-outline"
          style={{ width: '100%' }}
          onClick={() => {
            reset()
            navigate('/')
          }}
        >
          Home
        </button>
      </div>
    )
  }

  const q = questions[currentIndex]
  const answer = answers[q.id]
  const answeredCount = questions.filter((qq) => answers[qq.id]?.selectedIndex != null).length
  const mins = Math.floor(timeLeftSec / 60)
  const secs = timeLeftSec % 60
  const timeWarn = timeLeftSec < 120

  return (
    <div className="screen" style={{ paddingBottom: '7.5rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '0.75rem',
          fontSize: '0.9rem'
        }}
      >
        <span style={{ color: 'var(--text-muted)' }}>
          Q {currentIndex + 1} / {questions.length} · {answeredCount} answered
        </span>
        <span
          style={{
            fontWeight: 700,
            fontVariantNumeric: 'tabular-nums',
            color: timeWarn ? 'var(--danger)' : 'var(--accent)'
          }}
        >
          {String(mins).padStart(2, '0')}:{String(secs).padStart(2, '0')}
        </span>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          {q.competenceId} · {q.topic}
        </div>
        <div style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>{q.questionText}</div>
      </div>

      <div style={{ display: 'grid', gap: '0.6rem', marginBottom: '1rem' }}>
        {q.options.map((opt, idx) => {
          const selected = answer?.selectedIndex === idx
          return (
            <button
              key={idx}
              onClick={() => selectAnswer(idx)}
              style={{
                textAlign: 'left',
                padding: '0.9rem 1rem',
                borderRadius: 10,
                border: `1px solid ${selected ? 'var(--accent)' : 'var(--border)'}`,
                background: selected ? 'rgba(56,189,248,0.12)' : 'var(--bg-card)',
                color: 'var(--text)',
                fontSize: '0.95rem'
              }}
            >
              <span style={{ fontWeight: 600, marginRight: 8 }}>
                {String.fromCharCode(65 + idx)}.
              </span>
              {opt}
            </button>
          )
        })}
      </div>

      <button
        className="btn btn-outline"
        style={{ width: '100%', marginBottom: '0.75rem', fontSize: '0.85rem' }}
        onClick={toggleFlag}
      >
        {answer?.isFlagged ? '★ Flagged for review' : '☆ Flag for review'}
      </button>

      {/* Palette */}
      <div
        style={{
          display: 'flex',
          flexWrap: 'wrap',
          gap: 6,
          marginBottom: '1rem'
        }}
      >
        {questions.map((qq, i) => {
          const a = answers[qq.id]
          let bg = 'var(--bg-elevated)'
          let border = 'var(--border)'
          if (i === currentIndex) border = 'var(--accent)'
          if (a?.selectedIndex != null) bg = 'rgba(56,189,248,0.2)'
          if (a?.isFlagged) border = 'var(--warning)'
          return (
            <button
              key={qq.id}
              onClick={() => goTo(i)}
              style={{
                width: 32,
                height: 32,
                borderRadius: 6,
                border: `1px solid ${border}`,
                background: bg,
                color: 'var(--text)',
                fontSize: '0.75rem',
                fontWeight: 600
              }}
            >
              {i + 1}
            </button>
          )
        })}
      </div>

      <div
        style={{
          position: 'fixed',
          bottom: 0,
          left: 0,
          right: 0,
          padding: '0.75rem 1rem calc(0.75rem + env(safe-area-inset-bottom))',
          background: 'var(--bg-card)',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          gap: '0.6rem',
          maxWidth: 720,
          margin: '0 auto'
        }}
      >
        <button
          className="btn btn-outline"
          style={{ flex: 1 }}
          onClick={() => goTo(Math.max(0, currentIndex - 1))}
          disabled={currentIndex === 0}
        >
          Prev
        </button>
        {currentIndex < questions.length - 1 ? (
          <button
            className="btn btn-primary"
            style={{ flex: 2 }}
            onClick={() => goTo(currentIndex + 1)}
          >
            Next
          </button>
        ) : (
          <button
            className="btn btn-primary"
            style={{ flex: 2 }}
            onClick={() => {
              if (confirm(`Submit exam? ${answeredCount}/${questions.length} answered.`)) {
                finish()
              }
            }}
          >
            Submit Exam
          </button>
        )}
      </div>
    </div>
  )
}
