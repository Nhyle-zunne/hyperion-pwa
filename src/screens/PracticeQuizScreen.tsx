import { useNavigate } from 'react-router-dom'
import { usePracticeStore } from '../stores/practiceStore'
import { useBookmarksStore } from '../stores/bookmarksStore'

export default function PracticeQuizScreen() {
  const navigate = useNavigate()
  const {
    questions,
    currentIndex,
    answers,
    loading,
    error,
    finished,
    mode,
    streak,
    bestStreak,
    selectAnswer,
    next,
    prev,
    score,
    reset
  } = usePracticeStore()
  const toggleBookmark = useBookmarksStore((s) => s.toggle)
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked)

  if (loading) {
    return (
      <div className="screen">
        <p>Loading questions…</p>
      </div>
    )
  }

  if (error) {
    return (
      <div className="screen">
        <p style={{ color: 'var(--danger)' }}>{error}</p>
        <button className="btn btn-outline" onClick={() => navigate(-1)}>
          Back
        </button>
      </div>
    )
  }

  if (questions.length === 0) {
    return (
      <div className="screen">
        <p>No session active.</p>
        <button className="btn btn-primary" onClick={() => navigate('/tracks')}>
          Select Track
        </button>
      </div>
    )
  }

  if (finished) {
    const s = score()
    return (
      <div className="screen">
        <h1 className="page-title">Results</h1>
        <div className="card" style={{ textAlign: 'center', marginBottom: '1.5rem' }}>
          <div style={{ fontSize: '2.5rem', fontWeight: 700, color: 'var(--accent)' }}>
            {s.percent}%
          </div>
          <div style={{ color: 'var(--text-muted)' }}>
            {s.correct} / {s.total} correct
          </div>
          {mode === 'DRILL' && (
            <div style={{ marginTop: 8, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Best streak: {bestStreak}
            </div>
          )}
        </div>
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => {
            reset()
            navigate(mode === 'DRILL' ? '/drill' : mode === 'MOCK' ? '/mock' : '/practice')
          }}
        >
          Try Again
        </button>
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginBottom: 8 }}
          onClick={() => {
            reset()
            navigate('/history')
          }}
        >
          View History
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
  const hasAnswered = answer?.selectedIndex != null
  const showFeedback = mode !== 'MOCK' && hasAnswered
  const bookmarked = isBookmarked(q.id)

  return (
    <div className="screen" style={{ paddingBottom: '6rem' }}>
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          marginBottom: '1rem',
          fontSize: '0.85rem',
          color: 'var(--text-muted)'
        }}
      >
        <span>
          Q {currentIndex + 1} / {questions.length}
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <button
            type="button"
            onClick={() => toggleBookmark(q)}
            style={{
              background: 'none',
              border: 'none',
              color: bookmarked ? 'var(--warning)' : 'var(--text-muted)',
              cursor: 'pointer',
              fontSize: '1rem'
            }}
            aria-label={bookmarked ? 'Remove bookmark' : 'Add bookmark'}
          >
            {bookmarked ? '★' : '☆'}
          </button>
          {mode === 'DRILL' && streak > 0 ? `Streak ${streak}` : null}
          {mode !== 'DRILL' ? `${q.competenceId} · ${q.difficulty}` : q.competenceId}
        </span>
      </div>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          {q.topic}
        </div>
        <div style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>{q.questionText}</div>
      </div>

      <div style={{ display: 'grid', gap: '0.6rem' }}>
        {q.options.map((opt, idx) => {
          let border = 'var(--border)'
          let bg = 'var(--bg-card)'
          if (showFeedback) {
            if (idx === q.correctAnswerIndex) {
              border = 'var(--success)'
              bg = 'rgba(34,197,94,0.12)'
            } else if (idx === answer!.selectedIndex && !answer!.isCorrect) {
              border = 'var(--danger)'
              bg = 'rgba(239,68,68,0.12)'
            }
          } else if (hasAnswered && idx === answer!.selectedIndex) {
            border = 'var(--accent)'
            bg = 'rgba(56,189,248,0.12)'
          }
          return (
            <button
              key={idx}
              onClick={() => {
                if (mode === 'MOCK' || !hasAnswered) selectAnswer(idx)
              }}
              disabled={mode !== 'MOCK' && hasAnswered}
              style={{
                textAlign: 'left',
                padding: '0.9rem 1rem',
                borderRadius: 10,
                border: `1px solid ${border}`,
                background: bg,
                color: 'var(--text)',
                fontSize: '0.95rem',
                cursor: mode !== 'MOCK' && hasAnswered ? 'default' : 'pointer'
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

      {showFeedback && q.explanation && (
        <div
          className="card"
          style={{ marginTop: '1rem', fontSize: '0.9rem', color: 'var(--text-muted)' }}
        >
          <strong style={{ color: 'var(--text)' }}>Explanation</strong>
          <p style={{ marginTop: 4 }}>{q.explanation}</p>
        </div>
      )}

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
        {mode !== 'DRILL' && (
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={prev}
            disabled={currentIndex === 0}
          >
            Prev
          </button>
        )}
        <button
          className="btn btn-primary"
          style={{ flex: 2 }}
          onClick={next}
          disabled={mode !== 'MOCK' && !hasAnswered}
        >
          {currentIndex === questions.length - 1 ? 'Finish' : 'Next'}
        </button>
      </div>
    </div>
  )
}
