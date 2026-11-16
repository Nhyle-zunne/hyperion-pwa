import React, { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import SessionResults from '../../src/components/SessionResults'
import TrackHubScreen from '../../src/screens/TrackHubScreen'
import PaywallDialog from '../../src/components/PaywallDialog'
import TrackPurchaseDialog from '../../src/components/TrackPurchaseDialog'
import QuestionImageGallery from '../../src/components/QuestionImageGallery'
import MockExamScreen, { MockExamRunner } from '../../src/screens/MockExamScreen'
import FlashcardsScreen from '../../src/screens/FlashcardsScreen'
import BookmarksScreen from '../../src/screens/BookmarksScreen'
import VaultScreen from '../../src/screens/VaultScreen'
import HistoryScreen from '../../src/screens/HistoryScreen'
import SearchScreen from '../../src/screens/SearchScreen'
import { loadLicensedQuestionImage, loadQuestionImage, preloadQuestionImages, offlineQuestionImagesComplete } from '../../src/lib/questionMediaCache'
import { useLicenseStore } from '../../src/stores/licenseStore'
import { usePracticeStore } from '../../src/stores/practiceStore'
import { useBookmarksStore } from '../../src/stores/bookmarksStore'
import { useVaultStore } from '../../src/stores/vaultStore'
import { useHistoryStore } from '../../src/stores/historyStore'
import { setLocalProgressIdentity, markLocalProgressReady } from '../../src/lib/localProgressIdentity'
import { readEncryptedPersistedValue } from '../../src/lib/encryptedPersistStorage'
import { saveSessionSnapshot } from '../../src/lib/sessionArchive'
import { mediaQuestion } from './media-bank-fixture'
import { mediaOwner, mediaAuthCalls } from './media-supabase-fixture'
import {
  saveOfflineQuestionPack, saveOfflinePackManifest, saveOfflineQuestionPackSets,
  getOfflinePackStatus, getOfflineQuestionPacks, getOfflineQuestionCounts,
  getOfflineQuestionsByCompetence
} from '../../src/lib/offlineQuestionCache'
import type { TrackId } from '../../src/types/question'
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
  let changeTrack: ((track: typeof mediaQuestion.track) => void) | undefined
  const syntheticImages = new Map<string, number[]>()
  Object.assign(window, { mediaFixture: {
    sha, png: Array.from(png), license,
    testActiveOfflinePacks: async () => {
      const tracks: TrackId[] = ['DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC']
      const outcomes = []
      for (const track of tracks) {
        const competenceId = track === 'ENGINE_MGT' ? 'C10' : 'C1'
        const idPrefix = track === 'ENGINE_MGT' ? 'EM-C10' : 'TEST-C1'
        const rows = [
          { ...mediaQuestion, id: `${idPrefix}-001`, track, competenceId, imageAttachments: [] },
          { ...mediaQuestion, id: `${idPrefix}-002`, track, competenceId, imageAttachments: [], isRetired: true },
          { ...mediaQuestion, id: `${idPrefix}-003`, track, competenceId, imageAttachments: [] },
          ...(track === 'ENGINE_MGT'
            ? [182, 373, 406].map(n => ({ ...mediaQuestion, id: `EM-C10-${n}`, track, competenceId, imageAttachments: [] }))
            : [])
        ]
        // Legacy raw pack as saved by an older version of the PWA.
        await saveOfflineQuestionPack({ track, freeOnly: false, competenceId, part: null, questions: rows })
        await saveOfflinePackManifest({
          track, freeOnly: false, complete: true, questionCount: rows.length, groupCount: 1,
          sourceVersionFormat: 'github-content-sha256-v1',
          sourceVersions: { [track]: 'a'.repeat(64) }, lastKnownUpdateState: 'current', lastCheckedAt: 123
        })
        const migrated = await getOfflinePackStatus(track, false)
        const groups = await getOfflineQuestionPacks(track, false)
        const byCompetence = await getOfflineQuestionsByCompetence(track, competenceId, undefined, false)
        const counts = await getOfflineQuestionCounts(track, false)
        outcomes.push({
          track, actual: migrated?.questionCount, groups: groups?.length,
          ids: groups?.flatMap(group => group.questions.map(question => question.id)),
          competenceCount: counts?.reduce((sum, group) => sum + group.count, 0),
          targetedCount: byCompetence?.length,
          sourceVersions: migrated?.sourceVersions,
          lastCheckedAt: migrated?.lastCheckedAt
        })
      }
      // Newly downloaded packs must not persist retired records either.
      const track: TrackId = 'ENGINE_MGT'
      const latest = [
        { ...mediaQuestion, id: 'EM-C10-001', track, competenceId: 'C10', imageAttachments: [] },
        { ...mediaQuestion, id: 'EM-C10-182', track, competenceId: 'C10', imageAttachments: [] },
        { ...mediaQuestion, id: 'EM-C10-003', track, competenceId: 'C10', imageAttachments: [], isRetired: true },
      ]
      await saveOfflineQuestionPackSets([{
        track, freeOnly: false, groups: [{ competenceId: 'C10', part: null, questions: latest }]
      }])
      const fresh = await getOfflinePackStatus(track, false)
      const freshPacks = await getOfflineQuestionPacks(track, false)
      return { outcomes, freshCount: fresh?.questionCount, freshIds: freshPacks?.flatMap(group => group.questions.map(question => question.id)) }
    },
    lookupImage: (digest: string) => ({ sha: digest, png: syntheticImages.get(digest) || Array.from(png) }),
    authCount: () => mediaAuthCalls.count,
    prepareMany: async (count: number, freeOnly = false, quotaFailure = false) => {
      const questions = []
      const hashes: string[] = []
      for (let i = 0; i < count; i++) {
        const bytes = Uint8Array.from([...png, i & 255, (i >> 8) & 255])
        const digest = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)), x => x.toString(16).padStart(2, '0')).join('')
        syntheticImages.set(digest, Array.from(bytes))
        hashes.push(digest)
        questions.push({ ...mediaQuestion, id: 'cached-diagram-' + i, imageAttachments: [{
          sha256: digest, mime: 'image/png' as const, placement: 'question' as const, alt: 'Synthetic offline diagram'
        }] })
      }
      const originalPut = IDBObjectStore.prototype.put
      if (quotaFailure) IDBObjectStore.prototype.put = function (...args) {
        if (this.name === 'images') throw new DOMException('Synthetic quota failure', 'QuotaExceededError')
        return originalPut.apply(this, args)
      }
      try {
        await preloadQuestionImages('DECK_OIC_NW', questions, freeOnly)
        return { ready: await offlineQuestionImagesComplete('DECK_OIC_NW', questions, freeOnly), last: hashes.at(-1) }
      } catch (error) {
        if (!quotaFailure) throw error
        return { ready: await offlineQuestionImagesComplete('DECK_OIC_NW', questions, freeOnly), rejected: true }
      } finally { IDBObjectStore.prototype.put = originalPut }
    },
    loadMulti: (digest: string, freeOnly = false) => loadQuestionImage('DECK_OIC_NW', {
      sha256: digest, mime: 'image/png', placement: 'question', alt: 'Cached offline diagram'
    }, freeOnly).then(blob => blob.size),
    savedRefs: async () => {
      await Promise.all([readEncryptedPersistedValue('hyperion-bookmarks'), readEncryptedPersistedValue('hyperion-vault')])
      await Promise.all([useBookmarksStore.persist.rehydrate(), useVaultStore.persist.rehydrate()])
      return { bookmarks: useBookmarksStore.getState().asQuestions()[0]?.imageAttachments, vault: useVaultStore.getState().asQuestions()[0]?.imageAttachments }
    },
    changeRef: () => changeRef?.(),
    changeTrack: (track: typeof mediaQuestion.track) => changeTrack?.(track),
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
    changeTrack = track => setQuestion(current => ({ ...current, track }))
    return <div style={{ transform: 'translateZ(0)', height: 180, overflow: 'hidden' }}><QuestionImageGallery question={question} placement="question" /></div>
  }
  function HubFixture() {
    const navigate = useNavigate()
    const location = useLocation()
    Object.assign(window, { hubFixture: {
      setLicenses(trackIds: string[], verified = true) {
        useLicenseStore.setState({
          cloudTrackIds: trackIds,
          isAllAccessUnlocked: trackIds.includes('ALL'),
          entitlementsVerified: verified,
          entitlementUserId: verified ? mediaOwner : null,
        })
      },
      goTrack(key: string) { navigate('/track?track=' + encodeURIComponent(key)) },
      goMock(key: string) { navigate('/mock?track=' + encodeURIComponent(key)) },
    } })
    return <>
      <Routes>
        <Route path="/track" element={<TrackHubScreen />} />
        <Route path="/mock" element={<MockExamScreen />} />
        <Route path="*" element={<div data-testid="hub-destination">{location.pathname}{location.search}</div>} />
      </Routes>
      <PaywallDialog />
      <TrackPurchaseDialog />
    </>
  }
  const mode = new URLSearchParams(location.search).get('screen') || 'gallery'
  const screens: Record<string, React.ReactNode> = { results: <SessionResults onTryAgain={() => {}} onHistory={() => {}} />, gallery: <Gallery />, mock: <MockExamRunner />, flashcards: <FlashcardsScreen />, bookmarks: <BookmarksScreen />, vault: <VaultScreen />, history: <HistoryScreen />, search: <SearchScreen /> }
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={[mode === 'hub' ? '/track?track=oic_nw' : '/?track=oic_nw']} >{mode === 'hub' ? <HubFixture /> : screens[mode]}{mode !== 'hub' && <TrackPurchaseDialog />}</MemoryRouter>)

}
void main()
