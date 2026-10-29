import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId } from '../types/question'
import { verifyOfflineEntitlementToken } from './offlineEntitlementCrypto.mjs'
import { isGmdssFreeSampleQuestion, isOfflinePackSetComplete } from './offlinePackIntegrity.mjs'

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
  /** Content hashes captured at download time, keyed by private source asset path. */
  sourceVersions?: Record<string, string>
  lastCheckedAt?: number
  lastKnownUpdateState?: 'current' | 'available'
  availableSources?: string[]
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
  sourceVersions?: Record<string, string>
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

interface StoredOfflineQuestionPackMetadata {
  id: string
  track: TrackId
  competenceId: string
  part: number | null
  freeOnly: boolean
  questionCount: number
  savedAt: number
}

interface OfflineBankDatabase extends DBSchema {
  packs: { key: string; value: StoredOfflineQuestionPack }
  packMeta: { key: string; value: StoredOfflineQuestionPackMetadata }
  manifests: { key: string; value: OfflinePackManifest }
  keys: { key: string; value: { id: string; key: CryptoKey } }
}

const DB_NAME = 'hyperion-offline-question-bank'
const DB_VERSION = 3
const ENTITLEMENTS_KEY = 'hyperion-offline-entitlements'
let dbPromise: Promise<IDBPDatabase<OfflineBankDatabase>> | null = null

function database() {
  if (!dbPromise) {
    dbPromise = openDB<OfflineBankDatabase>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion, _newVersion, transaction) {
        if (!db.objectStoreNames.contains('packs')) db.createObjectStore('packs', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('packMeta')) db.createObjectStore('packMeta', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('manifests')) db.createObjectStore('manifests', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' })
        // Version 1 stored question objects in plaintext. Clear those early test
        // records before enabling the encrypted-at-rest format in version 2.
        if (oldVersion > 0 && oldVersion < 2) {
          transaction.objectStore('packs').clear()
          transaction.objectStore('manifests').clear()
          transaction.objectStore('packMeta').clear()
        } else if (oldVersion >= 2 && oldVersion < 3) {
          // Migrate only lightweight metadata during upgrade. Keep encrypted packs
          // intact and avoid decrypting their question payloads on future reads.
          const packStore = transaction.objectStore('packs')
          const metadataStore = transaction.objectStore('packMeta')
          const cursorRequest = packStore.openCursor()
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result
            if (!cursor) return
            const pack = cursor.value as StoredOfflineQuestionPack
            metadataStore.put({
              id: pack.id,
              track: pack.track,
              competenceId: pack.competenceId,
              part: pack.part,
              freeOnly: pack.freeOnly,
              questionCount: pack.questionCount,
              savedAt: pack.savedAt
            })
            cursor.continue()
          }
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
  const metadata: StoredOfflineQuestionPackMetadata = {
    id, track: pack.track, competenceId: pack.competenceId, part: pack.part,
    freeOnly: pack.freeOnly, questionCount: pack.questions.length, savedAt: record.savedAt
  }
  const tx = db.transaction(['packs', 'packMeta'], 'readwrite')
  await Promise.all([tx.objectStore('packs').put(record), tx.objectStore('packMeta').put(metadata)])
  await tx.done
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
      ...((update.track === 'DECK_OIC_NW' || update.track === 'GMDSS_GOC') && update.freeOnly ? { sampleVersion: 2 } : {}),
      ...(update.sourceVersions ? {
        sourceVersions: update.sourceVersions,
        lastCheckedAt: Date.now(),
        lastKnownUpdateState: 'current' as const,
        availableSources: []
      } : {})
    })
  }

  const tx = db.transaction(['packs', 'packMeta', 'manifests'], 'readwrite')
  const packsStore = tx.objectStore('packs')
  const metadataStore = tx.objectStore('packMeta')
  const existingIds = await metadataStore.getAllKeys()
  for (const update of updates) {
    const prefix = `${update.track}:${update.freeOnly ? 'free' : 'licensed'}:`
    for (const id of existingIds) {
      if (typeof id === 'string' && id.startsWith(prefix)) {
        await Promise.all([packsStore.delete(id), metadataStore.delete(id)])
        decryptedPackCache.delete(id)
      }
    }
  }
  for (const record of records) {
    await packsStore.put(record)
    await metadataStore.put({
      id: record.id, track: record.track, competenceId: record.competenceId,
      part: record.part, freeOnly: record.freeOnly,
      questionCount: record.questionCount, savedAt: record.savedAt
    })
  }
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

const decryptedPackCache = new Map<string, OfflineQuestionPack>()
const MAX_DECRYPTED_PACK_CACHE = 12

