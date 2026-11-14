import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { Question, TrackId } from '../types/question'
import {
  verifyOfflineEntitlementToken,
  effectiveOfflineEntitlementNowMonotonic,
  anchorMonotonicOfflineEntitlementClock,
  resetMonotonicOfflineEntitlementClock,
  OFFLINE_CLOCK_PERSIST_INTERVAL_MS
} from './offlineEntitlementCrypto.mjs'
import { isGmdssFreeSampleQuestion, isOfflinePackSetComplete } from './offlinePackIntegrity.mjs'
import { selectActiveQuestions } from './retiredQuestions'

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
  /** Version 1 guarantees the encrypted pack contains only non-retired questions. */
  activeOnlyVersion?: 1
  sampleVersion?: number
  /** Public release checked without Supabase; only official Free Reviewer pages may populate this pack. */
  publicBankRevision?: string
  /** Version identifiers captured at download time, keyed by private source asset path. */
  sourceVersions?: Record<string, string>
  sourceVersionFormat?: 'content-sha256-v1' | 'storage-metadata-v1' | 'github-content-sha256-v1'
  /** Prevents repeatedly downloading legacy source files while an update is already known. */
  legacyVersionMigrationChecked?: boolean
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
  publicBankRevision?: string
  sourceVersions?: Record<string, string>
  sourceVersionFormat?: OfflinePackManifest['sourceVersionFormat']
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
          // idb wraps cursor requests in promises; keep the upgrade transaction
          // alive by awaiting each cursor continuation instead of using DOM events.
          void (async () => {
            let cursor = await packStore.openCursor()
            while (cursor) {
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
              cursor = await cursor.continue()
            }
          })()
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

