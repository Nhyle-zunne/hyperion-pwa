import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StateStorage } from 'zustand/middleware'
import { decryptJsonPayload, encryptJsonPayload } from './jsonPayloadCrypto.mjs'
import { filterProgressCollection } from './progressDeletionLedger'
import { createSerialAsyncQueue } from './serializedAsyncQueue.mjs'

interface StoredEncryptedState {
  id: string
  ownerId?: string | null
  iv: Uint8Array
  ciphertext: Uint8Array
}

interface RecoveryRecord extends StoredEncryptedState {
  sourceKey: string
  ownerId: string | null
  at: number
}
interface EncryptedStateDatabase extends DBSchema {
  recovery: { key: string; value: RecoveryRecord }
  entries: { key: string; value: StoredEncryptedState }
  keys: { key: string; value: { id: string; key: CryptoKey } }
}

const DATABASE_NAME = 'hyperion-encrypted-browser-state'
const DATABASE_VERSION = 2
const ENCRYPTION_KEY_ID = 'encrypted-persist-state-key'
let databasePromise: Promise<IDBPDatabase<EncryptedStateDatabase>> | null = null
// Zustand can queue multiple state writes rapidly (for example, purging several tracks).
// Keep all IDB operations ordered so an older async encryption cannot overwrite newer state.
const queueStorageOperation = createSerialAsyncQueue()

function database() {
  if (!databasePromise) {
    databasePromise = openDB<EncryptedStateDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains('recovery')) db.createObjectStore('recovery', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('entries')) db.createObjectStore('entries', { keyPath: 'id' })
        if (!db.objectStoreNames.contains('keys')) db.createObjectStore('keys', { keyPath: 'id' })
      }
    })
  }
  return databasePromise
}

async function getOrCreateKey(db: IDBPDatabase<EncryptedStateDatabase>): Promise<CryptoKey> {
  const existing = await db.get('keys', ENCRYPTION_KEY_ID)
  if (existing) return existing.key

  const generated = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
  const tx = db.transaction('keys', 'readwrite')
  const concurrent = await tx.store.get(ENCRYPTION_KEY_ID)
  if (concurrent) {
    await tx.done
    return concurrent.key
  }
  await tx.store.put({ id: ENCRYPTION_KEY_ID, key: generated })
  await tx.done
  return generated
}

function getLegacyValue(name: string): string | null {
  try {
    return localStorage.getItem(name)
  } catch {
    return null
  }
}

function removeLegacyValue(name: string) {
  try {
    localStorage.removeItem(name)
  } catch {
    // Storage may be unavailable in private or constrained browser modes.
  }
}


const protectedCollections = new Set(['hyperion-bookmarks', 'hyperion-vault'])
const loadedCollections = new Set<string>()
function progressOwner(): string | null {
  try { return localStorage.getItem('hyperion-progress-owner') } catch { return null }
}

async function preserveLegacyCollection(db: IDBPDatabase<EncryptedStateDatabase>, name: string, key: CryptoKey, ownerId = progressOwner()) {
  if (!protectedCollections.has(name)) return
  const legacy = getLegacyValue(name)
  if (!legacy) return
  // A leftover legacy copy can contain rows absent from the encrypted primary.
  // Archive it before removing plaintext; recovery applies explicit tombstones.
  const encrypted = await encryptJsonPayload(legacy, key)
  await db.put('recovery', { id: crypto.randomUUID(), sourceKey: name, ownerId, at: Date.now(), ...encrypted })
}

