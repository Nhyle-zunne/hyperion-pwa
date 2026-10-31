import type { Question, TrackId, UserAnswer } from '../types/question'
import type { SessionMode } from '../stores/historyStore'
import { useHistoryStore } from '../stores/historyStore'
import { useStudyTimeStore } from '../stores/studyTimeStore'
import { useVaultStore } from '../stores/vaultStore'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { usePracticeStore } from '../stores/practiceStore'
import { supabase, supabaseUrl, supabaseAnonKey } from './supabase'
import { readEncryptedPersistedValue, removeEncryptedPersistedValue, writeEncryptedPersistedValue } from './encryptedPersistStorage'
import { filterProgressCollection, mergeProgressDeletionLedgers } from './progressDeletionLedger'

const OWNER_KEY = 'hyperion-progress-owner'
const LOCAL_DIRTY_KEY = 'hyperion-progress-unclaimed-dirty'
const SESSION_CHANGED_AT_KEY = 'hyperion-progress-session-changed-at'
const DIRTY_SECTIONS_KEY = 'hyperion-progress-dirty-sections'
const accountCacheKey = (userId: string) => `hyperion-progress-cache:${userId}`
const DIRTY_PREFIX = 'hyperion-progress-dirty:'
const STORAGE_KEYS = [
  'hyperion-history',
  'hyperion-study-time',
  'hyperion-vault',
  'hyperion-bookmarks',
  'hyperion-saved-practice',
  'hyperion-mock-exam-plan-v1',
  'hyperion-question-attempt-history',
  'hyperion-progress-deletions'
] as const

type ProgressStorageKey = typeof STORAGE_KEYS[number]
type ProgressSection = 'history' | 'studyTime' | 'vault' | 'bookmarks' | 'practice' | 'mockPlan' | 'attempts' | 'deletions' | 'other'
const ALL_PROGRESS_SECTIONS: ProgressSection[] = ['history', 'studyTime', 'vault', 'bookmarks', 'practice', 'mockPlan', 'attempts', 'deletions']

interface ActiveSessionSnapshot {
  questions: Question[]
  answers: Record<string, UserAnswer>
  currentIndex: number
  track: TrackId | null
  competenceId: string | null
  finished: boolean
  mode: SessionMode
  startedAt: number
  timeLimitSec: number
  timeLeftSec: number
  streak: number
  bestStreak: number
}

export interface LearningProgressSnapshot {
  version: 1
  savedAt: number
  activeSessionChangedAt: number
  changedSections: ProgressSection[]
  storage: Record<ProgressStorageKey, string | null>
  activeSession: ActiveSessionSnapshot | null
}

interface CloudProgressRow {
  data: LearningProgressSnapshot
  updated_at: string
}

let started = false
let hydrating = false
let activeUserId: string | null = null
let cloudReady = false
let uploadTimer: ReturnType<typeof setTimeout> | null = null
let retryTimer: ReturnType<typeof setTimeout> | null = null
let currentGeneration = 0
let cloudUpdatedAt: string | null = null
let cloudVersionLoaded = false
let cloudSnapshot: LearningProgressSnapshot | null = null
let lastUploadAt = 0
let uploadInFlight = false
const MIN_UPLOAD_INTERVAL_MS = 300_000
let uploadQueued = false
let unsubscribeStores: (() => void)[] = []
let authSubscription: { unsubscribe: () => void } | null = null

const dirtyKey = (userId: string) => DIRTY_PREFIX + userId

function readDirtySections(): ProgressSection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIRTY_SECTIONS_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ProgressSection =>
      ['history', 'studyTime', 'vault', 'bookmarks', 'practice', 'mockPlan', 'attempts', 'deletions', 'other'].includes(item)
    )
  } catch { return [] }
}

function sectionForStorageKey(key: ProgressStorageKey): ProgressSection {
  switch (key) {
    case 'hyperion-history': return 'history'
    case 'hyperion-study-time': return 'studyTime'
    case 'hyperion-vault': return 'vault'
    case 'hyperion-bookmarks': return 'bookmarks'
    case 'hyperion-saved-practice': return 'practice'
    case 'hyperion-mock-exam-plan-v1': return 'mockPlan'
    case 'hyperion-question-attempt-history': return 'attempts'
    case 'hyperion-progress-deletions': return 'deletions'
  }
}

function readLocalStorage(): Record<ProgressStorageKey, string | null> {
  const storage = {} as Record<ProgressStorageKey, string | null>
  for (const key of STORAGE_KEYS) {
    try { storage[key] = localStorage.getItem(key) } catch { storage[key] = null }
  }
  // These two stores now live in encrypted IndexedDB. Serialize their live Zustand
  // state into the same versioned envelope used by cloud progress snapshots.
  storage['hyperion-bookmarks'] = JSON.stringify({
    state: { items: useBookmarksStore.getState().items },
    version: 0
  })
  storage['hyperion-vault'] = JSON.stringify({
    state: { items: useVaultStore.getState().items },
    version: 0
  })
  return storage
}

function captureSnapshot(): LearningProgressSnapshot {
  const state = usePracticeStore.getState()
  const activeSession: ActiveSessionSnapshot | null = state.questions.length > 0 && !state.finished
    ? {
        questions: state.questions,
        answers: state.answers,
        currentIndex: state.currentIndex,
        track: state.track,
        competenceId: state.competenceId,
        finished: state.finished,
        mode: state.mode,
        startedAt: state.startedAt,
        timeLimitSec: state.timeLimitSec,
        timeLeftSec: state.timeLeftSec,
        streak: state.streak,
        bestStreak: state.bestStreak
      }
    : null

  return {
    version: 1,
    savedAt: Date.now(),
    activeSessionChangedAt: (() => {
      try { return Number(localStorage.getItem(SESSION_CHANGED_AT_KEY)) || 0 } catch { return 0 }
    })(),
    changedSections: readDirtySections(),
    storage: readLocalStorage(),
    activeSession
  }
}

