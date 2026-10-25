import { useEffect, useState } from 'react'
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
    reset,
    saveProgress,
    restoreSavedProgress
  } = usePracticeStore()

  const [showExitDialog, setShowExitDialog] = useState(false)
  const [textScale, setTextScale] = useState(() => Number(localStorage.getItem('hyperion-question-text-scale')) || 100)
  const [pendingAnswer, setPendingAnswer] = useState<number | null>(null)
  const [automations, setAutomations] = useState(() => { try { return JSON.parse(localStorage.getItem('hyperion-practice-automations') || '{"directAnswer":false,"autoNextCorrect":false,"autoNextWrong":false}') as {directAnswer:boolean;autoNextCorrect:boolean;autoNextWrong:boolean} } catch { return {directAnswer:false,autoNextCorrect:false,autoNextWrong:false} } })
  useEffect(() => { const settings = (e: Event) => setAutomations((e as CustomEvent).detail); const scale = (e: Event) => setTextScale((e as CustomEvent<number>).detail); window.addEventListener('hyperion:practice-settings', settings); window.addEventListener('hyperion:text-scale', scale); return () => { window.removeEventListener('hyperion:practice-settings', settings); window.removeEventListener('hyperion:text-scale', scale) } }, [])
  const [automations, setAutomations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hyperion-practice-automations') || '{"directAnswer":false,"autoNextCorrect":false,"autoNextWrong":false}') as { directAnswer: boolean; autoNextCorrect: boolean; autoNextWrong: boolean } }
    catch { return { directAnswer: false, autoNextCorrect: false, autoNextWrong: false } }
  })
  const updateAutomation = (key: 'directAnswer' | 'autoNextCorrect' | 'autoNextWrong', value: boolean) => {
    setAutomations((old) => {
      const updated = { ...old, [key]: value }
      localStorage.setItem('hyperion-practice-automations', JSON.stringify(updated))
      return updated
    })
  }

  useEffect(() => {
    if (questions.length === 0) restoreSavedProgress()
  }, [])

  useEffect(() => {
    const requestExit = () => setShowExitDialog(true)
    window.addEventListener('hyperion:request-exit-practice', requestExit)
    const trapBack = () => {
      window.history.pushState({ hyperionPractice: true }, '')
      setShowExitDialog(true)
    }
    window.history.pushState({ hyperionPractice: true }, '')
    window.addEventListener('popstate', trapBack)
    return () => {
      window.removeEventListener('hyperion:request-exit-practice', requestExit)
      window.removeEventListener('popstate', trapBack)
    }
  }, [])
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
  const confirmAnswer = () => { if (pendingAnswer != null) { selectAnswer(pendingAnswer); setPendingAnswer(null) } }
  const showFeedback = mode !== 'MOCK' && hasAnswered
  const bookmarked = isBookmarked(q.id)

  return (
    <div className="screen" style={{ paddingBottom: "6rem", fontSize: `${textScale}%` }}>
      {showExitDialog && (
        <div className="exit-dialog-backdrop" role="presentation">
          <section className="exit-dialog" role="dialog" aria-modal="true" aria-labelledby="exit-practice-title">
            <h2 id="exit-practice-title">Save your progress?</h2>
            <p>Your current question and answers will be saved so you can continue reviewing later.</p>
            <button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => { saveProgress(); setShowExitDialog(false); navigate('/practice') }}>Save Progress &amp; Exit</button>
            <button className="btn btn-outline" style={{ width: '100%', marginTop: 8 }} onClick={() => setShowExitDialog(false)}>Continue Reviewing</button>
          </section>
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1rem', fontSize: '0.85rem', color: 'var(--text-muted)' }}>
        <span>Q {currentIndex + 1} / {questions.length}</span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
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
                if (mode === 'MOCK') selectAnswer(idx); else if (!hasAnswered) { if (automations.directAnswer) selectAnswer(idx); else setPendingAnswer(idx) }
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

      {!hasAnswered && pendingAnswer != null && mode !== 'MOCK' && !automations.directAnswer && <button className="btn btn-primary" style={{ width: '100%', marginTop: '1rem' }} onClick={confirmAnswer}>Check Answer</button>}

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
          onClick={() => { if (hasAnswered && (automations.autoNextCorrect && answer?.isCorrect || automations.autoNextWrong && answer && !answer.isCorrect)) { next(); return } next() }}
          disabled={mode !== 'MOCK' && (!hasAnswered || (pendingAnswer != null))}
        >
          {hasAnswered ? (currentIndex === questions.length - 1 ? 'Finish' : 'Next') : 'Next'}
        </button>
      </div>
    </div>
  )
}