async function writeEncryptedValueUnlocked(name: string, value: string, ownerId = progressOwner()): Promise<void> {
  const db = await database()
  const key = await getOrCreateKey(db)
  const encrypted = await encryptJsonPayload(value, key)
  await preserveLegacyCollection(db, name, key, progressOwner())
  const tx = db.transaction(['entries', 'recovery'], 'readwrite')
  if (protectedCollections.has(name)) {
    const previous = await tx.objectStore('entries').get(name)
    if (previous) {
      const previousOwner = previous.ownerId === undefined ? ownerId : previous.ownerId
      const at = Date.now()
      await tx.objectStore('recovery').put({ ...previous, id: crypto.randomUUID(), sourceKey: name, ownerId: previousOwner, at })
      const backups = (await tx.objectStore('recovery').getAll())
        .filter(row => row.sourceKey === name && row.ownerId === previousOwner).sort((a, b) => b.at - a.at)
      for (const old of backups.slice(20)) await tx.objectStore('recovery').delete(old.id)
    }
  }
  await tx.objectStore('entries').put({ id: name, ownerId, ...encrypted })
  await tx.done
  removeLegacyValue(name)
}

/** Recover only the current owner's copies, honoring intentional deletion tombstones. */
export function recoverSavedCollections(ownerId: string | null): Promise<number> {
  return queueStorageOperation(async () => {
    if (progressOwner() !== ownerId) return 0
    const db = await database()
    const key = await getOrCreateKey(db)
    const backups = (await db.getAll('recovery')).filter(row => row.ownerId === ownerId)
    let restored = 0
    for (const name of protectedCollections) {
      if (progressOwner() !== ownerId) return restored
      const raw = await readEncryptedValueUnlocked(name)
      const current = raw ? JSON.parse(raw) : { state: { items: [] }, version: 0 }
      const items = new Map<string, Record<string, unknown>>()
      for (const row of backups.filter(row => row.sourceKey === name).sort((a, b) => a.at - b.at)) {
        try {
          const decrypted = await decryptJsonPayload<unknown>(row.iv, row.ciphertext, key)
          const parsed = typeof decrypted === 'string' ? JSON.parse(decrypted) : null
          for (const item of parsed?.state?.items ?? []) if (typeof item?.id === 'string') items.set(item.id, item)
        } catch { /* Keep unreadable copies intact for a later recovery attempt. */ }
      }
      for (const item of current?.state?.items ?? []) if (typeof item?.id === 'string') items.set(item.id, item)
      let ledger: string | null = null
      try { ledger = localStorage.getItem('hyperion-progress-deletions') } catch { /* no ledger */ }
      const merged = JSON.stringify({ ...current, state: { ...current.state, items: [...items.values()] } })
      const filtered = filterProgressCollection(merged, ledger, name === 'hyperion-bookmarks' ? 'bookmarks' : 'vault', name === 'hyperion-bookmarks' ? 'savedAt' : 'lastWrongAt')
      const recovered = filtered ? JSON.parse(filtered).state.items.length : 0
      const beforeIds = (current?.state?.items ?? []).map((item: { id: string }) => item.id).sort()
      const afterIds = filtered ? JSON.parse(filtered).state.items.map((item: { id: string }) => item.id).sort() : []
      if (JSON.stringify(beforeIds) !== JSON.stringify(afterIds) && progressOwner() === ownerId) {
        await writeEncryptedValueUnlocked(name, filtered!)
        restored += Math.max(1, recovered - beforeIds.length)
      }
    }
    return restored
  })
}

async function readEncryptedValueUnlocked(name: string): Promise<string | null> {
  let db: IDBPDatabase<EncryptedStateDatabase>
  try {
    db = await database()
  } catch {
    return getLegacyValue(name)
  }
  try {
    const saved = await db.get('entries', name)
    if (saved) {
      if (protectedCollections.has(name) && saved.ownerId && saved.ownerId !== progressOwner()) return null
      const key = await getOrCreateKey(db)
      const value = await decryptJsonPayload<unknown>(saved.iv, saved.ciphertext, key)
      if (typeof value !== 'string') return null
      await preserveLegacyCollection(db, name, key)
      removeLegacyValue(name)
      return value
    }
  } catch {
    return null
  }

  const legacy = getLegacyValue(name)
  if (legacy == null) return null
  try {
    await writeEncryptedValueUnlocked(name, legacy)
    return legacy
  } catch {
    // Preserve a previous-version value if encrypted migration is unavailable.
    return legacy
  }
}

