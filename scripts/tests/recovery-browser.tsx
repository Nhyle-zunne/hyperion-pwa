import { getSessionSnapshot, saveSessionSnapshot, syncSessionArchives } from '../../src/lib/sessionArchive'
import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Link } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from '../../src/App'
import { useLicenseStore } from '../../src/stores/licenseStore'
import { useBookmarksStore } from '../../src/stores/bookmarksStore'
import { useVaultStore } from '../../src/stores/vaultStore'
import { useHistoryStore } from '../../src/stores/historyStore'
import { readEncryptedPersistedValue, writeEncryptedPersistedValue, recoverSavedCollections } from '../../src/lib/encryptedPersistStorage'
import { recoveryQuestions } from './recovery-bank-fixture'
import { fixtureUsers, fixtureCloud, fixtureSetUser, fixtureCalls } from './recovery-supabase-fixture'
import '../../src/index.css'
registerSW({ immediate: true })
const envelope = (items: unknown[]) => JSON.stringify({ state: { items }, version: 0 })
// These two stores are deliberately seeded through legacy localStorage before
// their automatic hydration completes, just as an older installed app upgrades.
// The runner's init script supplies the initial local and remote copies.
useLicenseStore.setState({ entitlementsVerified: true, cloudSyncVerified: true, entitlementUserId: localStorage.getItem('fixture-user') || fixtureUsers.a, cloudSyncExpiresAt: Infinity, isAllAccessUnlocked: true, cloudTrackIds: ['DECK_OIC_NW'], refreshCloudEntitlements: async () => { const state=useLicenseStore.getState();useLicenseStore.setState({cloudSyncVerified:true,entitlementUserId:localStorage.getItem('fixture-user')||fixtureUsers.a,cloudSyncExpiresAt:state.cloudTrackIds.length?Infinity:0}) }, refreshCachedEntitlements: async () => {} })
Object.assign(window, { recoveryFixture: {
  ids: () => ({ bookmarks: useBookmarksStore.getState().items.map(q => q.id), mistakes: useVaultStore.getState().items.map(q => q.id), owner: localStorage.getItem('hyperion-progress-owner') }),
  license: (enabled: boolean) => useLicenseStore.setState({ entitlementsVerified: true, cloudSyncVerified: true, entitlementUserId: localStorage.getItem('fixture-user') || fixtureUsers.a, cloudSyncExpiresAt: enabled ? Infinity : 0, isAllAccessUnlocked: enabled, cloudTrackIds: enabled ? ['DECK_OIC_NW'] : [] }),
  cloud: () => fixtureCloud(), users: fixtureUsers, calls: fixtureCalls,
  switchUser: (id: string) => { fixtureSetUser(id); useLicenseStore.setState({ entitlementUserId: id }) },
  addOffline: () => useBookmarksStore.getState().toggle(recoveryQuestions[3]),
  flush: () => readEncryptedPersistedValue('hyperion-bookmarks'),
  recover: async () => {
    await writeEncryptedPersistedValue('hyperion-bookmarks', envelope([]))
    await useBookmarksStore.persist.rehydrate()
    const count = await recoverSavedCollections(localStorage.getItem('hyperion-progress-owner'))
    await useBookmarksStore.persist.rehydrate()
    return count
  },
  recoverLegacy: async () => {
    localStorage.setItem('hyperion-bookmarks', envelope([{ ...recoveryQuestions[3], savedAt: Date.now() }]))
    await useBookmarksStore.persist.rehydrate()
    await recoverSavedCollections(localStorage.getItem('hyperion-progress-owner'))
    await useBookmarksStore.persist.rehydrate()
  },
  removeAndRecover: async (id: string) => {
    useBookmarksStore.getState().remove(id)
    await readEncryptedPersistedValue('hyperion-bookmarks')
    await recoverSavedCollections(localStorage.getItem('hyperion-progress-owner'))
    await useBookmarksStore.persist.rehydrate()
  },
  finished: () => useHistoryStore.getState().entries,
  delayedAutosave: async (id: string) => {
    const snapshot = await getSessionSnapshot(id, true)
    if (snapshot) {
      await saveSessionSnapshot(id, { ...snapshot, finished: false, answers: {} })
      await saveSessionSnapshot(id, { ...snapshot, finished: true, answers: {} })
    }
  },
  seedRetryArchives: async () => {
    const ids = ['retry-audit-1', 'retry-audit-2', 'retry-audit-3']
    for (const sessionId of ids) await saveSessionSnapshot(sessionId, { sessionId, questions: [recoveryQuestions[0]], answers: {}, currentIndex: 0, track: 'DECK_OIC_NW', competenceId: 'C1', part: null, mode: 'PRACTICE', startedAt: Date.now(), timeLimitSec: 0, timeLeftSec: 0, streak: 0, bestStreak: 0, finished: true })
    return ids
  },
  syncRetryArchives: async (ids: string[]) => syncSessionArchives(localStorage.getItem('hyperion-progress-owner')!, ids),
  localArchive: (id: string) => getSessionSnapshot(id, true),
  clearLocalArchives: async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => { const request = indexedDB.open('hyperion-session-archive'); request.onsuccess = () => resolve(request.result); request.onerror = () => reject(request.error) })
    await new Promise<void>((resolve, reject) => { const tx = db.transaction('snapshots', 'readwrite'); tx.objectStore('snapshots').clear(); tx.oncomplete = () => resolve(); tx.onerror = () => reject(tx.error) })
    db.close()
  }
} })
createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/bookmarks']}>
  <nav><Link to="/">Dashboard fixture</Link> · <Link to="/bookmarks">Bookmarks fixture</Link> · <Link to="/vault">Mistakes fixture</Link> · <Link to="/history">History fixture</Link> · <Link to="/track?track=oic_nw">Track fixture</Link> · <Link to="/flashcards?track=oic_nw">Flashcards fixture</Link>{['gmdss', 'engine_ew', 'deck_mgt', 'engine_mgt'].map(track => <React.Fragment key={track}> · <Link to={'/flashcards?track=' + track}>Flashcards {track} fixture</Link></React.Fragment>)}</nav><App />
</MemoryRouter>)
