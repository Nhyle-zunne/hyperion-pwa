import type { Question, TrackId, UserAnswer } from '../types/question'
import type { SessionMode } from '../stores/historyStore'
import { useHistoryStore } from '../stores/historyStore'
import { useStudyTimeStore } from '../stores/studyTimeStore'
import { useVaultStore } from '../stores/vaultStore'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { usePracticeStore } from '../stores/practiceStore'
import { supabase } from './supabase'

const TABLE = 'user_learning_progress'
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
  'hyperion-mock-exam-plan-v1'
] as const

type ProgressStorageKey = typeof STORAGE_KEYS[number]
type ProgressSection = 'history' | 'studyTime' | 'vault' | 'bookmarks' | 'practice' | 'mockPlan' | 'other'
const ALL_PROGRESS_SECTIONS: ProgressSection[] = ['history', 'studyTime', 'vault', 'bookmarks', 'practice', 'mockPlan']

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
let heartbeatTimer: ReturnType<typeof setInterval> | null = null
let currentGeneration = 0
let uploadInFlight = false
let uploadQueued = false
let unsubscribeStores: (() => void)[] = []
let authSubscription: { unsubscribe: () => void } | null = null

const dirtyKey = (userId: string) => DIRTY_PREFIX + userId

function readDirtySections(): ProgressSection[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(DIRTY_SECTIONS_KEY) || '[]') as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter((item): item is ProgressSection =>
      ['history', 'studyTime', 'vault', 'bookmarks', 'practice', 'mockPlan', 'other'].includes(item)
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
  }
}