async function getCachedDecryptedPack(
  key: CryptoKey,
  pack: StoredOfflineQuestionPack
): Promise<OfflineQuestionPack> {
  const cached = decryptedPackCache.get(pack.id)
  if (cached && cached.savedAt === pack.savedAt) {
    // Refresh insertion order to behave as a small LRU cache.
    decryptedPackCache.delete(pack.id)
    decryptedPackCache.set(pack.id, cached)
    return cached
  }
  const decoded = await decryptOfflineQuestionPack(key, pack)
  decryptedPackCache.set(pack.id, decoded)
  while (decryptedPackCache.size > MAX_DECRYPTED_PACK_CACHE) {
    const oldestKey = decryptedPackCache.keys().next().value
    if (oldestKey === undefined) break
    decryptedPackCache.delete(oldestKey)
  }
  return decoded
}

async function getValidatedPackMetadata(
  track: TrackId,
  freeOnly: boolean
): Promise<{ manifest: OfflinePackManifest; metadata: StoredOfflineQuestionPackMetadata[]; key: CryptoKey; db: IDBPDatabase<OfflineBankDatabase> } | null> {
  const db = await database()
  const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
  if (!manifest) return null
  // This store contains only IDs/counts, never ciphertext or question text.
  const metadata = (await db.getAll('packMeta')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
  if (!isOfflinePackSetComplete(manifest, metadata)) return null
  const savedKey = await db.get('keys', 'device-key')
  if (!savedKey?.key) return null
  return { manifest, metadata, key: savedKey.key, db }
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

export async function recordOfflinePackVersionCheck(
  track: TrackId,
  freeOnly: boolean,
  result: {
    checkedAt: number
    state: 'current' | 'available'
    sourceVersions?: Record<string, string>
    availableSources: string[]
  }
) {
  const db = await database()
  const id = offlineManifestId(track, freeOnly)
  const existing = await db.get('manifests', id)
  if (!existing) return
  await db.put('manifests', {
    ...existing,
    ...(result.sourceVersions ? { sourceVersions: result.sourceVersions } : {}),
    lastCheckedAt: result.checkedAt,
    lastKnownUpdateState: result.state,
    availableSources: result.availableSources
  })
}

export async function getOfflinePackStatus(track: TrackId, freeOnly: boolean) {
  try {
    const db = await database()
    const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
    if (!manifest) return null
    const metadata = (await db.getAll('packMeta')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key || !isOfflinePackSetComplete(manifest, metadata)) return null
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
    const metadata = (await db.getAll('packMeta')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    if (!isOfflinePackSetComplete(manifest, metadata)) return null
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key) return null
    // Full-track modes need every group. Read/decrypt groups concurrently and
    // reuse already decrypted entries, instead of serially waiting for each AES-GCM
    // operation. Competence modes use the targeted reader below and decrypt one group.
    return await Promise.all(metadata.map(async meta => {
      const pack = await db.get('packs', meta.id)
      if (!pack) throw new Error('An offline question group is missing.')
      const decoded = await getCachedDecryptedPack(savedKey.key, pack)
      if (decoded.questions.length !== meta.questionCount) throw new Error('Offline question count mismatch.')
      if (track === 'GMDSS_GOC' && freeOnly && decoded.questions.some(question => !isGmdssFreeSampleQuestion(question))) {
        throw new Error('Offline free question pack contains items outside the official sample.')
      }
      return decoded
    }))
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
  try {
    const validated = await getValidatedPackMetadata(track, freeOnly)
    if (!validated) return null
    const matching = validated.metadata
      .filter(pack => pack.competenceId === competenceId && (part == null || pack.part === part))
      .sort((a, b) => (a.part ?? 0) - (b.part ?? 0))
    if (!matching.length) return null

    // Decrypt only this competence/part. The previous implementation decrypted
    // every question group for the entire track before filtering to one competence.
    const questions: Question[] = []
    for (const meta of matching) {
      const pack = await validated.db.get('packs', meta.id)
      if (!pack) return null
      const decoded = await getCachedDecryptedPack(validated.key, pack)
      if (decoded.questions.length !== meta.questionCount) return null
      if (track === 'GMDSS_GOC' && freeOnly && decoded.questions.some(question => !isGmdssFreeSampleQuestion(question))) return null
      questions.push(...decoded.questions)
    }
    return questions
  } catch {
    return null
  }
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
    const metadata = (await db.getAll('packMeta')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key || !isOfflinePackSetComplete(manifest, metadata)) return null
    return metadata.map(pack => ({
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
  const tx = db.transaction(['packs', 'packMeta', 'manifests'], 'readwrite')
  const metadata = await tx.objectStore('packMeta').getAll()
  for (const pack of metadata) {
    if (pack.track === track && !pack.freeOnly) {
      await Promise.all([tx.objectStore('packs').delete(pack.id), tx.objectStore('packMeta').delete(pack.id)])
      decryptedPackCache.delete(pack.id)
    }
  }
  await tx.objectStore('manifests').delete(offlineManifestId(track, false))
  await tx.done
}