function isSnapshot(value: unknown): value is LearningProgressSnapshot {
  if (!value || typeof value !== 'object') return false
  const candidate = value as Partial<LearningProgressSnapshot>
  return candidate.version === 1
    && typeof candidate.savedAt === 'number'
    && !!candidate.storage
    && typeof candidate.storage === 'object'
}

// Exclude transport metadata that changes on every capture, but retain all actual
// study data, including the active-session resume position and changed-at watermark.
function progressSignature(snapshot: LearningProgressSnapshot): string {
  return JSON.stringify({
    version: snapshot.version,
    activeSessionChangedAt: snapshot.activeSessionChangedAt,
    storage: snapshot.storage,
    activeSession: snapshot.activeSession
  })
}

let lastUploadedUserId: string | null = null
let lastUploadedSignature: string | null = null

const persistedSignatureKey = (userId: string) => `hyperion:progress-upload-signature:${userId}`
const persistedUploadAtKey = (userId: string) => `hyperion:progress-last-upload-at:${userId}`
const crossTabLockKey = (userId: string) => `hyperion:progress-sync-lock:${userId}`
const syncInstanceId = (() => {
  try { return crypto.randomUUID() } catch { return `tab-${Date.now()}-${Math.random().toString(36).slice(2)}` }
})()

async function hashProgressSignature(signature: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(signature))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

type ProgressSyncLock = { release: () => void }

async function acquireProgressSyncLock(userId: string): Promise<ProgressSyncLock | null> {
  // Web Locks provide an atomic same-origin lock across tabs and installed PWA
  // windows. The localStorage lease is a best-effort fallback for older browsers.
  if (typeof navigator !== 'undefined' && navigator.locks?.request) {
    let releaseHold: (() => void) | null = null
    const hold = new Promise<void>(resolve => { releaseHold = resolve })
    const entered = new Promise<ProgressSyncLock | null>(resolve => {
      void navigator.locks.request(
        `hyperion-learning-progress:${userId}`,
        { mode: 'exclusive', ifAvailable: true },
        async lock => {
          if (!lock) {
            resolve(null)
            return
          }
          let released = false
          resolve({
            release: () => {
              if (released) return
              released = true
              releaseHold?.()
            }
          })
          await hold
        }
      ).catch(() => resolve(null))
    })
    return entered
  }

  const key = crossTabLockKey(userId)
  try {
    const now = Date.now()
    const current = parseJson<{ owner?: string; expiresAt?: number }>(localStorage.getItem(key))
    if (current?.expiresAt && current.expiresAt > now && current.owner !== syncInstanceId) return null
    localStorage.setItem(key, JSON.stringify({ owner: syncInstanceId, expiresAt: now + 45_000 }))
    // Let racing tabs write their claim before checking which one won.
    await new Promise(resolve => window.setTimeout(resolve, 35 + Math.floor(Math.random() * 35)))
    const confirmed = parseJson<{ owner?: string }>(localStorage.getItem(key))
    if (confirmed?.owner !== syncInstanceId) return null
    return {
      release: () => {
        const latest = parseJson<{ owner?: string }>(localStorage.getItem(key))
        if (latest?.owner === syncInstanceId) localStorage.removeItem(key)
      }
    }
  } catch {
    // When browser storage is disabled, do not block otherwise-valid cloud sync.
    return { release: () => undefined }
  }
}


function parseJson<T>(raw: string | null): T | null {
  if (!raw) return null
  try { return JSON.parse(raw) as T } catch { return null }
}

function mergeById<T extends { id: string }>(remoteItems: T[], localItems: T[], timestampKey: keyof T): T[] {
  const merged = new Map<string, T>()
  for (const item of remoteItems) merged.set(item.id, item)
  for (const item of localItems) {
    const existing = merged.get(item.id)
    const localTime = Number(item[timestampKey] ?? 0)
    const remoteTime = Number(existing?.[timestampKey] ?? 0)
    if (!existing || localTime >= remoteTime) merged.set(item.id, item)
  }
  return Array.from(merged.values())
}

function dayOrdinal(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map(Number)
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000)
}

type DailyCheckIn = { startDate: string; lastDate: string; count: number; updatedAt: number }

function readDailyCheckIn(state: Record<string, unknown>): DailyCheckIn | null {
  const startDate = state.dailyCheckInStartDate
  const lastDate = state.dailyCheckInLastDate
  const count = Number(state.dailyCheckInCount ?? 0)
  if (typeof startDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) return null
  if (typeof lastDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(lastDate)) return null
  if (!Number.isInteger(count) || count < 1 || startDate > lastDate) return null
  return { startDate, lastDate, count, updatedAt: Number(state.dailyCheckInUpdatedAt ?? 0) }
}

function mergeDailyCheckIn(localState: Record<string, unknown>, remoteState: Record<string, unknown>): Record<string, unknown> {
  const local = readDailyCheckIn(localState)
  const remote = readDailyCheckIn(remoteState)
  if (!local && !remote) return {}
  if (!local) return { dailyCheckInStartDate: remote!.startDate, dailyCheckInLastDate: remote!.lastDate, dailyCheckInCount: remote!.count, dailyCheckInUpdatedAt: remote!.updatedAt }
  if (!remote) return { dailyCheckInStartDate: local.startDate, dailyCheckInLastDate: local.lastDate, dailyCheckInCount: local.count, dailyCheckInUpdatedAt: local.updatedAt }

  if (local.lastDate === remote.lastDate) {
    return {
      dailyCheckInStartDate: local.startDate <= remote.startDate ? local.startDate : remote.startDate,
      dailyCheckInLastDate: local.lastDate,
      dailyCheckInCount: Math.max(local.count, remote.count),
      dailyCheckInUpdatedAt: Math.max(local.updatedAt, remote.updatedAt)
    }
  }

  const localIsLater = local.lastDate > remote.lastDate
  const later = localIsLater ? local : remote
  const earlier = localIsLater ? remote : local
  const gap = dayOrdinal(later.lastDate) - dayOrdinal(earlier.lastDate)
  if (gap === 1) {
    // Adjacent dates across devices mean the streak continued even if one device was stale.
    const startDate = earlier.startDate <= later.startDate ? earlier.startDate : later.startDate
    return {
      dailyCheckInStartDate: startDate,
      dailyCheckInLastDate: later.lastDate,
      dailyCheckInCount: Math.max(later.count, earlier.count + 1),
      dailyCheckInUpdatedAt: Math.max(local.updatedAt, remote.updatedAt)
    }
  }
  return { dailyCheckInStartDate: later.startDate, dailyCheckInLastDate: later.lastDate, dailyCheckInCount: later.count, dailyCheckInUpdatedAt: later.updatedAt }
}

