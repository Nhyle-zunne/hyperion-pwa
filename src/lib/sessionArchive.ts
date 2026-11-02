import type { SavedQuestionContext } from './savedQuestionSets'
import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId, UserAnswer } from '../types/question'
import { supabase } from './supabase'
import { decryptJsonPayload, encryptJsonPayload } from './jsonPayloadCrypto.mjs'

export type ArchivedSessionMode = 'PRACTICE' | 'DRILL' | 'MOCK'

export interface SessionSnapshot {
  sessionId: string
  questions: Question[]
  answers: Record<string, UserAnswer>
  currentIndex: number
  track: TrackId
  competenceId: string | null
  part: number | null
  mode: ArchivedSessionMode
  isFreeSession?: boolean
  startedAt: number
  timeLimitSec: number
  timeLeftSec: number
  streak: number
  bestStreak: number
  finished: boolean
  source?: SavedQuestionContext | null
}

interface StoredSessionSnapshot {
  id: string
  ownerId?: string | null
  finished?: boolean
  // Only non-sensitive ownership, completion and track metadata stay in cleartext;
  // question text and answers remain encrypted.
  track?: TrackId
  isFreeSession?: boolean
  // Legacy DB v1 records are migrated on first archive access.
  snapshot?: SessionSnapshot
  iv?: Uint8Array
  ciphertext?: Uint8Array
}

interface SessionArchiveDatabase extends DBSchema {
  snapshots: { key: string; value: StoredSessionSnapshot }
  keys: { key: string; value: { id: string; key: CryptoKey } }
}

const DATABASE_NAME = 'hyperion-session-archive'
const DATABASE_VERSION = 2
const ENCRYPTION_KEY_ID = 'session-snapshot-key'
let databasePromise: Promise<IDBPDatabase<SessionArchiveDatabase>> | null = null
let legacySnapshotsMigrated = false
let writeQueue: Promise<unknown> = Promise.resolve()

function database() {
  if (!databasePromise) {
    databasePromise = openDB<SessionArchiveDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'id' })
        }
        if (!db.objectStoreNames.contains('keys')) {
          db.createObjectStore('keys', { keyPath: 'id' })
        }
      }
    })
  }
  return databasePromise
}

// Serialize writes and reads that migrate old records so an older snapshot cannot
// overwrite a newer answer/navigation state.
function queueWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(work, work)
  writeQueue = result.then(() => undefined, () => undefined)
  return result
}

async function getOrCreateEncryptionKey(db: IDBPDatabase<SessionArchiveDatabase>): Promise<CryptoKey> {
  const found = await db.get('keys', ENCRYPTION_KEY_ID)
  if (found) return found.key

  // Generate outside the IDB transaction, then re-check atomically to handle
  // a second tab opening the archive at the same time.
  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const tx = db.transaction('keys', 'readwrite')
  const current = await tx.store.get(ENCRYPTION_KEY_ID)
  if (current) {
    await tx.done
    return current.key
  }
  await tx.store.put({ id: ENCRYPTION_KEY_ID, key: generated })
  await tx.done
  return generated
}

async function makeEncryptedRecord(
  db: IDBPDatabase<SessionArchiveDatabase>,
  id: string,
  snapshot: SessionSnapshot,
  ownerId: string | null = localStorage.getItem('hyperion-progress-owner')
): Promise<StoredSessionSnapshot> {
  const key = await getOrCreateEncryptionKey(db)
  const encrypted = await encryptJsonPayload(snapshot, key)
  return {
    id,
    ownerId,
    finished: snapshot.finished,
    track: snapshot.track,
    isFreeSession: snapshot.isFreeSession === true,
    iv: encrypted.iv,
    ciphertext: encrypted.ciphertext
  }
}

async function migrateLegacySnapshots(db: IDBPDatabase<SessionArchiveDatabase>) {
  if (legacySnapshotsMigrated) return
  const records = await db.getAll('snapshots')
  for (const record of records) {
    if (!record.snapshot || record.ciphertext) continue
    const encrypted = await makeEncryptedRecord(db, record.id, record.snapshot)
    // Recheck inside the write transaction. If another tab already replaced this
    // record, do not overwrite its newer encrypted snapshot with the legacy copy.
    const tx = db.transaction('snapshots', 'readwrite')
    const current = await tx.store.get(record.id)
    if (current?.snapshot && !current.ciphertext) await tx.store.put(encrypted)
    await tx.done
  }
  legacySnapshotsMigrated = true
}

