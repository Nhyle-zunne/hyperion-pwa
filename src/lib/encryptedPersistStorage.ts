import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import type { StateStorage } from 'zustand/middleware'
import { decryptJsonPayload, encryptJsonPayload } from './jsonPayloadCrypto.mjs'
import { createSerialAsyncQueue } from './serializedAsyncQueue.mjs'

interface StoredEncryptedState {
  id: string
  iv: Uint8Array
  ciphertext: Uint8Array
}

interface EncryptedStateDatabase extends DBSchema {
  entries: { key: string; value: StoredEncryptedState }
  keys: { key: string; value: { id: string; key: CryptoKey } }
}

const DATABASE_NAME = 'hyperion-encrypted-browser-state'
const DATABASE_VERSION = 1
const ENCRYPTION_KEY_ID = 'encrypted-persist-state-key'
let databasePromise: Promise<IDBPDatabase<EncryptedStateDatabase>> | null = null
// Zustand can queue multiple state writes rapidly (for example, purging several tracks).
// Keep all IDB operations ordered so an older async encryption cannot overwrite newer state.
const queueStorageOperation = createSerialAsyncQueue()

function database() {
  if (!databasePromise) {
    databasePromise = openDB<EncryptedStateDatabase>(DATABASE_NAME, DATABASE_VERSION, {
      upgrade(db) {
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


async function writeEncryptedValueUnlocked(name: string, value: string): Promise<void> {
  const db = await database()
  const key = await getOrCreateKey(db)
  const encrypted = await encryptJsonPayload(value, key)
  await db.put('entries', { id: name, ...encrypted })
  // Keep migration and export paths from leaving a cleartext copy behind.
  removeLegacyValue(name)
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
      const key = await getOrCreateKey(db)
      const value = await decryptJsonPayload<unknown>(saved.iv, saved.ciphertext, key)
      return typeof value === 'string' ? value : null
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
export function writeEncryptedPersistedValue(name: string, value: string): Promise<void> {
  return queueStorageOperation(() => writeEncryptedValueUnlocked(name, value))
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
      try {
        const key = await getOrCreateKey(db)
        const value = await decryptJsonPayload<unknown>(saved.iv, saved.ciphertext, key)
        return typeof value === 'string' ? value : null
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
  }),

  setItem: (name, value) => queueStorageOperation(async () => {
    try {
      const db = await database()
      const key = await getOrCreateKey(db)
      const encrypted = await encryptJsonPayload(value, key)
      await db.put('entries', { id: name, ...encrypted })
    } catch (error) {
      // Do not write an unencrypted fallback. A subsequent page visit can retry storage.
      console.warn('[Hyperion] Could not persist encrypted browser state.', error instanceof Error ? error.name : 'StorageError')
    }
  }),

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
