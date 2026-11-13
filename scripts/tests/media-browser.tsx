import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter } from 'react-router-dom'
import SessionResults from '../../src/components/SessionResults'
import QuestionImageGallery from '../../src/components/QuestionImageGallery'
import { MockExamRunner } from '../../src/screens/MockExamScreen'
import FlashcardsScreen from '../../src/screens/FlashcardsScreen'
import BookmarksScreen from '../../src/screens/BookmarksScreen'
import VaultScreen from '../../src/screens/VaultScreen'
import HistoryScreen from '../../src/screens/HistoryScreen'
import SearchScreen from '../../src/screens/SearchScreen'
import { loadLicensedQuestionImage } from '../../src/lib/questionMediaCache'
import { useLicenseStore } from '../../src/stores/licenseStore'
import { usePracticeStore } from '../../src/stores/practiceStore'
import { useBookmarksStore } from '../../src/stores/bookmarksStore'
import { useVaultStore } from '../../src/stores/vaultStore'
import { useHistoryStore } from '../../src/stores/historyStore'
import { setLocalProgressIdentity, markLocalProgressReady } from '../../src/lib/localProgressIdentity'
import { readEncryptedPersistedValue } from '../../src/lib/encryptedPersistStorage'
import { saveSessionSnapshot } from '../../src/lib/sessionArchive'
import { mediaQuestion } from './media-bank-fixture'
import { mediaOwner } from './media-supabase-fixture'
import '../../src/index.css'

async function main() {
  const png = Uint8Array.from(atob('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII='), x => x.charCodeAt(0))
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', png)), x => x.toString(16).padStart(2, '0')).join('')
  mediaQuestion.imageAttachments = [
    { sha256: sha, mime: 'image/png', placement: 'question', alt: 'Synthetic question diagram' },
    { sha256: sha, mime: 'image/png', placement: 'explanation', alt: 'Synthetic explanation diagram' },
  ]
  if (new URLSearchParams(location.search).has('promptOnly')) mediaQuestion.questionText = ''
  if (new URLSearchParams(location.search).has('imageOnly')) mediaQuestion.explanation = ''
  function license(enabled = true, owner: string | null = mediaOwner) {
    useLicenseStore.setState({ entitlementsVerified: true, entitlementUserId: owner, isAllAccessUnlocked: enabled, cloudTrackIds: enabled ? ['DECK_OIC_NW'] : [] })
  }
  license()
  useLicenseStore.setState({ refreshCloudEntitlements: async () => {}, refreshCachedEntitlements: async () => {} })
  localStorage.setItem('hyperion-progress-owner', mediaOwner)
  setLocalProgressIdentity(mediaOwner)
  markLocalProgressReady(mediaOwner)
  await Promise.all([useBookmarksStore.persist.rehydrate(), useVaultStore.persist.rehydrate()])
  useBookmarksStore.setState({ items: [] })
  useVaultStore.setState({ items: [] })
  useBookmarksStore.getState().toggle(mediaQuestion, true)
  useVaultStore.getState().addMistake(mediaQuestion, 1, false)
  const snapshot = { sessionId: 'synthetic-media-session', questions: [mediaQuestion], answers: {}, currentIndex: 0, track: mediaQuestion.track, competenceId: 'C1', part: null, mode: 'MOCK' as const, startedAt: Date.now(), timeLimitSec: 3600, timeLeftSec: 3600, streak: 0, bestStreak: 0, finished: true, isFreeSession: false }
  await saveSessionSnapshot(snapshot.sessionId, snapshot)
  useHistoryStore.setState({ entries: [{ id: snapshot.sessionId, mode: 'MOCK', track: mediaQuestion.track, competenceId: 'C1', total: 1, correct: 0, answered: 0, percent: 0, durationMs: 1000, startedAt: Date.now() - 1000, finishedAt: Date.now() }], savedSessions: [] })
  usePracticeStore.setState({ ...snapshot, finished: false, loading: false, error: null, finishing: false, completionError: null })
  let changeRef: (() => void) | undefined
  Object.assign(window, { mediaFixture: {
    sha, png: Array.from(png), license,
    savedRefs: async () => {
      await Promise.all([readEncryptedPersistedValue('hyperion-bookmarks'), readEncryptedPersistedValue('hyperion-vault')])
      await Promise.all([useBookmarksStore.persist.rehydrate(), useVaultStore.persist.rehydrate()])
      return { bookmarks: useBookmarksStore.getState().asQuestions()[0]?.imageAttachments, vault: useVaultStore.getState().asQuestions()[0]?.imageAttachments }
    },
    changeRef: () => changeRef?.(),
    load: () => loadLicensedQuestionImage('DECK_OIC_NW', mediaQuestion.imageAttachments![0]).then(blob => blob.size),
    boundedStream: async () => {
      const original = window.fetch
      let chunks = 0, cancelled = false
      const ref = { ...mediaQuestion.imageAttachments![0], sha256: 'a'.repeat(64) }
      window.fetch = async () => new Response(new ReadableStream({
        pull(controller) { chunks++; controller.enqueue(new Uint8Array(65536)); if (chunks === 32) controller.close() },
        cancel() { cancelled = true },
      }), { headers: { 'content-type': 'image/png', 'X-Hyperion-Media-SHA256': ref.sha256 } })
      try { await loadLicensedQuestionImage('DECK_OIC_NW', ref); return { rejected: false, chunks, cancelled } }
      catch { return { rejected: true, chunks, cancelled } }
      finally { window.fetch = original }
    },
    abortDuringCachedDigest: async () => {
      const original = crypto.subtle.digest.bind(crypto.subtle)
      const controller = new AbortController()
      crypto.subtle.digest = async (...args) => { const result = await original(...args); controller.abort(); return result }
      try { await loadLicensedQuestionImage('DECK_OIC_NW', mediaQuestion.imageAttachments![0], controller.signal); return false }
      catch { return true }
      finally { crypto.subtle.digest = original }
    },
    revokeDuringCachedDigest: async () => {
      const original = crypto.subtle.digest.bind(crypto.subtle)
      let revoked = false
      crypto.subtle.digest = async (...args) => { const result = await original(...args); license(false); revoked = true; return result }
      try { await loadLicensedQuestionImage('DECK_OIC_NW', mediaQuestion.imageAttachments![0]); return { rejected: false, revoked } }
      catch { return { rejected: true, revoked } }
      finally { crypto.subtle.digest = original; license() }
    },
  } })
  function Gallery() {
    const [question, setQuestion] = useState(mediaQuestion)
    changeRef = () => setQuestion({ ...mediaQuestion, imageAttachments: [] })
    return <div style={{ transform: 'translateZ(0)', height: 180, overflow: 'hidden' }}><QuestionImageGallery question={question} placement="question" /></div>
  }
  const mode = new URLSearchParams(location.search).get('screen') || 'gallery'
  const screens: Record<string, React.ReactNode> = { results: <SessionResults onTryAgain={() => {}} onHistory={() => {}} />, gallery: <Gallery />, mock: <MockExamRunner />, flashcards: <FlashcardsScreen />, bookmarks: <BookmarksScreen />, vault: <VaultScreen />, history: <HistoryScreen />, search: <SearchScreen /> }
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/?track=oic_nw']} >{screens[mode]}</MemoryRouter>)

}
void main()
