import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId, UserAnswer } from '../types/question'
import { decryptSessionSnapshot, encryptSessionSnapshot } from './sessionSnapshotCrypto.mjs'

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
}

interface StoredSessionSnapshot {
  id: string
  // Only non-sensitive fields stay in cleartext so paid snapshots can be deleted
  // after revocation without decrypting the archived question text.
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
  snapshot: SessionSnapshot
): Promise<StoredSessionSnapshot> {
  const key = await getOrCreateEncryptionKey(db)
  const encrypted = await encryptSessionSnapshot(snapshot, key)
  return {
    id,
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
  return queueWrite(async () => {
    const db = await database()
    await migrateLegacySnapshots(db)
    const encrypted = await makeEncryptedRecord(db, id, snapshot)
    await db.put('snapshots', encrypted)
  })
}

export function getSessionSnapshot(id: string): Promise<SessionSnapshot | null> {
  return queueWrite(async () => {
    try {
      const db = await database()
      await migrateLegacySnapshots(db)
      const record = await db.get('snapshots', id)
      if (!record) return null
      if (record.ciphertext && record.iv) {
        const key = await getOrCreateEncryptionKey(db)
        const snapshot = await decryptSessionSnapshot<unknown>(record.iv, record.ciphertext, key)
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

/** Remove locally cached paid question text for a track whose entitlement is no longer active. */
export function deletePaidQuestionSnapshotsForTrack(track: TrackId): Promise<string[]> {
  return queueWrite(async () => {
    const db = await database()
    await migrateLegacySnapshots(db)
    const tx = db.transaction('snapshots', 'readwrite')
    const records = await tx.store.getAll()
    const expired = records.filter(record =>
      (record.track ?? record.snapshot?.track) === track &&
      (record.isFreeSession ?? record.snapshot?.isFreeSession) !== true
    )
    await Promise.all(expired.map(record => tx.store.delete(record.id)))
    await tx.done
    return expired.map(record => record.id)
  })
}

export function deleteSessionSnapshot(id: string): Promise<void> {
  return queueWrite(async () => {
    const db = await database()
    await db.delete('snapshots', id)
  })
}
