import { startLearningProgressSync } from '../../src/lib/progressSync'
import { saveSessionSnapshot, getSessionSnapshot, loadSessionSnapshot, syncSessionArchives } from '../../src/lib/sessionArchive'
import { fixtureUsers, fixtureCalls, fixturePauseArchives, fixtureReleaseArchives, fixtureSetUser, fixtureHoldNextRead, fixtureReleaseRead } from './recovery-supabase-fixture'
import { recoveryQuestions } from './recovery-bank-fixture'
import { useHistoryStore } from '../../src/stores/historyStore'

let stop: () => void = () => {}
const snapshot = (sessionId: string) => ({ sessionId, questions: [recoveryQuestions[0]], answers: {}, currentIndex: 0, track: 'DECK_OIC_NW' as const, competenceId: 'C1', part: null, mode: 'PRACTICE' as const, startedAt: Date.now(), timeLimitSec: 0, timeLeftSec: 0, streak: 0, bestStreak: 0, finished: true })
Object.assign(window, { syncFixture: {
  calls: fixtureCalls, users: fixtureUsers,
  holdRead: fixtureHoldNextRead, releaseRead: fixtureReleaseRead, restart: () => { stop(); stop = startLearningProgressSync() },
  pause: fixturePauseArchives, release: fixtureReleaseArchives, switchUser: fixtureSetUser,
  seed: async (prefix: string, count: number) => {
    const ids = Array.from({ length: count }, (_, i) => prefix + i)
    for (const id of ids) await saveSessionSnapshot(id, snapshot(id))
    return ids
  },
  upload: (ids: string[]) => syncSessionArchives(localStorage.getItem('hyperion-progress-owner')!, ids),
  local: (id: string) => getSessionSnapshot(id, true),
  download: loadSessionSnapshot,
  seedCloud: (id: string) => localStorage.setItem(`fixture-archive:${localStorage.getItem('hyperion-progress-owner')}:${id}`, JSON.stringify(snapshot(id))),
  history: () => useHistoryStore.getState(),
} })
stop = startLearningProgressSync()
