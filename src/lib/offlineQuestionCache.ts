import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId } from '../types/question'
import { verifyOfflineEntitlementToken } from './offlineEntitlementCrypto.mjs'

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

interface StoredOfflineQuestionPack {
  id: string
  track: TrackId
  competenceId: string
  part: number | null
  freeOnly: boolean
  questionCount: number
  savedAt: number
  iv: Uint8Array
  ciphertext: Uint8Array
}

interface OfflineBankDatabase extends DBSchema {
  packs: { key: string; value: StoredOfflineQuestionPack }
  manifests: { key: string; value: OfflinePackManifest }
  keys: { key: string; value: { id: string; key: CryptoKey } }
}

const DB_NAME = 'hyperion-offline-question-bank'
const DB_VERSION = 2
const ENTITLEMENTS_KEY = 'hyperion-offline-entitlements'
let dbPromise: Promise<IDBPDatabase<OfflineBankDatabase>> | null = null

function database() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineBankDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' })
        // Version 1 stored question objects in plaintext. Clear those early test
        // records before enabling the encrypted-at-rest format in version 2.
        if (oldVersion > 0 && oldVersion < 2) {
          transaction.objectStore('packs').clear()
          transaction.objectStore('manifests').clear()
        }
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

async function deviceStorageKey(db: IDBPDatabase<OfflineBankDatabase>): Promise<CryptoKey> {
  const saved = await db.get('keys', 'device-key')
  if (saved?.key) return saved.key
  const key = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  await db.put('keys', { id: 'device-key', key })
  return key
}

export async function saveOfflineQuestionPack(pack: Omit<OfflineQuestionPack, 'id' | 'savedAt'>) {
  const db = await database()
  const id = offlinePackId(pack.track, pack.competenceId, pack.part, pack.freeOnly)
  const key = await deviceStorageKey(db)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plaintext = new TextEncoder().encode(JSON.stringify(pack.questions))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
  const record: StoredOfflineQuestionPack = {
    id,
    track: pack.track,
    competenceId: pack.competenceId,
    part: pack.part,
    freeOnly: pack.freeOnly,
    questionCount: pack.questions.length,
    savedAt: Date.now(),
    iv,
    ciphertext: new Uint8Array(encrypted)
  }
  await db.put('packs', record)
}

async function decryptOfflineQuestionPack(
  key: CryptoKey,
  pack: StoredOfflineQuestionPack
): Promise<OfflineQuestionPack> {
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: pack.iv }, key, pack.ciphertext)
  const questions = JSON.parse(new TextDecoder().decode(plaintext)) as Question[]
  return {
    id: pack.id, track: pack.track, competenceId: pack.competenceId,
    part: pack.part, freeOnly: pack.freeOnly, questions, savedAt: pack.savedAt
  }
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
    const stored = (await db.getAll('packs')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key) return null
    const decrypted: OfflineQuestionPack[] = []
    for (const pack of stored) decrypted.push(await decryptOfflineQuestionPack(savedKey.key, pack))
    return decrypted
  } catch {
    // A missing device key or damaged ciphertext requires a fresh online download.
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
  const manifest = await getOfflinePackManifest(track, freeOnly)
  if (!manifest?.complete) return null
  try {
    const db = await database()
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key) return null
    const stored = (await db.getAll('packs')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    if (!stored.length || stored.reduce((sum, pack) => sum + pack.questionCount, 0) !== manifest.questionCount) return null
    return stored.map(pack => ({
      competenceId: pack.competenceId,
      part: pack.part,
      count: pack.questionCount
    }))
  } catch {
    return null
  }
}

interface StoredOfflineEntitlements {
  userId: string
  savedAt: number
  token: string
}

function readStoredOfflineEntitlements(): StoredOfflineEntitlements | null {
  try {
    const value = JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY) || 'null') as Partial<StoredOfflineEntitlements> | null
    if (
      !value ||
      typeof value.userId !== 'string' ||
      typeof value.savedAt !== 'number' ||
      typeof value.token !== 'string'
    ) return null
    return { userId: value.userId, savedAt: value.savedAt, token: value.token }
  } catch {
    return null
  }
}

export function clearOfflineEntitlements(userId?: string) {
  try {
    if (userId) {
      const stored = readStoredOfflineEntitlements()
      if (stored && stored.userId !== userId) return
    }
    localStorage.removeItem(ENTITLEMENTS_KEY)
  } catch {
    // Storage can be unavailable in private browsing or constrained browser modes.
  }
}

export async function saveOfflineEntitlements(userId: string, token: string): Promise<boolean> {
  const claims = await verifyOfflineEntitlementToken(token, userId)
  if (!claims || !Object.values(claims.tracks).some(expiresAt => expiresAt > Date.now())) {
    clearOfflineEntitlements(userId)
    return false
  }
  try {
    const value: StoredOfflineEntitlements = { userId, savedAt: Date.now(), token }
    localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify(value))
    return true
  } catch {
    // Offline entitlements are an enhancement; live server checks remain authoritative.
    return false
  }
}

export async function getOfflineEntitlementExpiry(userId: string, track: TrackId): Promise<number | null> {
  const stored = readStoredOfflineEntitlements()
  if (!stored || stored.userId !== userId) return null
  const claims = await verifyOfflineEntitlementToken(stored.token, userId)
  if (!claims) {
    clearOfflineEntitlements(userId)
    return null
  }
  const expiresAt = claims.tracks[track]
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > Date.now()
    ? expiresAt
    : null
}

export async function getOfflineEntitledTracks(userId: string): Promise<string[]> {
  const stored = readStoredOfflineEntitlements()
  if (!stored || stored.userId !== userId) return []
  const claims = await verifyOfflineEntitlementToken(stored.token, userId)
  if (!claims) {
    clearOfflineEntitlements(userId)
    return []
  }
  return Object.entries(claims.tracks)
    .filter(([, expiresAt]) => expiresAt > Date.now())
    .map(([track]) => track)
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