function mergePersistedStore(
  key: ProgressStorageKey,
  localRaw: string | null,
  remoteRaw: string | null,
  preferLocalSection: boolean,
  allowMigrationMerge: boolean
): string | null {
  if (key === 'hyperion-progress-deletions') {
    return mergeProgressDeletionLedgers(localRaw, remoteRaw)
  }
  if (!localRaw) return remoteRaw
  if (!remoteRaw) return localRaw

  if (key === 'hyperion-question-attempt-history') {
    const local = parseJson<{ version?: number; state?: { entries?: Record<string, Record<string, unknown>> } }>(localRaw)
    const remote = parseJson<{ version?: number; state?: { entries?: Record<string, Record<string, unknown>> } }>(remoteRaw)
    if (!local || !remote) return remoteRaw
    const localEntries = local.state?.entries ?? {}
    const remoteEntries = remote.state?.entries ?? {}
    const keys = new Set([...Object.keys(remoteEntries), ...Object.keys(localEntries)])
    const entries: Record<string, Record<string, unknown>> = {}
    for (const entryKey of keys) {
      const localEntry = localEntries[entryKey] ?? {}
      const remoteEntry = remoteEntries[entryKey] ?? {}
      const attempts = new Map<string, Record<string, unknown>>()
      for (const rawAttempt of [
        ...(Array.isArray(remoteEntry.attempts) ? remoteEntry.attempts as Record<string, unknown>[] : []),
        ...(Array.isArray(localEntry.attempts) ? localEntry.attempts as Record<string, unknown>[] : [])
      ]) {
        const timestamp = Number(rawAttempt.timestamp ?? 0)
        const correct = rawAttempt.isCorrect === true
        const id = typeof rawAttempt.id === 'string' && rawAttempt.id
          ? rawAttempt.id
          : `${timestamp}:${correct ? 'correct' : 'incorrect'}`
        attempts.set(id, { ...rawAttempt, id, timestamp, isCorrect: correct })
      }
      const mergedAttempts = [...attempts.values()].sort((a, b) => Number(a.timestamp) - Number(b.timestamp))
      const attemptCorrect = mergedAttempts.filter(item => item.isCorrect === true).length
      const attemptIncorrect = mergedAttempts.length - attemptCorrect
      entries[entryKey] = {
        ...remoteEntry,
        ...localEntry,
        attempts: mergedAttempts,
        allTimeCorrect: Math.max(Number(remoteEntry.allTimeCorrect ?? 0), Number(localEntry.allTimeCorrect ?? 0), attemptCorrect),
        allTimeIncorrect: Math.max(Number(remoteEntry.allTimeIncorrect ?? 0), Number(localEntry.allTimeIncorrect ?? 0), attemptIncorrect)
      }
    }
    return JSON.stringify({
      ...remote,
      ...local,
      version: local.version ?? remote.version ?? 1,
      state: { ...(remote.state ?? {}), ...(local.state ?? {}), entries }
    })
  }

  // History entries and study-time segments are append-only records, so merge
  // them across devices even when this device changed that section. For collections
  // users can delete (bookmarks, vault items, saved-practice payloads), honor the
  // explicitly changed local collection instead of resurrecting deleted entries.
  if (
    preferLocalSection
    && key !== 'hyperion-mock-exam-plan-v1'
    && key !== 'hyperion-history'
    && key !== 'hyperion-study-time'
    && key !== 'hyperion-vault'
    && key !== 'hyperion-bookmarks'
  ) return localRaw
  if (!allowMigrationMerge && !preferLocalSection) return remoteRaw
  const local = parseJson<{ state?: Record<string, unknown>; version?: number }>(localRaw)
  const remote = parseJson<{ state?: Record<string, unknown>; version?: number }>(remoteRaw)
  if (!local || !remote) return localRaw

  if (key === 'hyperion-history') {
    const ls = local.state ?? {}
    const rs = remote.state ?? {}
    const localEntries = Array.isArray(ls.entries) ? ls.entries as { id: string; finishedAt?: number }[] : []
    const remoteEntries = Array.isArray(rs.entries) ? rs.entries as { id: string; finishedAt?: number }[] : []
    const localSaved = Array.isArray(ls.savedSessions) ? ls.savedSessions as { id: string; savedAt?: number }[] : []
    const remoteSaved = Array.isArray(rs.savedSessions) ? rs.savedSessions as { id: string; savedAt?: number }[] : []
    return JSON.stringify({
      version: local.version ?? remote.version ?? 0,
      state: {
        ...rs,
        ...ls,
        entries: mergeById(remoteEntries, localEntries, 'finishedAt').sort((a, b) => (b.finishedAt ?? 0) - (a.finishedAt ?? 0)).slice(0, 100),
        // Prefer the local saved-session collection when it has entries. This preserves
        // local removals/resume state rather than resurrecting sessions removed locally.
        savedSessions: preferLocalSection
          ? localSaved.slice(0, 100)
          : localSaved.length ? mergeById(remoteSaved, localSaved, 'savedAt').slice(0, 100) : remoteSaved
      }
    })
  }

  if (key === 'hyperion-study-time' || key === 'hyperion-vault' || key === 'hyperion-bookmarks') {
    const stateKey = key === 'hyperion-study-time' ? 'segments' : 'items'
    const ls = local.state ?? {}
    const rs = remote.state ?? {}
    const localItems = Array.isArray(ls[stateKey]) ? ls[stateKey] as { id: string; at?: number; savedAt?: number; lastWrongAt?: number }[] : []
    const remoteItems = Array.isArray(rs[stateKey]) ? rs[stateKey] as { id: string; at?: number; savedAt?: number; lastWrongAt?: number }[] : []
    const timestampKey = key === 'hyperion-study-time' ? 'at' : key === 'hyperion-vault' ? 'lastWrongAt' : 'savedAt'
    const merged = mergeById(remoteItems, localItems, timestampKey).slice(0, key === 'hyperion-study-time' ? 400 : 500)
    const state = { ...rs, ...ls, [stateKey]: merged }
    if (key === 'hyperion-study-time') {
      // Select the most recently changed calendar date, not simply the local copy.
      const localDateAt = Number(ls.selectedDateUpdatedAt ?? 0)
      const remoteDateAt = Number(rs.selectedDateUpdatedAt ?? 0)
      if (typeof ls.selectedDate === 'string' && localDateAt >= remoteDateAt) {
        state.selectedDate = ls.selectedDate
        state.selectedDateUpdatedAt = localDateAt
      } else if (typeof rs.selectedDate === 'string') {
        state.selectedDate = rs.selectedDate
        state.selectedDateUpdatedAt = remoteDateAt
      }

      const localTargetAt = Number(ls.targetDateUpdatedAt ?? 0)
      const remoteTargetAt = Number(rs.targetDateUpdatedAt ?? 0)
      if (typeof ls.targetDate === 'string' && localTargetAt >= remoteTargetAt) {
        state.targetDate = ls.targetDate
        state.targetDateUpdatedAt = localTargetAt
      } else if (typeof rs.targetDate === 'string') {
        state.targetDate = rs.targetDate
        state.targetDateUpdatedAt = remoteTargetAt
      }

      Object.assign(state, mergeDailyCheckIn(ls, rs))
    }
    return JSON.stringify({ version: local.version ?? remote.version ?? 0, state })
  }

  if (key === 'hyperion-mock-exam-plan-v1') {
    const localPlan = parseJson<Record<string, unknown>>(localRaw)
    const remotePlan = parseJson<Record<string, unknown>>(remoteRaw)
    if (localPlan && remotePlan && localPlan.trackId === remotePlan.trackId && localPlan.startedAt === remotePlan.startedAt) {
      const localResults = (localPlan.results ?? {}) as Record<string, unknown>
      const remoteResults = (remotePlan.results ?? {}) as Record<string, unknown>
      return JSON.stringify({
        ...remotePlan,
        ...localPlan,
        status: localPlan.status === 'submitted' || remotePlan.status === 'submitted' ? 'submitted' : 'in_progress',
        results: { ...remoteResults, ...localResults }
      })
    }
    if (preferLocalSection) return localRaw
    if (!allowMigrationMerge) return remoteRaw
    return localPlan?.startedAt && (!remotePlan?.startedAt || Number(localPlan.startedAt) >= Number(remotePlan.startedAt)) ? localRaw : remoteRaw
  }

  // A saved single-session payload represents one session, so do not combine its
  // questions or answers with a different session.
  if (preferLocalSection) return localRaw
  return allowMigrationMerge ? localRaw : remoteRaw
}