async function requestPersistentOfflineStorage() {
  try {
    if (typeof navigator === 'undefined' || !navigator.storage ||
        typeof navigator.storage.persist !== 'function') return
    // Browser support varies (notably on iOS). A granted persistent-storage
    // request reduces eviction risk but cannot guarantee indefinite retention.
    await navigator.storage.persist()
  } catch {
    // The pack remains usable for this session if persistence is unavailable.
  }
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
  await requestPersistentOfflineStorage()
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
    let groupCount = 0
    for (const group of update.groups) {
      if (group.questions.some(question => question.track !== update.track || question.competenceId !== group.competenceId)) {
        throw new Error('Question pack metadata does not match its questions.')
      }
      // Published rows retain their original IDs/positions. The on-device study
      // pack contains active questions only; archived sessions are stored separately.
      const activeQuestions = selectActiveQuestions(group.questions)
      if (!activeQuestions.length) continue
      const id = offlinePackId(update.track, group.competenceId, group.part, update.freeOnly)
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const plaintext = new TextEncoder().encode(JSON.stringify(activeQuestions))
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
      records.push({
        id,
        track: update.track,
        competenceId: group.competenceId,
        part: group.part,
        freeOnly: update.freeOnly,
        questionCount: activeQuestions.length,
        savedAt: Date.now(),
        iv,
        ciphertext: new Uint8Array(encrypted)
      })
      questionCount += activeQuestions.length
      groupCount++
    }
    if (!groupCount) throw new Error('No active questions remain in this offline pack.')
    manifests.push({
      id: offlineManifestId(update.track, update.freeOnly),
      track: update.track,
      freeOnly: update.freeOnly,
      questionCount,
      groupCount,
      savedAt: Date.now(),
      complete: true,
      activeOnlyVersion: 1,
      ...(update.publicBankRevision ? { publicBankRevision: update.publicBankRevision, lastCheckedAt: Date.now(), lastKnownUpdateState: 'current' as const } : {}),
      ...((update.track === 'DECK_OIC_NW' || update.track === 'GMDSS_GOC') && update.freeOnly ? { sampleVersion: 2 } : {}),
      ...(update.sourceVersions ? {
        sourceVersions: update.sourceVersions,
        ...(update.sourceVersionFormat ? { sourceVersionFormat: update.sourceVersionFormat } : {}),
        legacyVersionMigrationChecked: true,
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
  await requestPersistentOfflineStorage()
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

/**
 * One-time, local-only upgrade for already downloaded encrypted packs. Retired
 * records are removed from the pack, not the published question bank or any
 * encrypted study history/bookmarks. Re-encrypt changed groups before opening
 * the transaction; an IDB quota failure leaves the old complete pack intact.
 */
const activeOnlyMigrations = new Map<string, Promise<void>>()
async function migrateLegacyRetiredOfflinePack(track: TrackId, freeOnly: boolean): Promise<void> {
  const id = offlineManifestId(track, freeOnly)
  const ongoing = activeOnlyMigrations.get(id)
  if (ongoing) return ongoing
  const task = (async () => {
    const db = await database()
    const manifest = await db.get('manifests', id)
    if (!manifest?.complete || manifest.activeOnlyVersion === 1) return
    const metadata = (await db.getAll('packMeta')).filter(meta =>
      meta.track === track && meta.freeOnly === freeOnly)
    if (!isOfflinePackSetComplete(manifest, metadata)) return
    const key = (await db.get('keys', 'device-key'))?.key
    if (!key) return

    const rewrites: { id: string; record?: StoredOfflineQuestionPack }[] = []
    let questionCount = 0
    let groupCount = 0
    for (const meta of metadata) {
      const stored = await db.get('packs', meta.id)
      if (!stored) return
      const decoded = await getCachedDecryptedPack(key, stored)
      if (decoded.questions.length !== meta.questionCount ||
          (track === 'GMDSS_GOC' && freeOnly && decoded.questions.some(q => !isGmdssFreeSampleQuestion(q)))) return
      const active = selectActiveQuestions(decoded.questions)
      questionCount += active.length
      if (!active.length) {
        rewrites.push({ id: meta.id })
        continue
      }
      groupCount++
      if (active.length === decoded.questions.length) continue
      const iv = crypto.getRandomValues(new Uint8Array(12))
      const plaintext = new TextEncoder().encode(JSON.stringify(active))
      const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, plaintext)
      rewrites.push({ id: meta.id, record: {
        ...stored, questionCount: active.length, savedAt: Date.now(),
        iv, ciphertext: new Uint8Array(encrypted)
      } })
    }
    if (!groupCount) return

    const tx = db.transaction(['packs', 'packMeta', 'manifests'], 'readwrite')
    const live = await tx.objectStore('manifests').get(id)
    // A newer download may have committed while the legacy pack was decrypted.
    if (!live || live.activeOnlyVersion === 1 || live.savedAt !== manifest.savedAt ||
        live.questionCount !== manifest.questionCount || live.groupCount !== manifest.groupCount) {
      await tx.done
      return
    }
    for (const change of rewrites) {
      if (change.record) {
        await tx.objectStore('packs').put(change.record)
        await tx.objectStore('packMeta').put({
          id: change.record.id, track: change.record.track, freeOnly: change.record.freeOnly,
          competenceId: change.record.competenceId, part: change.record.part,
          questionCount: change.record.questionCount, savedAt: change.record.savedAt
        })
      } else {
        await tx.objectStore('packs').delete(change.id)
        await tx.objectStore('packMeta').delete(change.id)
      }
    }
    // Preserve all source hashes, revision hints, dates and prior availability.
    await tx.objectStore('manifests').put({
      ...live, questionCount, groupCount, activeOnlyVersion: 1
    })
    await tx.done
    for (const change of rewrites) decryptedPackCache.delete(change.id)
  })().catch(() => {
    // Do not invalidate or remove an older pack when local storage is unavailable.
  })
  activeOnlyMigrations.set(id, task)
  try { await task } finally { if (activeOnlyMigrations.get(id) === task) activeOnlyMigrations.delete(id) }
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
    await migrateLegacyRetiredOfflinePack(track, freeOnly)
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
    sourceVersionFormat?: OfflinePackManifest['sourceVersionFormat']
    legacyVersionMigrationChecked?: boolean
  }
) {
  const db = await database()
  const id = offlineManifestId(track, freeOnly)
  const existing = await db.get('manifests', id)
  if (!existing) return
  await db.put('manifests', {
    ...existing,
    ...(result.sourceVersions ? { sourceVersions: result.sourceVersions } : {}),
    ...(result.sourceVersionFormat ? { sourceVersionFormat: result.sourceVersionFormat } : {}),
    ...(result.legacyVersionMigrationChecked !== undefined ? { legacyVersionMigrationChecked: result.legacyVersionMigrationChecked } : {}),
    lastCheckedAt: result.checkedAt,
    lastKnownUpdateState: result.state,
    availableSources: result.availableSources
  })
}

export async function getOfflinePackStatus(track: TrackId, freeOnly: boolean) {
  try {
    await migrateLegacyRetiredOfflinePack(track, freeOnly)
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
    await migrateLegacyRetiredOfflinePack(track, freeOnly)
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
    await migrateLegacyRetiredOfflinePack(track, freeOnly)
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
    await migrateLegacyRetiredOfflinePack(track, freeOnly)
    const db = await database()
    const manifest = await db.get('manifests', offlineManifestId(track, freeOnly))
    if (!manifest) return null
    const metadata = (await db.getAll('packMeta')).filter(pack => pack.track === track && pack.freeOnly === freeOnly)
    const savedKey = await db.get('keys', 'device-key')
    if (!savedKey?.key || !isOfflinePackSetComplete(manifest, metadata)) return null
    return metadata.map(pack => ({
      competenceId: pack.competenceId,
      part: pack.part,
      count: pack.questionCount,
      activeOnly: manifest.activeOnlyVersion === 1
    }))
  } catch {
    return null
  }
}

interface StoredOfflineEntitlements {
  userId: string
  savedAt: number
  lastVerifiedAt: number
  token: string
}

function readStoredOfflineEntitlements(): StoredOfflineEntitlements | null {
  try {
    const value = JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY) || 'null') as Partial<StoredOfflineEntitlements> | null
    if (
      !value ||
      typeof value.userId !== 'string' ||
      typeof value.savedAt !== 'number' ||
      !Number.isFinite(value.savedAt) ||
      value.savedAt <= 0 ||
      typeof value.token !== 'string'
    ) return null
    // Older leases predate the high-water field. Their original save time is the
    // safest available migration anchor; new saves persist lastVerifiedAt explicitly.
    const lastVerifiedAt = typeof value.lastVerifiedAt === 'number' &&
      Number.isFinite(value.lastVerifiedAt) && value.lastVerifiedAt >= value.savedAt
      ? value.lastVerifiedAt
      : value.savedAt
    return { userId: value.userId, savedAt: value.savedAt, lastVerifiedAt, token: value.token }
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
    resetMonotonicOfflineEntitlementClock()
  } catch {
    // Storage can be unavailable in private browsing or constrained browser modes.
  }
}

function persistOfflineEntitlementHighWaterMark(stored: StoredOfflineEntitlements, effectiveNow: number) {
  if (effectiveNow - stored.lastVerifiedAt < OFFLINE_CLOCK_PERSIST_INTERVAL_MS) return
  try {
    const current = readStoredOfflineEntitlements()
    if (!current || current.userId !== stored.userId || current.token !== stored.token) return
    const latest = Math.max(current.lastVerifiedAt, effectiveNow)
    if (latest <= current.lastVerifiedAt) return
    localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify({ ...current, lastVerifiedAt: latest }))
  } catch {
    // If storage is unavailable, the existing signed lease remains bounded by issuedAt.
  }
}

