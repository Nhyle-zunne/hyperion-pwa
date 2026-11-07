import React from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter, useNavigate } from 'react-router-dom'
import PracticeQuizScreen from '../../src/screens/PracticeQuizScreen'
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
function makeQuestion(track: TrackId, id: string, text: string): Question {
  return {
    id, track, functionId: track === 'DECK_OIC_NW' ? 'F1' : 'GMDSS',
    competenceId: 'C1', topic: 'Refresh regression',
    questionText: text,
    options: ['Port', 'Starboard'], correctAnswerIndex: 0,
    explanation: 'Synthetic fixture only.', difficulty: 'EASY'
  }
}
function makeSnapshot(id: string, track: TrackId, competenceId: string | null, text: string): SessionSnapshot {
  return {
    sessionId: id,
    questions: [makeQuestion(track, 'recovery-fixture-' + id, text)],
    answers: {}, currentIndex: 0, track, competenceId, part: null,
    mode: 'PRACTICE', isFreeSession: false, startedAt: Date.now(),
    timeLimitSec: 0, timeLeftSec: 0, streak: 0, bestStreak: 0, finished: false, source: null
  }
}
function Fixture() {
  const navigate = useNavigate()
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
  return <div>
    <button type="button" onClick={() => { void seed() }}>Start OIC-NW C1 fixture</button>
    <PracticeQuizScreen />
  </div>
}
createRoot(document.getElementById('root')!).render(
  <BrowserRouter><Fixture /></BrowserRouter>
)
