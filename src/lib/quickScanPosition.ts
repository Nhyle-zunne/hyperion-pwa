import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { TrackId } from '../types/question'

/**
 * Device-local Quick Scan reading cursors. They deliberately do NOT participate
 * in the encrypted cloud-progress snapshot, Supabase sync, or session archives.
 * Only compact metadata (account scope, competence, index, timestamp, question
 * ID) is stored — never question text or the licensed question bank itself.
 */
export interface QuickScanPosition {
  id: string
  ownerId: string
  track: TrackId
  competenceId: string
  questionIndex: number
  questionId: string
  savedAt: number
}

interface QuickScanPositionDatabase extends DBSchema {
  positions: { key: string; value: QuickScanPosition }
}

const DB_NAME = 'hyperion-quick-scan-reading-position'
const DB_VERSION = 1
const FALLBACK_PREFIX = 'hyperion:quick-scan-reading:v1:'
let dbPromise: Promise<IDBPDatabase<QuickScanPositionDatabase>> | null = null
let writeQueue: Promise<void> = Promise.resolve()

/** Uses the same per-account identity already maintained by local progress. */
export function quickScanLocalOwner(): string {
  try {
    return localStorage.getItem('hyperion-progress-owner') || 'device'
  } catch {
    return 'device'
  }
}

function storageKey(ownerId: string, track: TrackId, competenceId: string): string {
  return `${ownerId}:${track}:${competenceId}`
}

function database(): Promise<IDBPDatabase<QuickScanPositionDatabase>> {
  if (!dbPromise) {
    dbPromise = openDB<QuickScanPositionDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('positions')) {
          db.createObjectStore('positions', { keyPath: 'id' })
        }
      }
    }).catch(error => {
      dbPromise = null // Browser may allow IndexedDB again after private mode ends.
      throw error
    })
  }
  return dbPromise
}

function validPosition(value: unknown, ownerId: string, track: TrackId): value is QuickScanPosition {
  if (!value || typeof value !== 'object') return false
  const row = value as Partial<QuickScanPosition>
  return row.ownerId === ownerId && row.track === track &&
    typeof row.competenceId === 'string' && row.competenceId.length > 0 &&
    row.id === storageKey(ownerId, track, row.competenceId) &&
    Number.isSafeInteger(row.questionIndex) && Number(row.questionIndex) >= 0 &&
    typeof row.questionId === 'string' &&
    Number.isFinite(row.savedAt) && Number(row.savedAt) > 0
}

