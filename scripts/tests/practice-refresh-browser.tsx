import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate, useLocation } from 'react-router-dom'
import PracticeQuizScreen from '../../src/screens/PracticeQuizScreen'
import { MockExamRunner } from '../../src/screens/MockExamScreen'
import { listAvailableCompetences } from '../../src/lib/questionBank'
import type { SessionMode } from '../../src/stores/historyStore'
import { usePracticeStore } from '../../src/stores/practiceStore'
import { useHistoryStore } from '../../src/stores/historyStore'
import { useLicenseStore } from '../../src/stores/licenseStore'
import { markLocalProgressReady, setLocalProgressIdentity } from '../../src/lib/localProgressIdentity'
import { saveSessionSnapshot, type SessionSnapshot } from '../../src/lib/sessionArchive'
import type { Question, TrackId } from '../../src/types/question'
import '../../src/index.css'

const oicId = 'refresh-oic-c1', gmdssId = 'refresh-gmdss-all'
setLocalProgressIdentity(null)
markLocalProgressReady(null)
useLicenseStore.setState({
  entitlementsVerified: true,
  isAllAccessUnlocked: true,
  cloudTrackIds: ['ALL'],
  refreshCloudEntitlements: async () => {}
})
function makeQuestion(track: TrackId, id: string, text: string, competenceId = 'C1'): Question {
  return {
    id, track, functionId: track === 'DECK_OIC_NW' ? 'F1' : 'GMDSS',
    competenceId, topic: 'Refresh regression',
    questionText: text,
    options: ['Port', 'Starboard'], correctAnswerIndex: 0,
    explanation: 'Synthetic fixture only.', difficulty: 'EASY'
  }
}
function makeSnapshot(id: string, track: TrackId, competenceId: string | null, text: string, mode: SessionMode = 'PRACTICE', part: number | null = null, free = false): SessionSnapshot {
  return {
    sessionId: id,
    questions: [makeQuestion(track, 'recovery-fixture-' + id, text, competenceId ?? 'C1')],
    answers: {}, currentIndex: 0, track, competenceId, part,
    mode, isFreeSession: free, startedAt: Date.now(),
    timeLimitSec: mode === 'MOCK' ? 3600 : 0, timeLeftSec: mode === 'MOCK' ? 3600 : 0,
    streak: 0, bestStreak: 0, finished: false, source: null
  }
}
const matrixTracks: TrackId[] = ['DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC']
type MatrixCase = { id: string; track: TrackId; competenceId: string; part: number | null; mode: SessionMode; free: boolean; text: string }
const cases: MatrixCase[] = []
for (const track of matrixTracks) {
  const competences = listAvailableCompetences(track)
  for (const competence of competences) {
    cases.push({ id: 'matrix-' + cases.length, track, competenceId: competence.id, part: null,
      mode: 'PRACTICE', free: false, text: 'Matrix ' + track + ' ' + competence.id + ' practice question?' })
  }
  const first = competences[0], last = competences[competences.length - 1]
  cases.push({ id: 'matrix-' + cases.length, track, competenceId: first.id, part: null,
    mode: 'PRACTICE', free: true, text: 'Matrix ' + track + ' free reviewer question?' })
  cases.push({ id: 'matrix-' + cases.length, track, competenceId: first.id, part: null,
    mode: 'DRILL', free: false, text: 'Matrix ' + track + ' drill question?' })
  cases.push({ id: 'matrix-' + cases.length, track, competenceId: last.id, part: null,
    mode: 'MOCK', free: false, text: 'Matrix ' + track + ' mock exam question?' })
}
for (const [competenceId, part] of [['C1', 1], ['C1', 2], ['C1', 10], ['C2', 1], ['C2', 2]] as const) {
  cases.push({ id: 'matrix-' + cases.length, track: 'GMDSS_GOC', competenceId, part,
    mode: 'PRACTICE', free: false, text: 'Matrix GMDSS ' + competenceId + ' part ' + part + ' question?' })
}
async function seedMatrix() {
  for (const item of cases) {
    const snapshot = makeSnapshot(item.id, item.track, item.competenceId, item.text, item.mode, item.part, item.free)
    await saveSessionSnapshot(item.id, snapshot)
    useHistoryStore.getState().saveSession({
      id: item.id, mode: item.mode, track: item.track, competenceId: item.competenceId,
      part: item.part, isFreeSession: item.free, currentIndex: 0,
      total: 1, answered: 0, correct: 0, startedAt: snapshot.startedAt,
      savedAt: Date.now() + cases.length
    })
  }
  // Deliberately corrupt one History pointer while leaving its encrypted
  // question snapshot intact. A mismatch must never display another competence.
  const mismatchId = 'matrix-history-mismatch'
  const mismatch = makeSnapshot(mismatchId, 'DECK_OIC_NW', 'C1', 'Mismatched record must never be shown?')
  await saveSessionSnapshot(mismatchId, mismatch)
  useHistoryStore.getState().saveSession({
    id: mismatchId, mode: 'PRACTICE', track: 'GMDSS_GOC', competenceId: 'C2',
    part: null, isFreeSession: false, currentIndex: 0, total: 1, answered: 0,
    correct: 0, startedAt: mismatch.startedAt, savedAt: Date.now() + cases.length + 1
  })
}
Object.assign(window, { practiceRefreshMatrix: { cases, seed: seedMatrix } })

function Fixture() {
  const navigate = useNavigate()
  const location = useLocation()
  const isMock = new URLSearchParams(location.search).get('runner') === 'mock'
  const seed = async () => {
    const oic = makeSnapshot(oicId, 'DECK_OIC_NW', 'C1', 'OIC NW C1 refresh test question?')
    const gmdss = makeSnapshot(gmdssId, 'GMDSS_GOC', null, 'GMDSS all questions wrong-track fixture?')
    await saveSessionSnapshot(oicId, oic)
    await saveSessionSnapshot(gmdssId, gmdss)
    const history = useHistoryStore.getState()
    const record = (snapshot: SessionSnapshot, savedAt: number) => history.saveSession({
      id: snapshot.sessionId, mode: snapshot.mode, track: snapshot.track,
      competenceId: snapshot.competenceId, part: null,
      isFreeSession: false, currentIndex: 0, total: 1, answered: 0, correct: 0,
      startedAt: snapshot.startedAt, savedAt
    })
    record(oic, Date.now() - 10000)
    record(gmdss, Date.now())
    usePracticeStore.setState({
      ...oic, source: null, loading: false, error: null,
      finishing: false, completionError: null
    })
    navigate('/scripts/tests/practice-refresh-browser.html?resume=' + encodeURIComponent(oicId))
  }
  // Match the production route wrapper. Its entry animation must never
  // become the containing block for fixed quiz overlays or navigation.
  return <div className="route-transition">
    <button type="button" onClick={() => { void seed() }}>Start OIC-NW C1 fixture</button>
    {isMock ? <MockExamRunner /> : <PracticeQuizScreen />}
  </div>
}
createRoot(document.getElementById('root')!).render(
  <BrowserRouter><Fixture /></BrowserRouter>
)
