import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId } from '../types/question'

export interface OfflineQuestionPack {
  id: string
  track: TrackId
  competenceId: string
  part: number | null
  freeOnly: boolean
  questions: Question[]
  savedAt: number
}

export interface OfflinePackManifest {
  id: string
  track: TrackId
  freeOnly: boolean
  questionCount: number
  groupCount: number
  savedAt: number
  complete: boolean
}

interface OfflineBankDatabase extends DBSchema {
  packs: { key: string; value: OfflineQuestionPack }
  manifests: { key: string; value: OfflinePackManifest }
}

const DB_NAME = 'hyperion-offline-question-bank'
const DB_VERSION = 1
const ENTITLEMENTS_KEY = 'hyperion-offline-entitlements'
let dbPromise: Promise<IDBPDatabase<OfflineBankDatabase>> | null = null

function database() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineBankDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'id' })
      }
    })
  }
  return dbPromise
}

export function offlinePackId(track: TrackId, competenceId: string, part: number | null, freeOnly: boolean) {
  return `${track}:${freeOnly ? 'free' : 'licensed'}:${competenceId}:${part ?? 'all'}`
}

export function offlineManifestId(track: TrackId, freeOnly: boolean) {
  return `${track}:${freeOnly ? 'free' : 'licensed'}`
}

export async function saveOfflineQuestionPack(pack: Omit<OfflineQuestionPack, 'id' | 'savedAt'>) {
  const db = await database()
  const record: OfflineQuestionPack = {
    ...pack,
    id: offlinePackId(pack.track, pack.competenceId, pack.part, pack.freeOnly),
    savedAt: Date.now()
  }
  await db.put('packs', record)
}

export async function saveOfflinePackManifest(manifest: Omit<OfflinePackManifest, 'id' | 'savedAt'>) {
  const db = await database()
  await db.put('manifests', {
    ...manifest,
    id: offlineManifestId(manifest.track, manifest.freeOnly),
    savedAt: Date.now()
  })
}

export async function getOfflinePackManifest(track: TrackId, freeOnly: boolean) {
  try {
    return (await (await database()).get('manifests', offlineManifestId(track, freeOnly))) ?? null
  } catch {
    return null
  }
}

export async function getOfflinePackStatus(track: TrackId, freeOnly: boolean) {
  return getOfflinePackManifest(track, freeOnly)
}

export async function getOfflineQuestionPacks(track: TrackId, freeOnly: boolean) {
  try {
    const db = await database()
    const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
    if (!manifest?.complete) return null
    return (await db.getAll('packs')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
  } catch {
    return null
  }
}

export async function getOfflineQuestionsByCompetence(
  track: TrackId,
  competenceId: string,
  part: number | undefined,
  freeOnly: boolean
): Promise<Question[] | null> {
  const packs = await getOfflineQuestionPacks(track, freeOnly)
  if (!packs) return null
  const matching = packs
    .filter(pack => pack.competenceId === competenceId && (part == null || pack.part === part))
    .sort((a, b) => (a.part ?? 0) - (b.part ?? 0))
  if (!matching.length) return null
  return matching.flatMap(pack => pack.questions)
}

export async function getOfflineQuestionsByTrack(track: TrackId, freeOnly: boolean): Promise<Question[] | null> {
  const packs = await getOfflineQuestionPacks(track, freeOnly)
  if (!packs) return null
  return packs.sort((a, b) =>
    a.competenceId.localeCompare(b.competenceId, undefined, { numeric: true }) ||
    (a.part ?? 0) - (b.part ?? 0)
  ).flatMap(pack => pack.questions)
}

export async function getOfflineQuestionCounts(track: TrackId, freeOnly: boolean) {
  const packs = await getOfflineQuestionPacks(track, freeOnly)
  if (!packs) return null
  return packs.map(pack => ({
    competenceId: pack.competenceId,
    part: pack.part,
    count: pack.questions.length
  }))
}

interface OfflineEntitlements {
  userId: string
  savedAt: number
  tracks: Record<string, number>
}

export function saveOfflineEntitlements(userId: string, tracks: Record<string, number>) {
  try {
    const value: OfflineEntitlements = { userId, savedAt: Date.now(), tracks }
    localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify(value))
  } catch {
    // Offline entitlements are an enhancement; live server checks remain authoritative.
  }
}

export function getOfflineEntitlementExpiry(userId: string, track: TrackId): number | null {
  try {
    const value = JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY) || 'null') as OfflineEntitlements | null
    if (!value || value.userId !== userId) return null
    const expiresAt = Number(value.tracks[track])
    return Number.isFinite(expiresAt) && expiresAt > Date.now() ? expiresAt : null
  } catch {
    return null
  }
}

export function getOfflineEntitledTracks(userId: string): string[] {
  try {
    const value = JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY) || 'null') as OfflineEntitlements | null
    if (!value || value.userId !== userId) return []
    return Object.entries(value.tracks)
      .filter(([, expiresAt]) => Number(expiresAt) > Date.now())
      .map(([track]) => track)
  } catch {
    return []
  }
}

export async function deletePaidOfflineQuestionPacksForTrack(track: TrackId) {
  const db = await database()
  const tx = db.transaction(['packs', 'manifests'], 'readwrite')
  const packs = await tx.objectStore('packs').getAll()
  for (const pack of packs) {
    if (pack.track === track && !pack.freeOnly) await tx.objectStore('packs').delete(pack.id)
  }
  await tx.objectStore('manifests').delete(offlineManifestId(track, false))
  await tx.done
}