function isSessionSnapshot(value: unknown): value is SessionSnapshot {
  if (!value || typeof value !== 'object') return false
  const snapshot = value as Partial<SessionSnapshot>
  return typeof snapshot.sessionId === 'string' &&
    Array.isArray(snapshot.questions) &&
    typeof snapshot.track === 'string' &&
    typeof snapshot.startedAt === 'number' &&
    typeof snapshot.finished === 'boolean'
}

export function saveSessionSnapshot(id: string, snapshot: SessionSnapshot): Promise<void> {
  const ownerId = localStorage.getItem('hyperion-progress-owner')
  return queueWrite(async () => {
    const db = await database()
    await migrateLegacySnapshots(db)
    const previous = await db.get('snapshots', id)
    if (previous && previous.finished !== false && previous.ciphertext && previous.iv) {
      try {
        const key = await getOrCreateEncryptionKey(db)
        const older = await decryptJsonPayload<SessionSnapshot>(previous.iv, previous.ciphertext, key)
        if (older.finished) return
      } catch { /* A verified replacement may repair an unreadable local copy. */ }
    }
    const encrypted = await makeEncryptedRecord(db, id, snapshot, ownerId)
    await db.put('snapshots', encrypted)
    window.dispatchEvent(new Event('hyperion:session-archive-saved'))
  })
}

function getLocalSessionSnapshot(id: string): Promise<SessionSnapshot | null> {
  return queueWrite(async () => {
    try {
      const db = await database()
      await migrateLegacySnapshots(db)
      const record = await db.get('snapshots', id)
      if (!record) return null
      const owner = localStorage.getItem('hyperion-progress-owner')
      if (record.ownerId && record.ownerId !== owner) return null
      if (record.ciphertext && record.iv) {
        const key = await getOrCreateEncryptionKey(db)
        const snapshot = await decryptJsonPayload<unknown>(record.iv, record.ciphertext, key)
        return isSessionSnapshot(snapshot) ? snapshot : null
      }
      // A migration failure should never return an unencrypted legacy record to
      // the app. It remains intact for a future retry instead.
      return null
    } catch {
      return null
    }
  })
}

export type SessionSnapshotLoad = {
  snapshot: SessionSnapshot | null
  status: 'ready' | 'offline' | 'unavailable' | 'not-found' | 'sign-in-required' | 'account-changed'
  cached?: boolean
}

/** Missing archives and failed downloads need different recovery actions in History. */
export async function loadSessionSnapshot(id: string): Promise<SessionSnapshotLoad> {
  const owner = localStorage.getItem('hyperion-progress-owner')
  const local = await getLocalSessionSnapshot(id)
  if (localStorage.getItem('hyperion-progress-owner') !== owner) return { snapshot: null, status: 'account-changed' }
  if (local) return { snapshot: local, status: 'ready', cached: true }
  if (navigator.onLine === false) return { snapshot: null, status: 'offline' }
  if (!supabase) return { snapshot: null, status: 'unavailable' }
  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session) return { snapshot: null, status: 'sign-in-required' }
    if (owner !== session.user.id || localStorage.getItem('hyperion-progress-owner') !== owner) return { snapshot: null, status: 'account-changed' }
    const response = await supabase.functions.invoke('learning-progress', {
      headers: { Authorization: `Bearer ${session.access_token}` },
      body: { action: 'read-session', sessionId: id }
    })
    if (localStorage.getItem('hyperion-progress-owner') !== owner) return { snapshot: null, status: 'account-changed' }
    if (response.error) return { snapshot: null, status: 'unavailable' }
    // Older function deployments return a progress row for unrecognized actions.
    // Only an explicit archive response can establish that no cloud copy exists.
    if (!response.data || !Object.prototype.hasOwnProperty.call(response.data, 'snapshot')) return { snapshot: null, status: 'unavailable' }
    if (response.data.snapshot === null) return { snapshot: null, status: 'not-found' }
    if (!isSessionSnapshot(response.data.snapshot) || response.data.snapshot.sessionId !== id) return { snapshot: null, status: 'unavailable' }
    try {
      await saveSessionSnapshot(id, response.data.snapshot)
      if (localStorage.getItem('hyperion-progress-owner') !== owner) return { snapshot: null, status: 'account-changed' }
      return { snapshot: response.data.snapshot, status: 'ready', cached: true }
    } catch {
      // An online review can still open when the device cannot cache it.
      if (localStorage.getItem('hyperion-progress-owner') !== owner) return { snapshot: null, status: 'account-changed' }
      return { snapshot: response.data.snapshot, status: 'ready', cached: false }
    }
  } catch { return { snapshot: null, status: 'unavailable' } }
}