function mergeSnapshots(
  local: LearningProgressSnapshot,
  remote: LearningProgressSnapshot,
  preferLocalSections: ProgressSection[] = [],
  allowMigrationMerge = false
): LearningProgressSnapshot {
  const prefer = new Set(preferLocalSections)
  const storage = {} as Record<ProgressStorageKey, string | null>
  for (const key of STORAGE_KEYS) {
    storage[key] = mergePersistedStore(
      key,
      local.storage[key],
      remote.storage[key],
      prefer.has(sectionForStorageKey(key)),
      allowMigrationMerge
    )
  }

  // Apply the merged deletion ledger after unioning collection rows. This lets a
  // newer re-bookmark/re-mistake restore an item without resurrecting stale copies.
  const deletionLedger = storage['hyperion-progress-deletions']
  storage['hyperion-bookmarks'] = filterProgressCollection(
    storage['hyperion-bookmarks'], deletionLedger, 'bookmarks', 'savedAt'
  )
  storage['hyperion-vault'] = filterProgressCollection(
    storage['hyperion-vault'], deletionLedger, 'vault', 'lastWrongAt'
  )

  const localSessionChanged = (local.activeSessionChangedAt ?? 0) > (remote.activeSessionChangedAt ?? 0)
  const preferLocalSession = !allowMigrationMerge && prefer.has('practice')
  let activeSession = remote.activeSession
  if (preferLocalSession || (local.activeSession && !remote.activeSession) || (localSessionChanged && !remote.activeSession)) {
    activeSession = local.activeSession
  } else if (!local.activeSession && remote.activeSession) {
    activeSession = localSessionChanged ? null : remote.activeSession
  } else if (
    local.activeSession
    && remote.activeSession
    && local.activeSession.track === remote.activeSession.track
    && local.activeSession.competenceId === remote.activeSession.competenceId
    && local.activeSession.startedAt === remote.activeSession.startedAt
  ) {
    activeSession = {
      ...remote.activeSession,
      ...(localSessionChanged ? local.activeSession : remote.activeSession),
      answers: {
        ...local.activeSession.answers,
        ...remote.activeSession.answers,
        ...(localSessionChanged ? local.activeSession.answers : {})
      },
      currentIndex: Math.max(remote.activeSession.currentIndex, local.activeSession.currentIndex),
      timeLeftSec: Math.min(remote.activeSession.timeLeftSec, local.activeSession.timeLeftSec)
    }
  } else if (local.activeSession && localSessionChanged) {
    activeSession = local.activeSession
  }

  return {
    version: 1,
    savedAt: Date.now(),
    activeSessionChangedAt: Math.max(local.activeSessionChangedAt ?? 0, remote.activeSessionChangedAt ?? 0),
    changedSections: [...new Set([...(local.changedSections ?? []), ...(remote.changedSections ?? [])])],
    storage,
    activeSession
  }
}

function activeSessionFrom(snapshot: LearningProgressSnapshot): ActiveSessionSnapshot | null {
  const s = snapshot.activeSession
  if (!s || !Array.isArray(s.questions) || !s.questions.length || !s.track || s.finished) return null
  return s
}