/** Read one encrypted Zustand-storage payload (or migrate its legacy localStorage value). */
export function readEncryptedPersistedValue(name: string): Promise<string | null> {
  return queueStorageOperation(() => readEncryptedValueUnlocked(name))
}

/** Write a Zustand-storage payload to encrypted IndexedDB, removing legacy plaintext only after success. */
export function writeEncryptedPersistedValue(name: string, value: string, ownerId = progressOwner()): Promise<void> {
  return queueStorageOperation(() => writeEncryptedValueUnlocked(name, value, ownerId))
}

/** Remove a persisted payload from encrypted IndexedDB and any legacy localStorage key. */
export function removeEncryptedPersistedValue(name: string): Promise<void> {
  return queueStorageOperation(async () => {
    try {
      const db = await database()
      await db.delete('entries', name)
    } finally {
      removeLegacyValue(name)
    }
  })
}

export const encryptedPersistStorage: StateStorage = {
  getItem: (name) => queueStorageOperation(async () => {
    let db: IDBPDatabase<EncryptedStateDatabase>
    try {
      db = await database()
    } catch {
      // Preserve access to existing local data if IndexedDB is blocked by the browser.
      return getLegacyValue(name)
    }
    let saved: StoredEncryptedState | undefined
    try {
      saved = await db.get('entries', name)
    } catch {
      return getLegacyValue(name)
    }
    if (saved) {
      if (protectedCollections.has(name) && saved.ownerId && saved.ownerId !== progressOwner()) return null
      try {
        const key = await getOrCreateKey(db)
        const value = await decryptJsonPayload<unknown>(saved.iv, saved.ciphertext, key)
        if (typeof value !== 'string') return null
        await preserveLegacyCollection(db, name, key)
        // Once the encrypted copy is verified, remove any stale cleartext left by an older restore path.
        removeLegacyValue(name)
        return value
      } catch {
        // Do not fall back to plaintext when an encrypted value is corrupt or the key is unavailable.
        return null
      }
    }

    const legacy = getLegacyValue(name)
    if (legacy == null) return null
    try {
      const key = await getOrCreateKey(db)
      const encrypted = await encryptJsonPayload(legacy, key)
      // Re-check under the serialized operation queue before committing legacy content.
      // No other write in this tab can replace this entry until the current operation finishes.
      const concurrent = await db.get('entries', name)
      if (concurrent) {
        try {
          const existingKey = await getOrCreateKey(db)
          const value = await decryptJsonPayload<unknown>(concurrent.iv, concurrent.ciphertext, existingKey)
          return typeof value === 'string' ? value : null
        } catch {
          return null
        }
      }
      await db.put('entries', { id: name, ...encrypted })
      // Remove the cleartext copy only after the encrypted record is safely committed.
      removeLegacyValue(name)
      return legacy
    } catch {
      // Preserve legacy user data if migration is impossible; no new plaintext writes are made.
      return legacy
    }
  }).then(value => { loadedCollections.add(name); return value }),

  setItem: (name, value) => {
    if (protectedCollections.has(name) && !loadedCollections.has(name)) return Promise.resolve()
    const ownerId = progressOwner()
    return queueStorageOperation(async () => {
    try {
      await writeEncryptedValueUnlocked(name, value, ownerId)
    } catch (error) {
      // Do not write an unencrypted fallback. A subsequent page visit can retry storage.
      console.warn('[Hyperion] Could not persist encrypted browser state.', error instanceof Error ? error.name : 'StorageError')
    }
    })
  },

  removeItem: (name) => queueStorageOperation(async () => {
    try {
      const db = await database()
      await db.delete('entries', name)
    } catch {
      // Continue with legacy-key cleanup even if IndexedDB is unavailable.
    } finally {
      removeLegacyValue(name)
    }
  })
}
