import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import PracticeQuizScreen from '../../src/screens/PracticeQuizScreen'
import ResultsProcessing from '../../src/components/ResultsProcessing'
import { showResultsProcessing } from '../../src/components/ResultsProcessing'
import { MockExamRunner } from '../../src/screens/MockExamScreen'
import { usePracticeStore } from '../../src/stores/practiceStore'
import { useHistoryStore } from '../../src/stores/historyStore'
import { getSessionSnapshot } from '../../src/lib/sessionArchive'
import { setLocalProgressIdentity, markLocalProgressReady } from '../../src/lib/localProgressIdentity'
import type { Question } from '../../src/types/question'
import '../../src/index.css'

const requested = new URLSearchParams(location.search).get('mode')
const managed = new URLSearchParams(location.search).has('managed')
const mode = requested === 'DRILL' || requested === 'MOCK' ? requested : 'PRACTICE'
const sessionId = `results-${mode}-${crypto.randomUUID()}`
const questions: Question[] = [0, 1, 2].map(index => ({ id: `results-${index}`, track: 'DECK_OIC_NW', functionId: 'F1', competenceId: index < 2 ? 'C1' : 'C2', topic: 'Synthetic topic', questionText: `Synthetic question ${index + 1}?`, options: ['Port', 'Starboard'], correctAnswerIndex: 0, explanation: `Synthetic explanation ${index + 1}.`, difficulty: index === 0 ? 'EASY' : index === 1 ? 'MODERATE' : 'DIFFICULT' }))
setLocalProgressIdentity(null)
markLocalProgressReady(null)
if (managed) {
  questions.forEach(question => { question.competenceId = 'C1' })
  localStorage.setItem('hyperion-mock-exam-plan-v1', JSON.stringify({ trackId: 'DECK_OIC_NW', trackParam: 'oic_nw', selectedFunctions: ['F1'], startedAt: Date.now(), status: 'in_progress', results: {} }))
}
usePracticeStore.setState({ sessionId, mode, track: 'DECK_OIC_NW', competenceId: null, questions, answers: { 'results-0': { questionId: 'results-0', selectedIndex: 0, isCorrect: true, isFlagged: false }, 'results-1': { questionId: 'results-1', selectedIndex: 1, isCorrect: false, isFlagged: false } }, currentIndex: 2, loading: false, error: null, finished: false, finishing: false, completionError: null, isFreeSession: true, startedAt: Date.now() - 30000, timeLeftSec: 3600, timeLimitSec: 3600, bestStreak: 1 })
if (managed) usePracticeStore.setState({ competenceId: 'C1' })
Object.assign(window, { resultsFixture: { finish: () => { usePracticeStore.getState().finish(); usePracticeStore.getState().finish() }, presentOverallMock: showResultsProcessing, reset: () => usePracticeStore.getState().reset(), state: () => ({ finished: usePracticeStore.getState().finished, finishing: usePracticeStore.getState().finishing, error: usePracticeStore.getState().completionError, score: usePracticeStore.getState().score() }), history: () => useHistoryStore.getState().entries, snapshot: () => getSessionSnapshot(sessionId, true) } })
function Controls() {
  const error = usePracticeStore(state => state.completionError)
  return <><button onClick={() => usePracticeStore.getState().finish()}>Finish fixture session</button>{error && <div role="alert">{error}<button onClick={() => usePracticeStore.getState().finish()}>Retry saving completed session</button></div>}</>
}
document.documentElement.dataset.theme = 'light'
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[mode === 'MOCK' ? '/mock/exam' : '/practice/quiz']}>
  <Controls />
  <ResultsProcessing />
  <Routes><Route path="/practice/quiz" element={<PracticeQuizScreen />} /><Route path="/mock/exam" element={<MockExamRunner />} /><Route path="*" element={<p>Fixture destination</p>} /></Routes>
</MemoryRouter>)