function resetActiveSession(): void {
  usePracticeStore.setState({
    questions: [],
    answers: {},
    currentIndex: 0,
    loading: false,
    error: null,
    track: null,
    competenceId: null,
    finished: false,
    mode: 'PRACTICE',
    startedAt: 0,
    timeLimitSec: 0,
    timeLeftSec: 0,
    streak: 0,
    bestStreak: 0
  })
}

async function rehydratePersistedStores(): Promise<void> {
  await Promise.all([
    useHistoryStore.persist.rehydrate(),
    useStudyTimeStore.persist.rehydrate(),
    useVaultStore.persist.rehydrate(),
    useBookmarksStore.persist.rehydrate()
  ])
}

async function applySnapshot(snapshot: LearningProgressSnapshot): Promise<void> {
  hydrating = true
  try {
    try {
      localStorage.setItem(SESSION_CHANGED_AT_KEY, String(snapshot.activeSessionChangedAt ?? 0))
      localStorage.setItem(DIRTY_SECTIONS_KEY, JSON.stringify(snapshot.changedSections ?? []))
    } catch { /* ignore storage errors */ }
    for (const key of STORAGE_KEYS) {
      const value = snapshot.storage[key]
      if (key === 'hyperion-bookmarks' || key === 'hyperion-vault') {
        try {
          if (value == null) await removeEncryptedPersistedValue(key)
          else await writeEncryptedPersistedValue(key, value)
          try { localStorage.removeItem(key) } catch { /* remove previous-version cleartext only after encrypted write succeeds */ }
        } catch (error) {
          // Do not apply another account's stale encrypted state if restoring cloud
          // progress into encrypted storage failed.
          throw new Error(`Could not restore encrypted progress collection ${key}: ${error instanceof Error ? error.name : 'StorageError'}`)
        }
        continue
      }
      try {
        if (value == null) localStorage.removeItem(key)
        else localStorage.setItem(key, value)
      } catch { /* continue restoring the remaining progress if storage is restricted */ }
    }

    await rehydratePersistedStores()
    const session = activeSessionFrom(snapshot)
    if (session) {
      usePracticeStore.setState({
        questions: session.questions,
        answers: session.answers,
        currentIndex: Math.min(Math.max(0, session.currentIndex), session.questions.length - 1),
        loading: false,
        error: null,
        track: session.track,
        competenceId: session.competenceId,
        finished: false,
        mode: session.mode,
        startedAt: session.startedAt,
        timeLimitSec: session.timeLimitSec,
        timeLeftSec: session.timeLeftSec,
        streak: session.streak,
        bestStreak: session.bestStreak
      })
    } else {
      resetActiveSession()
    }
  } finally {
    hydrating = false
  }

  window.dispatchEvent(new CustomEvent('hyperion:learning-progress-restored', {
    detail: {
      hasActiveSession: !!activeSessionFrom(snapshot),
      mode: activeSessionFrom(snapshot)?.mode ?? null,
      track: activeSessionFrom(snapshot)?.track ?? null,
      competenceId: activeSessionFrom(snapshot)?.competenceId ?? null
    }
  }))
  window.dispatchEvent(new Event('hyperion:learning-progress-ready'))
}

async function clearLocalProgress(): Promise<void> {
  hydrating = true
  try {
    for (const key of STORAGE_KEYS) {
      try { localStorage.removeItem(key) } catch { /* ignore storage errors */ }
    }
    try {
      localStorage.removeItem(SESSION_CHANGED_AT_KEY)
      localStorage.removeItem(DIRTY_SECTIONS_KEY)
    } catch { /* ignore storage errors */ }
    useHistoryStore.setState({ entries: [], savedSessions: [] })
    useStudyTimeStore.setState({ segments: [], dailyCheckInStartDate: '', dailyCheckInLastDate: '', dailyCheckInCount: 0, dailyCheckInUpdatedAt: 0 })
    useVaultStore.setState({ items: [] })
    useBookmarksStore.setState({ items: [] })
    resetActiveSession()
  } finally {
    hydrating = false
  }
}

function noteLocalChange(section: ProgressSection = 'other'): void {
  if (hydrating) return
  const owner = (() => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } })()
  const marker = owner ? dirtyKey(owner) : LOCAL_DIRTY_KEY
  try {
    localStorage.setItem(marker, String(Date.now()))
    const sections = new Set(readDirtySections())
    sections.add(section)
    localStorage.setItem(DIRTY_SECTIONS_KEY, JSON.stringify([...sections]))
  } catch { /* local-only mode remains available */ }
  if (activeUserId && cloudReady && activeUserId === owner) scheduleUpload()
}

function scheduleUpload(delay = 800): void {
  if (!activeUserId || !cloudReady || hydrating) return
  try { localStorage.setItem(dirtyKey(activeUserId), String(Date.now())) } catch { /* progress remains local */ }
  // Coalesce frequent store updates into one write. The snapshot is captured when
  // the timer fires, so it includes the latest local state without repeated resets.
  if (uploadTimer) return
  const remaining = Math.max(0, MIN_UPLOAD_INTERVAL_MS - (Date.now() - lastUploadAt))
  uploadTimer = setTimeout(() => {
    uploadTimer = null
    void uploadSnapshot()
  }, Math.max(delay, remaining))
}

async function invokeCompressedProgressWrite(
  body: Record<string, unknown>,
  accessToken: string
): Promise<{ data: any; error: any }> {
  const serialized = JSON.stringify(body)
  if (
    typeof CompressionStream === 'undefined' ||
    !supabaseUrl ||
    !supabaseAnonKey ||
    new TextEncoder().encode(serialized).byteLength < 4096
  ) {
    return supabase!.functions.invoke('learning-progress', { body })
  }

  const compressedBody = await new Response(
    new Blob([serialized]).stream().pipeThrough(new CompressionStream('gzip'))
  ).arrayBuffer()

  const response = await fetch(`${supabaseUrl}/functions/v1/learning-progress`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      apikey: supabaseAnonKey,
      Accept: 'application/json',
      'Content-Type': 'application/json',
      'Content-Encoding': 'gzip'
    },
    body: compressedBody
  })
  const data = await response.json()
  if (!response.ok) {
    const error = new Error(
      typeof data?.error === 'string' ? data.error : 'The progress service rejected the save.'
    ) as Error & { context?: { status: number } }
    error.context = { status: response.status }
    return { data: null, error }
  }
  return { data, error: null }
}

