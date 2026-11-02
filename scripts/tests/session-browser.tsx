import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { registerSW } from 'virtual:pwa-register'
import SessionElapsedTimer from '../../src/components/SessionElapsedTimer'
import QuestionBookmarkButton from '../../src/components/QuestionBookmarkButton'
import type { Question } from '../../src/types/question'
registerSW({ immediate: true })
function Fixture() {
  const [startedAt, setStartedAt] = useState(() => Date.now() - 65000)
  const [questionNumber, setQuestionNumber] = useState(1)
  return <main>
    <SessionElapsedTimer startedAt={startedAt} />
    <button onClick={() => setQuestionNumber(old => old + 1)}>Next question</button>
    <p>Current question {questionNumber}</p>
    <button onClick={() => setStartedAt(Date.now() - 3661000)}>Resume saved session</button>
    <button onClick={() => setStartedAt(Date.now())}>New session</button>
    {[1, 2].map(index => {
      const question: Question = { id: `session-test-${index}`, track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1', topic: 'Fixture', questionText: `Synthetic question ${index}`, options: ['A', 'B'], correctAnswerIndex: 0, explanation: 'Fixture only', difficulty: 'EASY' }
      return <section key={question.id} aria-label={`Question ${index}`}><p>{question.questionText}</p><QuestionBookmarkButton question={question} questionNumber={index} paidAtSave={false} /></section>
    })}
  </main>
}
createRoot(document.getElementById('root')!).render(<React.StrictMode><Fixture /></React.StrictMode>)