function fallbackRead(id: string): unknown {
  try {
    const raw = localStorage.getItem(FALLBACK_PREFIX + id)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function fallbackList(ownerId: string, track: TrackId): unknown[] {
  try {
    const prefix = FALLBACK_PREFIX + storageKey(ownerId, track, '')
    const values: unknown[] = []
    for (let index = 0; index < localStorage.length; index++) {
      const key = localStorage.key(index)
      if (key?.startsWith(prefix)) values.push(fallbackRead(key.slice(FALLBACK_PREFIX.length)))
    }
    return values
  } catch {
    return []
  }
}

/** IndexedDB transactions serialize writes even from different tabs. A stale tab
 * must not replace a newer reading cursor just because it finishes later. */
async function putIfNewer(db: IDBPDatabase<QuickScanPositionDatabase>, row: QuickScanPosition): Promise<QuickScanPosition> {
  const tx = db.transaction('positions', 'readwrite')
  const previous = await tx.store.get(row.id)
  const newest = previous && validPosition(previous, row.ownerId, row.track) &&
      previous.savedAt > row.savedAt ? previous : row
  if (newest === row) await tx.store.put(row)
  await tx.done
  return newest
}

function clearOlderFallback(row: QuickScanPosition): void {
  try {
    const key = FALLBACK_PREFIX + row.id
    const local = fallbackRead(row.id)
    if (!validPosition(local, row.ownerId, row.track) || local.savedAt <= row.savedAt) {
      localStorage.removeItem(key)
    }
  } catch { /* Browser storage might be blocked; IndexedDB remains authoritative. */ }
}

/** Use the newer cursor when a browser temporarily fell back to localStorage
 * and IndexedDB subsequently became available again. Recover it into IDB. */
async function importFallback(
  db: IDBPDatabase<QuickScanPositionDatabase>,
  ownerId: string,
  track: TrackId,
  competenceId: string,
  indexed: QuickScanPosition | null
): Promise<QuickScanPosition | null> {
  const local = fallbackRead(storageKey(ownerId, track, competenceId))
  if (!validPosition(local, ownerId, track) || local.competenceId !== competenceId) return indexed
  if (indexed && indexed.savedAt >= local.savedAt) {
    clearOlderFallback(indexed)
    return indexed
  }
  if (ownerId !== quickScanLocalOwner()) return null
  const newest = await putIfNewer(db, local)
  if (ownerId !== quickScanLocalOwner()) return null
  clearOlderFallback(newest)
  return newest
}

/** One local IndexedDB read; a same-device fallback is used if IDB is blocked. */
export async function getQuickScanPosition(
  track: TrackId,
  competenceId: string,
  ownerId = quickScanLocalOwner()
): Promise<QuickScanPosition | null> {
  await writeQueue
  if (ownerId !== quickScanLocalOwner()) return null
  const id = storageKey(ownerId, track, competenceId)
  let saved: QuickScanPosition | null = null
  try {
    const db = await database()
    const raw: unknown = await db.get('positions', id)
    const indexed = validPosition(raw, ownerId, track) && raw.competenceId === competenceId ? raw : null
    saved = await importFallback(db, ownerId, track, competenceId, indexed)
  } catch {
    const local = fallbackRead(id)
    saved = validPosition(local, ownerId, track) && local.competenceId === competenceId ? local : null
  }
  if (ownerId !== quickScanLocalOwner()) return null
  return saved
}

/** One small local cursor per competence, never uploaded to Supabase. */
export async function listQuickScanPositions(
  track: TrackId,
  ownerId = quickScanLocalOwner()
): Promise<QuickScanPosition[]> {
  await writeQueue
  if (ownerId !== quickScanLocalOwner()) return []
  let rows: unknown[] = []
  try {
    const db = await database()
    rows = await db.getAll('positions')
    // Reconcile only this owner's current track. Avoid reading/decrypting
    // banks or triggering any cloud sync for a simple competence directory.
    const indexed = new Map(
      rows.filter((row): row is QuickScanPosition => validPosition(row, ownerId, track))
        .map(row => [row.competenceId, row])
    )
    for (const raw of fallbackList(ownerId, track)) {
      if (!validPosition(raw, ownerId, track)) continue
      const recovered = await importFallback(
        db, ownerId, track, raw.competenceId, indexed.get(raw.competenceId) ?? null
      )
      if (recovered) indexed.set(raw.competenceId, recovered)
    }
    rows = [...indexed.values()]
  } catch {
    // If IndexedDB is unavailable, keep the localStorage fallback usable.
    rows = fallbackList(ownerId, track)
  }
  if (ownerId !== quickScanLocalOwner()) return []
  return rows.filter((row): row is QuickScanPosition => validPosition(row, ownerId, track))
    .sort((left, right) => right.savedAt - left.savedAt)
}

/**
 * Serializing writes prevents a slower older IndexedDB transaction from
 * replacing a newer page after fast Next/Previous or Jump interactions.
 * Reads await pending saves so returning to the directory immediately works.
 */
export function saveQuickScanPosition(
  track: TrackId,
  competenceId: string,
  questionIndex: number,
  questionId: string,
  ownerId = quickScanLocalOwner()
): Promise<void> {
  if (!Number.isSafeInteger(questionIndex) || questionIndex < 0 ||
      !competenceId || typeof questionId !== 'string' || !questionId) return Promise.resolve()
  const position: QuickScanPosition = {
    id: storageKey(ownerId, track, competenceId),
    ownerId, track, competenceId, questionIndex, questionId, savedAt: Date.now()
  }
  writeQueue = writeQueue.catch(() => {}).then(async () => {
    // A signed-out or switched account must not commit a late previous owner's
    // cursor under the new account. Storage is local and optional.
    if (ownerId !== quickScanLocalOwner()) return
    try {
      const newest = await putIfNewer(await database(), position)
      if (ownerId === quickScanLocalOwner()) clearOlderFallback(newest)
    } catch {
      // Preserve the newest local cursor even if IndexedDB becomes unavailable.
      // A later read reconciles the fallback with the restored database.
      const prior = fallbackRead(position.id)
      if (validPosition(prior, ownerId, track) && prior.savedAt > position.savedAt) return
      if (ownerId !== quickScanLocalOwner()) return
      try { localStorage.setItem(FALLBACK_PREFIX + position.id, JSON.stringify(position)) }
      catch { /* The reader remains usable when browser storage is unavailable. */ }
    }
  })
  return writeQueue
}