async function uploadSnapshot(): Promise<void> {
  if (!supabase || !activeUserId || !cloudReady || hydrating) return
  const expectedUserId = activeUserId
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session?.user || sessionData.session.user.id !== expectedUserId || activeUserId !== expectedUserId) return
  if (uploadInFlight) {
    uploadQueued = true
    return
  }

  const userId = expectedUserId
  const lock = await acquireProgressSyncLock(userId)
  if (!lock) {
    // Another tab is already syncing this same account. Retry later; the
    // shared persisted signature will let us skip if its upload covers our state.
    scheduleUpload(MIN_UPLOAD_INTERVAL_MS)
    return
  }
  if (activeUserId !== userId || !cloudReady || hydrating) {
    lock.release()
    return
  }

  // Enforce the upload interval across every tab/window signed into this account,
  // not just within one JavaScript runtime. A tab that has new local work waits for
  // the next shared slot instead of racing another tab with another large snapshot.
  const sharedLastUploadAt = (() => {
    try { return Number(localStorage.getItem(persistedUploadAtKey(userId))) || 0 } catch { return 0 }
  })()
  const sharedCooldownRemaining = Math.max(0, MIN_UPLOAD_INTERVAL_MS - (Date.now() - sharedLastUploadAt))
  if (sharedCooldownRemaining > 0) {
    lock.release()
    scheduleUpload(sharedCooldownRemaining)
    return
  }

  uploadInFlight = true
  const key = dirtyKey(userId)
  const dirtyAtStart = (() => { try { return localStorage.getItem(key) } catch { return null } })()
  const snapshot = captureSnapshot()
  const snapshotSignature = progressSignature(snapshot)

  try {
    const signatureHash = await hashProgressSignature(snapshotSignature)
    const sharedSignature = (() => {
      try { return localStorage.getItem(persistedSignatureKey(userId)) } catch { return null }
    })()

    // A second tab can now recognize a cloud save completed by the first tab.
    // This prevents every open tab from re-uploading the same full snapshot.
    if (
      (lastUploadedUserId === userId && lastUploadedSignature === snapshotSignature) ||
      sharedSignature === signatureHash
    ) {
      lastUploadedUserId = userId
      lastUploadedSignature = snapshotSignature
      const stillUnchanged = progressSignature(captureSnapshot()) === snapshotSignature
      if (stillUnchanged && !uploadQueued) {
        try {
          if (localStorage.getItem(key) === dirtyAtStart) {
            localStorage.removeItem(key)
            localStorage.removeItem(LOCAL_DIRTY_KEY)
            localStorage.setItem(DIRTY_SECTIONS_KEY, '[]')
          }
        } catch { /* local-only mode remains available */ }
      } else {
        uploadQueued = false
        scheduleUpload(150)
      }
      return
    }

    // Reuse the version captured during hydration or the previous successful
    // write. A read is only needed when the version is unknown or a conflict occurs.
    let expectedUpdatedAt = cloudVersionLoaded ? cloudUpdatedAt : null
    let latestSnapshot: LearningProgressSnapshot | null = cloudSnapshot
    if (!cloudVersionLoaded) {
      const { data: latestResult, error: readError } = await supabase.functions.invoke('learning-progress', {
        body: { action: 'read' }
      })
      if (readError) throw readError
      expectedUpdatedAt = typeof latestResult?.updated_at === 'string' ? latestResult.updated_at : null
      latestSnapshot = latestResult?.data && isSnapshot(latestResult.data)
        ? latestResult.data as LearningProgressSnapshot
        : null
      cloudUpdatedAt = expectedUpdatedAt
      cloudVersionLoaded = true
      cloudSnapshot = latestSnapshot
    }
    let saved = false

    for (let attempt = 0; attempt < 3; attempt++) {
      const snapshotToUpload = latestSnapshot
        ? mergeSnapshots(snapshot, latestSnapshot, snapshot.changedSections, false)
        : snapshot
      snapshotToUpload.changedSections = []
      const { data: writeResult, error: writeError } = await invokeCompressedProgressWrite({
        action: 'write',
        data: snapshotToUpload,
        expected_updated_at: expectedUpdatedAt
      }, sessionData.session.access_token)

      if (!writeError && writeResult?.ok === true) {
        expectedUpdatedAt = typeof writeResult.updated_at === 'string' ? writeResult.updated_at : expectedUpdatedAt
        cloudUpdatedAt = expectedUpdatedAt
        cloudVersionLoaded = true
        lastUploadAt = Date.now()
        cloudSnapshot = snapshotToUpload
        lastUploadedUserId = userId
        lastUploadedSignature = snapshotSignature
        try {
          localStorage.setItem(persistedSignatureKey(userId), signatureHash)
          localStorage.setItem(persistedUploadAtKey(userId), String(lastUploadAt))
        } catch { /* cross-tab hints are optional; server save remains authoritative */ }
        saved = true
        break
      }
      if (!writeError) throw new Error('The progress service did not confirm the save.')

      const status = (writeError as { context?: { status?: number } }).context?.status
      const isConflict = status === 409 || /\\b409\\b/.test(writeError.message || '')
      if (!isConflict || attempt === 2) throw writeError

      const refreshed = await supabase.functions.invoke('learning-progress', {
        body: { action: 'read' }
      })
      if (refreshed.error) throw refreshed.error
      expectedUpdatedAt = typeof refreshed.data?.updated_at === 'string'
        ? refreshed.data.updated_at
        : null
      latestSnapshot = refreshed.data?.data && isSnapshot(refreshed.data.data)
        ? refreshed.data.data as LearningProgressSnapshot
        : null
      cloudUpdatedAt = expectedUpdatedAt
      cloudVersionLoaded = true
      cloudSnapshot = latestSnapshot
    }

    if (!saved) throw new Error('Study progress changed repeatedly on another device. It remains saved locally and will retry.')

    if (activeUserId !== userId) return
    try {
      localStorage.setItem(OWNER_KEY, userId)
      const currentDirtyAt = localStorage.getItem(key)
      if (currentDirtyAt === dirtyAtStart) {
        localStorage.removeItem(key)
        localStorage.removeItem(LOCAL_DIRTY_KEY)
        localStorage.setItem(DIRTY_SECTIONS_KEY, '[]')
      } else {
        uploadQueued = true
      }
    } catch { /* successful cloud write is not undone by local storage failures */ }
  } catch (error) {
    cloudReady = false
    console.warn('[Hyperion progress sync] Cloud save failed; progress remains local.', error)
    if (navigator.onLine !== false) retryTimer = setTimeout(() => { void initializeUser(userId) }, 5000)
  } finally {
    uploadInFlight = false
    lock.release()
    if (uploadQueued && activeUserId === userId) {
      uploadQueued = false
      scheduleUpload(150)
    }
  }
}

