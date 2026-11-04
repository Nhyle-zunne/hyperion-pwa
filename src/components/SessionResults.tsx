import { useMemo, useState, type ReactNode } from 'react'
import { usePracticeStore } from '../stores/practiceStore'
import { TRACK_LABELS } from '../lib/trackLabels'
import './SessionResults.css'

export default function SessionResults({ onTryAgain, onHistory, onHome, extraAction }: { onTryAgain: () => void; onHistory: () => void; onHome?: () => void; extraAction?: ReactNode }) {
  const { questions, answers, mode, track, bestStreak, score } = usePracticeStore()
  const summary = score()
  const [tab, setTab] = useState<'breakdown' | 'review'>('breakdown')
  const [competence, setCompetence] = useState('all')
  const [missedOnly, setMissedOnly] = useState(false)
  const groups = useMemo(() => {
    const result = new Map<string, { id: string; total: number; correct: number }>()
    for (const question of questions) {
      const group = result.get(question.competenceId) ?? { id: question.competenceId, total: 0, correct: 0 }
      group.total++
      if (answers[question.id]?.isCorrect) group.correct++
      result.set(group.id, group)
    }
    return [...result.values()]
  }, [questions, answers])
  const review = questions.map((question, index) => ({ question, index, answer: answers[question.id] }))
    .filter(({ question, answer }) => (competence === 'all' || question.competenceId === competence) && (!missedOnly || !answer?.isCorrect))
  const passed = summary.percent >= 70

  return <section className="screen session-results-screen" data-session-results aria-label="Session results">
    <header className="session-results-heading">
      <span className="results-eyebrow">{mode === 'MOCK' ? 'Examination results' : mode === 'DRILL' ? 'Practice drill results' : 'Practice results'}</span>
      <h1 className="page-title" tabIndex={-1}>{mode === 'MOCK' ? 'Mock Exam Results' : 'Results'}</h1>
      <p>{track ? TRACK_LABELS[track] : 'Review session'} · {questions.length} questions</p>
    </header>
    <div className={`results-score-card ${passed ? 'is-passed' : 'is-review-needed'}`}>
      <div className="results-score-meta"><strong>{passed ? '70% target met' : 'Below 70% target'}</strong><span>{summary.correct} / {summary.total} correct</span></div>
      <div className="results-score-line"><strong className="results-percentage">{summary.percent}%</strong><span>{passed ? 'COMPETENT' : 'NOT YET COMPETENT'}</span></div>
      <progress max={100} value={summary.percent} aria-label="Overall score" />
      {mode === 'DRILL' && <p className="results-streak">Best streak: {bestStreak}</p>}
    </div>
    <div role="tablist" aria-label="Result details" className="results-tabs" onKeyDown={event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      const next = event.key === 'Home' ? 'breakdown' : event.key === 'End' ? 'review' : tab === 'breakdown' ? 'review' : 'breakdown'
      setTab(next)
      event.currentTarget.querySelector<HTMLButtonElement>(`#results-${next}-tab`)?.focus()
    }}>
      <button type="button" role="tab" id="results-breakdown-tab" tabIndex={tab === 'breakdown' ? 0 : -1} aria-selected={tab === 'breakdown'} aria-controls="results-detail-panel" onClick={() => setTab('breakdown')}>Competence Breakdown</button>
      <button type="button" role="tab" id="results-review-tab" tabIndex={tab === 'review' ? 0 : -1} aria-selected={tab === 'review'} aria-controls="results-detail-panel" onClick={() => setTab('review')}>Question Review ({questions.length})</button>
    </div>
    <div role="tabpanel" id="results-detail-panel" aria-labelledby={tab === 'breakdown' ? 'results-breakdown-tab' : 'results-review-tab'}>
      {tab === 'breakdown' ? <>
        <h2 className="results-section-title">Competence evaluation · 70% target</h2>
        <div className="results-breakdown">{groups.map(group => {
          const percent = Math.round(group.correct / group.total * 100)
          return <button type="button" key={group.id} className={`results-competence-card ${percent >= 70 ? 'is-passed' : 'is-review-needed'}`} onClick={() => { setCompetence(group.id); setMissedOnly(false); setTab('review'); document.getElementById('results-review-tab')?.focus() }} aria-label={`Review ${group.id} questions`}>
            <div className="results-score-meta"><strong>{group.id}</strong><span>{percent >= 70 ? 'PASSED' : 'NEEDS REVIEW'}</span></div>
            <p>{group.correct} / {group.total} correct · {percent}%</p>
            <progress max={100} value={percent} aria-label={`${group.id} score`} />
            <span className="results-browse">Browse questions →</span>
          </button>
        })}</div>
      </> : <>
        <div className="results-review-filters"><label>Competence<select aria-label="Competence" value={competence} onChange={event => setCompetence(event.target.value)}><option value="all">All competences</option>{groups.map(group => <option key={group.id} value={group.id}>{group.id}</option>)}</select></label><button type="button" className="btn btn-outline" aria-pressed={missedOnly} onClick={() => setMissedOnly(value => !value)}>Missed only</button></div>
        <div className="results-question-list">{review.map(({ question, index, answer }) => <article key={question.id} className={`results-review-card ${answer?.isCorrect ? 'is-passed' : 'is-review-needed'}`}>
          <div className="results-score-meta"><strong>{question.competenceId} · Item {index + 1}</strong><span>{answer?.selectedIndex == null ? 'Unanswered' : answer.isCorrect ? 'Correct' : 'Incorrect'}</span></div>
          {question.topic && <p className="results-topic">{question.topic}</p>}
          <h3>{question.questionText}</h3>
          <ul className="results-options">{question.options.map((option, optionIndex) => <li key={optionIndex} className={optionIndex === question.correctAnswerIndex ? 'is-correct-option' : optionIndex === answer?.selectedIndex ? 'is-picked-option' : ''}><strong>{String.fromCharCode(65 + optionIndex)}.</strong><span>{option}{optionIndex === question.correctAnswerIndex && <small>Correct answer{optionIndex === answer?.selectedIndex ? ' · Your answer' : ''}</small>}{optionIndex === answer?.selectedIndex && optionIndex !== question.correctAnswerIndex && <small>Your answer</small>}</span></li>)}</ul>
          {question.explanation && <div className="results-explanation"><strong>Explanation &amp; rationale</strong><p>{question.explanation}</p></div>}
        </article>)}{review.length === 0 && <p className="card" role="status">No missed questions for this competence.</p>}</div>
      </>}
    </div>
    <div className="results-actions"><button type="button" className="btn btn-primary" onClick={onTryAgain}>{mode === 'MOCK' ? 'Return to Mock Exams' : 'Try Again'}</button>{extraAction}<button type="button" className="btn btn-outline" onClick={onHistory}>View History</button>{onHome && <button type="button" className="btn btn-outline" onClick={onHome}>Home</button>}</div>
  </section>
}