export async function getSessionSnapshot(id: string, localOnly = false): Promise<SessionSnapshot | null> {
  return localOnly ? getLocalSessionSnapshot(id) : (await loadSessionSnapshot(id)).snapshot
}

// Failures pause background work, never delete or acknowledge pending snapshots.
// Keys include the account so a failed sync cannot throttle another user's work.
const archiveRetryState = new Map<string, { failures: number; nextAt: number }>()
const missingArchiveRetryAt = new Map<string, number>()
function deferArchiveSync(userId: string, status?: number): void {
  const failures = (archiveRetryState.get(userId)?.failures ?? 0) + 1
  const delay = status === 400 || status === 404 || status === 401 || status === 403
    ? 15 * 60_000
    : Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5))
  archiveRetryState.set(userId, { failures, nextAt: Date.now() + delay })
}

let archiveSyncRunning = false
let archiveSyncQueued: { userId: string; ids: string[] } | null = null
/** Upload and cache audits independently so a large history never bloats the progress snapshot. */
export async function syncSessionArchives(userId: string, ids: string[]): Promise<void> {
  if (!supabase || navigator.onLine === false) return
  if ((archiveRetryState.get(userId)?.nextAt ?? 0) > Date.now()) return
  if (archiveSyncRunning) { archiveSyncQueued = { userId, ids }; return }
  archiveSyncRunning = true
  try {
    const { data } = await supabase.auth.getSession()
    const session = data.session
    if (!session || session.user.id !== userId) return
    for (const id of new Set(ids)) {
      if (localStorage.getItem('hyperion-progress-owner') !== userId) return
      const local = await getLocalSessionSnapshot(id)
      if (localStorage.getItem('hyperion-progress-owner') !== userId) return
      if (!local) {
        const retryKey = userId + ':' + id
        if ((missingArchiveRetryAt.get(retryKey) ?? 0) > Date.now()) continue
        const result = await loadSessionSnapshot(id)
        if (result.status === 'unavailable' || result.status === 'sign-in-required') {
          deferArchiveSync(userId)
          return
        }
        if (result.status === 'account-changed') return
        if (result.status === 'not-found') missingArchiveRetryAt.set(retryKey, Date.now() + 15 * 60_000)
        else missingArchiveRetryAt.delete(retryKey)
        continue
      }
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(local))))]
        .map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (localStorage.getItem('hyperion-progress-owner') !== userId) return
      const marker = `hyperion-archive-synced:${userId}:${id}`
      if (localStorage.getItem(marker) === hash) continue
      const response = await supabase.functions.invoke('learning-progress', {
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: { action: 'write-session', sessionId: id, snapshot: local }
      })
      if (response.error || response.data?.ok !== true) {
        deferArchiveSync(userId, (response.error as { context?: { status?: number } } | null)?.context?.status)
        return
      }
      if (localStorage.getItem('hyperion-progress-owner') === userId) localStorage.setItem(marker, hash)
    }
    archiveRetryState.delete(userId)
  } catch {
    deferArchiveSync(userId)
  } finally {
    archiveSyncRunning = false
    const queued = archiveSyncQueued
    archiveSyncQueued = null
    if (queued) void syncSessionArchives(queued.userId, queued.ids).catch(() => undefined)
  }
}

/** Retained for older callers: license expiry must not delete saved audits. */
export async function deletePaidQuestionSnapshotsForTrack(_track: TrackId): Promise<string[]> {
  // Saved audits are user data. Authorization is checked when opening them.
  return []
}

export function deleteSessionSnapshot(id: string): Promise<void> {
  return queueWrite(async () => {
    const db = await database()
    await migrateLegacySnapshots(db)
    await db.delete('snapshots', id)
  })
}