let legacyProgressCacheMigration: Promise<void> | null = null

async function migrateLegacyProgressCaches(): Promise<void> {
  if (!legacyProgressCacheMigration) {
    legacyProgressCacheMigration = (async () => {
      let keys: string[] = []
      try {
        keys = Array.from({ length: localStorage.length }, (_, index) => localStorage.key(index))
          .filter((key): key is string => typeof key === 'string' && key.startsWith('hyperion-progress-cache:'))
      } catch {
        return
      }
      for (const key of keys) {
        const raw = (() => { try { return localStorage.getItem(key) } catch { return null } })()
        if (!raw) continue
        try {
          await writeEncryptedPersistedValue(key, raw)
        } catch {
          // Keep a previous-version cache if encrypted migration is not possible.
        }
      }
    })().finally(() => { legacyProgressCacheMigration = null })
  }
  await legacyProgressCacheMigration
}

const initializationPromises = new Map<string, Promise<void>>()

async function initializeUser(userId: string): Promise<void> {
  const existing = initializationPromises.get(userId)
  if (existing) return existing

  const pending = initializeUserInternal(userId)
  initializationPromises.set(userId, pending)
  try {
    await pending
  } finally {
    if (initializationPromises.get(userId) === pending) initializationPromises.delete(userId)
  }
}

async function initializeUserInternal(userId: string): Promise<void> {
  if (!supabase) return
  await migrateLegacyProgressCaches()
  const { data: sessionData } = await supabase.auth.getSession()
  if (!sessionData.session?.user || sessionData.session.user.id !== userId) return
  if (cloudReady && activeUserId === userId) return
  const generation = ++currentGeneration
  if (uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null }
  cloudReady = false
  cloudUpdatedAt = null
  cloudVersionLoaded = false
  cloudSnapshot = null
  lastUploadedUserId = null
  lastUploadedSignature = null

  let ownerBeforeLoad: string | null = null
  try { ownerBeforeLoad = localStorage.getItem(OWNER_KEY) } catch { /* storage may be unavailable */ }
  if (ownerBeforeLoad && ownerBeforeLoad !== userId) {
    activeUserId = null
    // Keep an account-keyed recovery copy for offline work, but remove its live
    // stores from the browser before hydrating the new account.
    try {
      await writeEncryptedPersistedValue(accountCacheKey(ownerBeforeLoad), JSON.stringify(captureSnapshot()))
    } catch { /* encrypted recovery cache is best effort; never create a new plaintext cache */ }
    await clearLocalProgress()
    try { localStorage.removeItem(OWNER_KEY) } catch { /* ignore storage errors */ }
    if (generation !== currentGeneration) return
  }

  let row: CloudProgressRow | null = null
  try {
    const { data, error } = await supabase.functions.invoke('learning-progress', {
      body: { action: 'read' }
    })
    if (error) throw error
    row = data?.data && isSnapshot(data.data)
      ? { data: data.data as LearningProgressSnapshot, updated_at: typeof data.updated_at === 'string' ? data.updated_at : '' }
      : null
  } catch (error) {
    // Do not overwrite a local account's data when the cloud read fails. The user
    // can continue locally; reconnecting or re-authenticating will retry hydration.
    console.warn('[Hyperion progress sync] Cloud restore failed; keeping local progress.', error)
    window.dispatchEvent(new Event('hyperion:learning-progress-ready'))
    if (localStorage.getItem(OWNER_KEY) === userId) activeUserId = userId
    if (navigator.onLine !== false) {
      retryTimer = setTimeout(() => { void initializeUser(userId) }, 8000)
    }
    return
  }
  if (generation !== currentGeneration) return
  cloudUpdatedAt = row?.updated_at ?? null
  cloudVersionLoaded = true
  if (activeUserId !== userId) lastUploadAt = 0

  const owner = (() => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } })()
  let cachedSnapshot: LearningProgressSnapshot | null = null
  try {
    const cachedRaw = await readEncryptedPersistedValue(accountCacheKey(userId))
    const cached = parseJson<LearningProgressSnapshot>(cachedRaw)
    cachedSnapshot = cached && isSnapshot(cached) ? cached : null
  } catch { /* encrypted recovery cache is optional */ }
  const localDirty = (() => {
    try {
      return localStorage.getItem(dirtyKey(userId)) != null
        || (owner == null && localStorage.getItem(LOCAL_DIRTY_KEY) != null)
        || cachedSnapshot != null
    } catch { return cachedSnapshot != null }
  })()
  const localSnapshot = cachedSnapshot && owner !== userId ? cachedSnapshot : captureSnapshot()
  const remoteSnapshot = row && isSnapshot(row.data) ? row.data : null
  cloudSnapshot = remoteSnapshot
  let shouldUpload = false
  let snapshotToApply: LearningProgressSnapshot

  if (owner && owner !== userId) {
    // The browser previously belonged to a different account. Never merge its data
    // into this account; replace it with this user's cloud record or a clean state.
    if (remoteSnapshot) {
      snapshotToApply = remoteSnapshot
    } else {
      await clearLocalProgress()
      snapshotToApply = captureSnapshot()
      shouldUpload = true
    }
  } else if (remoteSnapshot && owner === userId && !localDirty) {
    snapshotToApply = remoteSnapshot
  } else if (remoteSnapshot && (owner == null || localDirty)) {
    snapshotToApply = mergeSnapshots(localSnapshot, remoteSnapshot, owner === userId ? localSnapshot.changedSections : [], owner == null)
    shouldUpload = true
  } else {
    // First login migrates this device's local progress. Existing owner data is kept
    // when a cloud row does not exist, which also recovers from a server-side outage.
    snapshotToApply = localSnapshot
    shouldUpload = true
  }

  try {
    await applySnapshot(snapshotToApply)
  } catch (error) {
    // Keep this device usable, but never silently mark failed encrypted restoration
    // as complete. A later retry can recover the cloud snapshot safely.
    console.warn('[Hyperion progress sync] Encrypted progress restore failed.', error)
    window.dispatchEvent(new Event('hyperion:learning-progress-ready'))
    if (retryTimer) clearTimeout(retryTimer)
    if (navigator.onLine !== false) retryTimer = setTimeout(() => { void initializeUser(userId) }, 8000)
    return
  }
  if (generation !== currentGeneration) return

  try {
    await removeEncryptedPersistedValue(accountCacheKey(userId))
    localStorage.setItem(OWNER_KEY, userId)
    if (!shouldUpload) {
      localStorage.removeItem(dirtyKey(userId))
      localStorage.removeItem(LOCAL_DIRTY_KEY)
    }
  } catch { /* sync remains best effort */ }

  activeUserId = userId
  if (!shouldUpload) {
    cloudSnapshot = snapshotToApply
    lastUploadedUserId = userId
    lastUploadedSignature = progressSignature(captureSnapshot())
    try {
      localStorage.setItem(
        persistedSignatureKey(userId),
        await hashProgressSignature(lastUploadedSignature)
      )
    } catch { /* cross-tab hint is optional */ }
  }
  cloudReady = true
  if (shouldUpload) {
    try {
      localStorage.setItem(dirtyKey(userId), String(Date.now()))
      localStorage.setItem(DIRTY_SECTIONS_KEY, JSON.stringify(ALL_PROGRESS_SECTIONS))
    } catch { /* retry marker optional */ }
    scheduleUpload(200)
  }
}