async function verifyStoredOfflineEntitlements(stored: StoredOfflineEntitlements, userId: string) {
  if (stored.userId !== userId) {
    return { claims: null, effectiveNow: null, clockRollback: false }
  }
  const effectiveNow = effectiveOfflineEntitlementNowMonotonic(Date.now(), stored.lastVerifiedAt)
  if (effectiveNow === null) {
    // Preserve the lease so restoring the device clock can restore offline use;
    // access is denied until the clock is within the tolerated skew again.
    return { claims: null, effectiveNow: null, clockRollback: true }
  }
  const claims = await verifyOfflineEntitlementToken(stored.token, userId, effectiveNow)
  if (!claims) return { claims: null, effectiveNow, clockRollback: false }
  // The signed issuedAt claim is server-authored. Include it in the high-water
  // mark so a device clock that is slightly behind server time cannot lag it.
  const trustedNow = Math.max(effectiveNow, claims.issuedAt)
  persistOfflineEntitlementHighWaterMark(stored, trustedNow)
  return { claims, effectiveNow: trustedNow, clockRollback: false }
}

export async function saveOfflineEntitlements(
  userId: string,
  token: string,
  canSave: () => boolean = () => true,
  signedServerIssuedAt?: number
): Promise<boolean> {
  const previous = readStoredOfflineEntitlements()
  const priorHighWater = previous?.userId === userId ? previous.lastVerifiedAt : 0
  const now = Date.now()
  // Only trust server time after verifying the signed token *and* checking that
  // the token's signed issuedAt exactly matches the response metadata.
  // A phone with a skewed clock must not reject a valid new purchase.
  const serverNow = typeof signedServerIssuedAt === 'number' &&
    Number.isFinite(signedServerIssuedAt) && signedServerIssuedAt > 0
    ? signedServerIssuedAt
    : null
  const effectiveNow = serverNow ?? (priorHighWater > 0
    ? effectiveOfflineEntitlementNowMonotonic(now, priorHighWater)
    : now)
  // Offline restores still fail closed on clock rollback. Only fresh server
  // grants are allowed to supersede a locally skewed high-water mark.
  if (effectiveNow === null) return false
  const claims = await verifyOfflineEntitlementToken(token, userId, effectiveNow)
  // A malformed or incompatible token cannot replace an existing verified
  // grant, and unsigned response metadata cannot affect license access.
  if (!claims || (serverNow !== null && claims.issuedAt !== serverNow)) return false
  const trustedNow = serverNow ?? Math.max(effectiveNow, claims.issuedAt)
  try {
    if (!canSave()) return false
    const value: StoredOfflineEntitlements = {
      userId,
      savedAt: trustedNow,
      lastVerifiedAt: trustedNow,
      token
    }
    localStorage.setItem(ENTITLEMENTS_KEY, JSON.stringify(value))
    anchorMonotonicOfflineEntitlementClock(trustedNow, undefined, serverNow !== null)
    return true
  } catch {
    // Offline entitlements are an enhancement; live server checks remain authoritative.
    return false
  }
}

