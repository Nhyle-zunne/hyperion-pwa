import { ProgressDeltaOutbox } from './progressDeltaOutbox.mjs'
import {
  readEncryptedPersistedValue,
  writeEncryptedPersistedValue,
  removeEncryptedPersistedValue
} from './encryptedPersistStorage'

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/**
 * A V2 outbox is scoped to ONE verified Supabase account. The calling sync
 * worker must check the current auth user again before ANY network request
 * and hold the per-account cross-tab progress lock.
 *
 * Uses the PWA's existing AES-GCM encrypted IndexedDB store. If encryption
 * or persistence fails, staging must fail closed. Never fall back to
 * localStorage or clear pending operations during account switches.
 *
 * Staged for rollout only: V1 sync does not call this factory yet.
 */
export function createEncryptedProgressDeltaOutbox(ownerId: string): ProgressDeltaOutbox {
  if (!UUID.test(ownerId)) throw new Error('Invalid progress outbox account.')
  const owner = ownerId.toLowerCase()
  const scopedKey = `hyperion:delta-outbox:${owner}`
  const verifyKey = (key: string): string => {
    if (key !== scopedKey) throw new Error('Cross-account progress outbox access blocked.')
    return key
  }
  return new ProgressDeltaOutbox({
    get: key => readEncryptedPersistedValue(verifyKey(key)),
    set: (key, value) => writeEncryptedPersistedValue(verifyKey(key), value, owner),
    remove: key => removeEncryptedPersistedValue(verifyKey(key))
  })
}
