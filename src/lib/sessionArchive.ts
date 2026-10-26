import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId, UserAnswer } from '../types/question'

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

interface SessionArchiveDatabase extends DBSchema {
  snapshots: {
    key: string
    value: { id: string; snapshot: SessionSnapshot }
  }
}

const DATABASE_NAME = 'hyperion-session-archive'
const DATABASE_VERSION = 1
let databasePromise: Promise<IDBPDatabase<SessionArchiveDatabase>> | null = null
let writeQueue: Promise<unknown> = Promise.resolve()

function database() {
  if (!databasePromise) {
    databasePromise = openDB<SessionArchiveDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'id' })
        }
      }
    })
  }
  return databasePromise
}

// Serialize writes so a quick sequence of answers/navigation cannot let an older
// snapshot overwrite a newer one.
function queueWrite<T>(work: () => Promise<T>): Promise<T> {
  const result = writeQueue.then(work, work)
  writeQueue = result.then(() => undefined, () => undefined)
  return result
}

export function saveSessionSnapshot(id: string, snapshot: SessionSnapshot): Promise<void> {
  return queueWrite(async () => {
    const db = await database()
    await db.put('snapshots', { id, snapshot })
  })
}

export async function getSessionSnapshot(id: string): Promise<SessionSnapshot | null> {
  try {
    await writeQueue
    const db = await database()
    const record = await db.get('snapshots', id)
    return record?.snapshot ?? null
  } catch {
    return null
  }
}

/** Remove locally cached paid question text for a track whose entitlement is no longer active. */
export function deletePaidQuestionSnapshotsForTrack(track: TrackId): Promise<string[]> {
  return queueWrite(async () => {
    const db = await database();
    const tx = db.transaction('snapshots', 'readwrite');
    const records = await tx.store.getAll();
    const expired = records.filter(record =>
      record.snapshot.track === track && record.snapshot.isFreeSession !== true
    );
    await Promise.all(expired.map(record => tx.store.delete(record.id)));
    await tx.done;
    return expired.map(record => record.id);
  });
}

export function deleteSessionSnapshot(id: string): Promise<void> {
  return queueWrite(async () => {
    const db = await database()
    await db.delete('snapshots', id)
  })
}
