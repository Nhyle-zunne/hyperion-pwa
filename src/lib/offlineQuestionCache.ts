import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId } from '../types/question'
import { verifyOfflineEntitlementToken } from './offlineEntitlementCrypto.mjs'
import { isOfflinePackSetComplete } from './offlinePackIntegrity.mjs'

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
  sampleVersion?: number
}

export interface OfflineQuestionPackGroup {
  competenceId: string
  part: number | null
  questions: Question[]
}

export interface OfflineQuestionPackSetUpdate {
  track: TrackId
  freeOnly: boolean
  groups: OfflineQuestionPackGroup[]
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

/**
 * Encrypt all replacement packs before touching the current complete pack, then
 * switch pack records and manifests in one IndexedDB transaction. A cancelled
 * download or quota error therefore leaves the previous complete pack usable.
 */
export async function saveOfflineQuestionPackSets(updates: OfflineQuestionPackSetUpdate[]) {
  if (!updates.length) throw new Error('No offline question packs were supplied.')

  const targetSets = new Set<string>()
  for (const update of updates) {
    const target = offlineManifestId(update.track, update.freeOnly)
    if (targetSets.has(target)) throw new Error('An offline pack set was supplied more than once.')
    targetSets.add(target)
    if (!update.groups.length || update.groups.some(group => !group.questions.length)) {
      throw new Error('An offline pack set is incomplete.')
    }
    const groupIds = update.groups.map(group => offlinePackId(update.track, group.competenceId, group.part, update.freeOnly))
    if (new Set(groupIds).size !== groupIds.length) throw new Error('An offline pack set contains duplicate groups.')
  }

  const db = await database()
  const key = await deviceStorageKey(db)
  const records: StoredOfflineQuestionPack[] = []
  const manifests: OfflinePackManifest[] = []

  // Run cryptography before opening the write transaction so IDB cannot auto-commit
  // while a crypto operation is pending.
  for (const update of updates) {
    let questionCount = 0
    for (const group of update.groups) {
      if (group.questions.some(question => question.track !== update.track || question.competenceId !== group.competenceId)) {
        throw new Error('Question pack metadata does not match its questions.')
      }
      const id = offlinePackId(update.track, group.competenceId, group.part, update.freeOnly)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const plaintext = new TextEncoder().encode(JSON.stringify(group.questions))
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
      records.push({
        id,
        track: update.track,
        competenceId: group.competenceId,
        part: group.part,
        freeOnly: update.freeOnly,
        questionCount: group.questions.length,
        savedAt: Date.now(),
        iv,
        ciphertext: new Uint8Array(encrypted)
      })
      questionCount += group.questions.length
    }
    manifests.push({
      id: offlineManifestId(update.track, update.freeOnly),
      track: update.track,
      freeOnly: update.freeOnly,
      questionCount,
      groupCount: update.groups.length,
      savedAt: Date.now(),
      complete: true,
      ...(update.track === 'DECK_OIC_NW' && update.freeOnly ? { sampleVersion: 2 } : {})
    })
  }

  const tx = db.transaction(['packs', 'manifests'], 'readwrite')
  const packsStore = tx.objectStore('packs')
  const existingIds = await packsStore.getAllKeys()
  for (const update of updates) {
    const prefix = `${update.track}:${update.freeOnly ? 'free' : 'licensed'}:`
    for (const id of existingIds) {
      if (typeof id === 'string' && id.startsWith(prefix)) await packsStore.delete(id)
    }
  }
  for (const record of records) await packsStore.put(record)
  const manifestsStore = tx.objectStore('manifests')
  for (const manifest of manifests) await manifestsStore.put(manifest)
  await tx.done
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
  try {
    const db = await database()
    const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
    if (!manifest) return null
    const stored = (await db.getAll('packs')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key || !isOfflinePackSetComplete(manifest, stored)) return null
    return manifest
  } catch {
    return null
  }
}

export async function getOfflineQuestionPacks(track: TrackId, freeOnly: boolean) {
  try {
    const db = await database()
    const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
    if (!manifest) return null
    const stored = (await db.getAll('packs')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    if (!isOfflinePackSetComplete(manifest, stored)) return null
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key) return null
    const decrypted: OfflineQuestionPack[] = []
    for (const pack of stored) {
      const decoded = await decryptOfflineQuestionPack(savedKey.key, pack)
      if (decoded.questions.length !== pack.questionCount) return null
      decrypted.push(decoded)
    }
    return decrypted
  } catch {
    // A missing device key or damaged/incomplete ciphertext requires a fresh online download.
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
  try {
    const db = await database()
    const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
    if (!manifest) return null
    const stored = (await db.getAll('packs')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key || !isOfflinePackSetComplete(manifest, stored)) return null
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
