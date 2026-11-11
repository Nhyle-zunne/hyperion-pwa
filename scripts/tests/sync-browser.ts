import { localProgressReady } from '../../src/lib/localProgressIdentity'
import { startLearningProgressSync } from '../../src/lib/progressSync'
import { saveSessionSnapshot, getSessionSnapshot, loadSessionSnapshot, syncSessionArchives } from '../../src/lib/sessionArchive'
import { fixtureUsers, fixtureCalls, fixturePauseArchives, fixtureReleaseArchives, fixtureSetUser, fixtureHoldNextRead, fixtureReleaseRead, fixtureHoldRecovery, fixtureReleaseRecovery } from './recovery-supabase-fixture'
import { recoveryQuestions } from './recovery-bank-fixture'
import { useBookmarksStore } from '../../src/stores/bookmarksStore'
import { usePracticeStore } from '../../src/stores/practiceStore'
import { useLicenseStore } from '../../src/stores/licenseStore'
import { useHistoryStore } from '../../src/stores/historyStore'

const grant = (enabled: boolean, owner = localStorage.getItem('fixture-user') || fixtureUsers.a) => useLicenseStore.setState({ entitlementsVerified: true, cloudSyncVerified: true, entitlementUserId: owner, cloudSyncExpiresAt: enabled ? Date.now()+3600000 : 0, cloudTrackIds: enabled ? ['DECK_OIC_NW'] : [], isAllAccessUnlocked: false })
useLicenseStore.setState({refreshCloudEntitlements: async () => {grant(localStorage.getItem('fixture-license') !== 'free')}, refreshCachedEntitlements: async () => {}})
grant(localStorage.getItem('fixture-license') !== 'free')
let stop: () => void = () => {}
const snapshot = (sessionId: string) => ({ sessionId, questions: [recoveryQuestions[0]], answers: {}, currentIndex: 0, track: 'DECK_OIC_NW' as const, competenceId: 'C1', part: null, mode: 'PRACTICE' as const, startedAt: Date.now(), timeLimitSec: 0, timeLeftSec: 0, streak: 0, bestStreak: 0, finished: true })
const archiveEvents: {id: string; ownerId: string | null}[] = []
window.addEventListener('hyperion:session-archive-saved', event => archiveEvents.push((event as CustomEvent<{id: string; ownerId: string | null}>).detail))
Object.assign(window, { syncFixture: {
  ready: localProgressReady,
  calls: fixtureCalls, users: fixtureUsers,
  archiveEvents,
  saveDraft: (id: string, answer: number) => saveSessionSnapshot(id, {
    ...snapshot(id), startedAt: 1_700_000_000_000, finished: false,
    currentIndex: answer, answers: { [recoveryQuestions[0].id]: { questionId: recoveryQuestions[0].id, selectedIndex: answer, isCorrect: answer === 1, isFlagged: false } }
  }),
  holdRecovery: fixtureHoldRecovery, releaseRecovery: fixtureReleaseRecovery,
  holdRead: fixtureHoldNextRead, releaseRead: fixtureReleaseRead, restart: () => { stop(); stop = startLearningProgressSync() },
  pause: fixturePauseArchives, release: fixtureReleaseArchives,
  license: (enabled: boolean) => { localStorage.setItem('fixture-license', enabled ? 'paid' : 'free'); grant(enabled) },
  switchUser: (id: string | null) => { fixtureSetUser(id); useLicenseStore.setState({refreshCloudEntitlements: async () => {grant(localStorage.getItem('fixture-license') !== 'free')}, refreshCachedEntitlements: async () => {}})
grant(localStorage.getItem('fixture-license') !== 'free' && id !== null, id || undefined) },
  study: (id: string) => useHistoryStore.getState().addEntry({id, mode:'PRACTICE',track:'DECK_OIC_NW',competenceId:'C1',isFreeSession:true,correct:1,total:1,percent:100,durationMs:1000,startedAt:10,finishedAt:20}),
  addBookmark: () => useBookmarksStore.getState().toggle(recoveryQuestions[2]),
  bookmarks: () => useBookmarksStore.getState().items.map(x=>x.id),
  seedUnowned: async () => { const owner=localStorage.getItem('hyperion-progress-owner');localStorage.removeItem('hyperion-progress-owner');await saveSessionSnapshot('unclaimed-private',snapshot('unclaimed-private'));if(owner)localStorage.setItem('hyperion-progress-owner',owner);return 'unclaimed-private' },
  seed: async (prefix: string, count: number) => {
    // This fixture tests *explicit* archive batch transport and retry.
    // Avoid auto-cloud-uploading 23 synthetic already-finished sessions before
    // the test invokes upload() and checks its bounded ten-item batches.
    // Production still emits completion events and flushes immediately.
    const ids = Array.from({ length: count }, (_, i) => prefix + i)
    const dispatch = window.dispatchEvent.bind(window)
    window.dispatchEvent = ((event: Event) => event.type === 'hyperion:session-archive-saved'
      ? true : dispatch(event)) as typeof window.dispatchEvent
    try {
      for (const id of ids) await saveSessionSnapshot(id, snapshot(id))
      return ids
    } finally {
      window.dispatchEvent = dispatch
    }
  },
  upload: (ids: string[]) => syncSessionArchives(localStorage.getItem('hyperion-progress-owner')!, ids),
  local: (id: string) => getSessionSnapshot(id, true),
  download: loadSessionSnapshot,
  seedCloud: (id: string) => localStorage.setItem(`fixture-archive:${localStorage.getItem('hyperion-progress-owner')}:${id}`, JSON.stringify(snapshot(id))),
  startFree: async () => { await usePracticeStore.getState().startCustomSession({questions:[recoveryQuestions[0]],track:'DECK_OIC_NW',competenceId:'C1',randomizeOrder:false});usePracticeStore.getState().selectAnswer(1);await usePracticeStore.getState().saveProgress();return usePracticeStore.getState().sessionId },
  resume: (id: string) => usePracticeStore.getState().restoreSavedProgress(id),
  practice: () => usePracticeStore.getState(),
  history: () => useHistoryStore.getState(),
} })
stop = startLearningProgressSync()