function markActiveSessionChanged(): void {
  if (hydrating) return
  try { localStorage.setItem(SESSION_CHANGED_AT_KEY, String(Date.now())) } catch { /* local-only mode remains available */ }
  noteLocalChange('practice')
}

function observeStoreChanges(): void {
  unsubscribeStores = [
    useHistoryStore.subscribe(() => noteLocalChange('history')),
    useStudyTimeStore.subscribe(() => noteLocalChange('studyTime')),
    useVaultStore.subscribe(() => noteLocalChange('vault')),
    useBookmarksStore.subscribe(() => noteLocalChange('bookmarks')),
    usePracticeStore.subscribe((state, previous) => {
      if (
        state.questions !== previous.questions
        || state.answers !== previous.answers
        || state.currentIndex !== previous.currentIndex
        || state.track !== previous.track
        || state.competenceId !== previous.competenceId
        || state.finished !== previous.finished
        || state.mode !== previous.mode
        || state.startedAt !== previous.startedAt
      ) markActiveSessionChanged()
    })
  ]

  // Progress sync is driven by meaningful store mutations. No periodic full-snapshot
  // heartbeat is needed while a user is merely reading a question.
}

export function startLearningProgressSync(): () => void {
  const client = supabase
  if (!client || started) return () => undefined
  started = true
  observeStoreChanges()

  const onOnline = () => {
    if (activeUserId) {
      cloudReady = false
      void initializeUser(activeUserId)
    } else {
      void client.auth.getSession().then(({ data }) => {
        if (data.session?.user) void initializeUser(data.session.user.id)
      })
    }
  }
  window.addEventListener('online', onOnline)
  const handleMockPlanChange = () => noteLocalChange('mockPlan')
  const handleSavedPracticeChange = () => noteLocalChange('practice')
  window.addEventListener('hyperion:progress-local-change', handleMockPlanChange)
  window.addEventListener('hyperion:practice-progress-saved', handleSavedPracticeChange)

  authSubscription = client.auth.onAuthStateChange((_event, session) => {
    // Avoid doing Supabase queries synchronously inside the auth callback.
    window.setTimeout(() => {
      const userId = session?.user?.id ?? null
      if (!userId) {
        currentGeneration++
        activeUserId = null
        cloudReady = false
        cloudUpdatedAt = null
        cloudVersionLoaded = false
        lastUploadAt = 0
        lastUploadedUserId = null
        lastUploadedSignature = null
        cloudSnapshot = null
        if (uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null }
        return
      }
      if (userId !== activeUserId || !cloudReady) void initializeUser(userId)
    }, 0)
  }).data.subscription

  void client.auth.getSession().then(({ data }) => {
    if (data.session?.user) void initializeUser(data.session.user.id)
  }).catch((error) => console.warn('[Hyperion progress sync] Unable to read current auth session.', error))

  return () => {
    started = false
    currentGeneration++
    activeUserId = null
    cloudReady = false
    if (uploadTimer) clearTimeout(uploadTimer)
    if (retryTimer) clearTimeout(retryTimer)
    cloudUpdatedAt = null
    lastUploadedUserId = null
    lastUploadedSignature = null
    cloudSnapshot = null
    cloudVersionLoaded = false
    lastUploadAt = 0
    window.removeEventListener('online', onOnline)
    window.removeEventListener('hyperion:progress-local-change', handleMockPlanChange)
    window.removeEventListener('hyperion:practice-progress-saved', handleSavedPracticeChange)
    authSubscription?.unsubscribe()
    authSubscription = null
    unsubscribeStores.forEach((unsubscribe) => unsubscribe())
    unsubscribeStores = []
  }
}