export async function getOfflineEntitlementExpiry(userId: string, track: TrackId): Promise<number | null> {
  const stored = readStoredOfflineEntitlements()
  if (!stored || stored.userId !== userId) return null
  const verified = await verifyStoredOfflineEntitlements(stored, userId)
  if (!verified.claims || verified.effectiveNow === null) {
    if (!verified.clockRollback) clearOfflineEntitlements(userId)
    return null
  }
  const expiresAt = verified.claims.tracks[track]
  return typeof expiresAt === 'number' && Number.isFinite(expiresAt) && expiresAt > verified.effectiveNow
    ? expiresAt
    : null
}

export async function getOfflineEntitledTracks(userId: string): Promise<string[]> {
  const stored = readStoredOfflineEntitlements()
  if (!stored || stored.userId !== userId) return []
  const verified = await verifyStoredOfflineEntitlements(stored, userId)
  if (!verified.claims || verified.effectiveNow === null) {
    if (!verified.clockRollback) clearOfflineEntitlements(userId)
    return []
  }
  return Object.entries(verified.claims.tracks)
    .filter(([, expiresAt]) => expiresAt > verified.effectiveNow)
    .map(([track]) => track)
}


export interface CachedOfflineEntitlementSnapshot {
  userId: string
  isAdmin: boolean
  trackExpiries: Partial<Record<TrackId, number>>
  verifiedAt?: number
}

/**
 * Reads the locally stored signed grant without relying on Supabase auth/session
 * restoration. The embedded user ID is used only as the expected signer subject;
 * the ECDSA signature and per-track real expiry are still verified before use.
 */
export async function getCachedOfflineEntitlementSnapshot(expectedUserId?: string): Promise<CachedOfflineEntitlementSnapshot | null> {
  const stored = readStoredOfflineEntitlements()
  if (!stored) return null
  let owner = expectedUserId
  if (!owner) { try { owner = localStorage.getItem('hyperion-progress-owner') || undefined } catch { /* no known owner */ } }
  if (owner && owner !== stored.userId) return null
  const verified = await verifyStoredOfflineEntitlements(stored, stored.userId)
  if (!verified.claims || verified.effectiveNow === null) {
    if (!verified.clockRollback) clearOfflineEntitlements(stored.userId)
    return null
  }
  const trackExpiries: Partial<Record<TrackId, number>> = {}
  for (const [track, expiry] of Object.entries(verified.claims.tracks)) {
    if (expiry > verified.effectiveNow) trackExpiries[track as TrackId] = expiry
  }
  return { userId: stored.userId, isAdmin: verified.claims.admin === true, trackExpiries, verifiedAt: verified.effectiveNow }
}

export async function getCachedOfflineEntitlementExpiry(track: TrackId): Promise<number | null> {
  const snapshot = await getCachedOfflineEntitlementSnapshot()
  return snapshot?.trackExpiries[track] ?? null
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