function readLocalStorage(): Record<ProgressStorageKey, string | null> {
  const storage = {} as Record<ProgressStorageKey, string | null>
  for (const key of STORAGE_KEYS) {
    try { storage[key] = localStorage.getItem(key) } catch { storage[key] = null }
  }
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

function mergePersistedStore(
  key: ProgressStorageKey,
  localRaw: string | null,
  remoteRaw: string | null,
  preferLocalSection: boolean,
  allowMigrationMerge: boolean
): string | null {
  if (!localRaw) return remoteRaw
  if (!remoteRaw) return localRaw
  if (preferLocalSection && key !== 'hyperion-mock-exam-plan-v1') return localRaw
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
        savedSessions: localSaved.length ? mergeById(remoteSaved, localSaved, 'savedAt').slice(0, 100) : remoteSaved
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
    return JSON.stringify({ version: local.version ?? remote.version ?? 0, state: { ...rs, ...ls, [stateKey]: merged } })
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
    useStudyTimeStore.setState({ segments: [] })
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
  if (uploadTimer) clearTimeout(uploadTimer)
  uploadTimer = setTimeout(() => { void uploadSnapshot() }, delay)
}

async function uploadSnapshot(): Promise<void> {
  if (!supabase || !activeUserId || !cloudReady || hydrating) return
  if (uploadInFlight) {
    uploadQueued = true
    return
  }
  uploadInFlight = true
  const userId = activeUserId
  const key = dirtyKey(userId)
  const dirtyAtStart = (() => { try { return localStorage.getItem(key) } catch { return null } })()
  const snapshot = captureSnapshot()

  try {
    // Merge against the latest cloud record before writing so progress from another
    // device (history, study-time segments, bookmarks, and mistakes) is not discarded.
    const { data: latestRow, error: readError } = await supabase
      .from(TABLE)
      .select('data')
      .eq('user_id', userId)
      .maybeSingle()
    if (readError) throw readError

    const latestSnapshot = latestRow?.data && isSnapshot(latestRow.data)
      ? latestRow.data as LearningProgressSnapshot
      : null
    const snapshotToUpload = latestSnapshot
      ? mergeSnapshots(snapshot, latestSnapshot, snapshot.changedSections, false)
      : snapshot
    snapshotToUpload.changedSections = []
    const { error } = await supabase
      .from(TABLE)
      .upsert({ user_id: userId, data: snapshotToUpload }, { onConflict: 'user_id' })

    if (error) {
      cloudReady = false
      // Keep the dirty marker for retry when the connection/API is available again.
      if (navigator.onLine !== false) retryTimer = setTimeout(() => { void initializeUser(userId) }, 5000)
      return
    }

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
    if (uploadQueued && activeUserId === userId) {
      uploadQueued = false
      scheduleUpload(150)
    }
  }
}

async function initializeUser(userId: string): Promise<void> {
  if (!supabase) return
  if (cloudReady && activeUserId === userId) return
  const generation = ++currentGeneration
  if (uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null }
  cloudReady = false

  let ownerBeforeLoad: string | null = null
  try { ownerBeforeLoad = localStorage.getItem(OWNER_KEY) } catch { /* storage may be unavailable */ }
  if (ownerBeforeLoad && ownerBeforeLoad !== userId) {
    activeUserId = null
    // Keep an account-keyed recovery copy for offline work, but remove its live
    // stores from the browser before hydrating the new account.
    try { localStorage.setItem(accountCacheKey(ownerBeforeLoad), JSON.stringify(captureSnapshot())) } catch { /* best effort local recovery */ }
    await clearLocalProgress()
    try { localStorage.removeItem(OWNER_KEY) } catch { /* ignore storage errors */ }
    if (generation !== currentGeneration) return
  }

  let row: CloudProgressRow | null = null
  try {
    const { data, error } = await supabase
      .from(TABLE)
      .select('data, updated_at')
      .eq('user_id', userId)
      .maybeSingle()
    if (error) throw error
    row = data as CloudProgressRow | null
  } catch (error) {
    // Do not overwrite a local account's data when the cloud read fails. The user
    // can continue locally; reconnecting or re-authenticating will retry hydration.
    console.warn('[Hyperion progress sync] Cloud restore failed; keeping local progress.', error)
    if (localStorage.getItem(OWNER_KEY) === userId) activeUserId = userId
    if (navigator.onLine !== false) {
      retryTimer = setTimeout(() => { void initializeUser(userId) }, 8000)
    }
    return
  }
  if (generation !== currentGeneration) return

  const owner = (() => { try { return localStorage.getItem(OWNER_KEY) } catch { return null } })()
  const cachedSnapshot = (() => {
    try {
      const cached = parseJson<LearningProgressSnapshot>(localStorage.getItem(accountCacheKey(userId)))
      return cached && isSnapshot(cached) ? cached : null
    } catch { return null }
  })()
  const localDirty = (() => {
    try {
      return localStorage.getItem(dirtyKey(userId)) != null
        || (owner == null && localStorage.getItem(LOCAL_DIRTY_KEY) != null)
        || cachedSnapshot != null
    } catch { return cachedSnapshot != null }
  })()
  const localSnapshot = cachedSnapshot && owner !== userId ? cachedSnapshot : captureSnapshot()
  const remoteSnapshot = row && isSnapshot(row.data) ? row.data : null
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

  await applySnapshot(snapshotToApply)
  if (generation !== currentGeneration) return

  try {
    localStorage.removeItem(accountCacheKey(userId))
    localStorage.setItem(OWNER_KEY, userId)
    if (!shouldUpload) {
      localStorage.removeItem(dirtyKey(userId))
      localStorage.removeItem(LOCAL_DIRTY_KEY)
    }
  } catch { /* sync remains best effort */ }

  activeUserId = userId
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

  heartbeatTimer = setInterval(() => {
    const s = usePracticeStore.getState()
    if (s.questions.length && !s.finished) noteLocalChange('practice')
  }, 10000)
}

export function startLearningProgressSync(): () => void {
  if (!supabase || started) return () => undefined
  started = true
  observeStoreChanges()

  const onOnline = () => {
    if (activeUserId) {
      cloudReady = false
      void initializeUser(activeUserId)
    } else {
      void supabase.auth.getSession().then(({ data }) => {
        if (data.session?.user) void initializeUser(data.session.user.id)
      })
    }
  }
  window.addEventListener('online', onOnline)
  const handleMockPlanChange = () => noteLocalChange('mockPlan')
  window.addEventListener('hyperion:progress-local-change', handleMockPlanChange)

  authSubscription = supabase.auth.onAuthStateChange((_event, session) => {
    // Avoid doing Supabase queries synchronously inside the auth callback.
    window.setTimeout(() => {
      const userId = session?.user?.id ?? null
      if (!userId) {
        currentGeneration++
        activeUserId = null
        cloudReady = false
        if (uploadTimer) { clearTimeout(uploadTimer); uploadTimer = null }
        return
      }
      if (userId !== activeUserId || !cloudReady) void initializeUser(userId)
    }, 0)
  }).data.subscription

  void supabase.auth.getSession().then(({ data }) => {
    if (data.session?.user) void initializeUser(data.session.user.id)
  }).catch((error) => console.warn('[Hyperion progress sync] Unable to read current auth session.', error))

  return () => {
    started = false
    currentGeneration++
    activeUserId = null
    cloudReady = false
    if (uploadTimer) clearTimeout(uploadTimer)
    if (retryTimer) clearTimeout(retryTimer)
    if (heartbeatTimer) clearInterval(heartbeatTimer)
    window.removeEventListener('online', onOnline)
    window.removeEventListener('hyperion:progress-local-change', handleMockPlanChange)
    authSubscription?.unsubscribe()
    authSubscription = null
    unsubscribeStores.forEach((unsubscribe) => unsubscribe())
    unsubscribeStores = []
  }
}
