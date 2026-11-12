import { openDB, type DBSchema } from 'idb'
import { supabase, supabaseAnonKey, supabaseUrl } from './supabase'
import { QUESTION_MEDIA_MAX_BYTES, type QuestionImageRef } from './questionMedia'
import type { TrackId } from '../types/question'
import { useLicenseStore } from '../stores/licenseStore'

interface SavedImage {
  id: string
  ownerId: string
  track: TrackId
  sha256: string
  mime: string
  blob: Blob
  storedAt: number
}
interface MediaDB extends DBSchema {
  images: { key: string; value: SavedImage }
}
const database = openDB<MediaDB>('hyperion-licensed-question-images', 1, {
  upgrade(db) { db.createObjectStore('images', { keyPath: 'id' }) }
})
const CACHE_LIMIT = 100 // at most 50 MiB in local browser storage, no Supabase writes
function cacheKey(owner: string, track: TrackId, sha: string) { return `${owner}:${track}:${sha}` }
function currentOwner(track: TrackId): string | null {
  const state = useLicenseStore.getState()
  return state.entitlementUserId && state.isTrackUnlocked(track) ? state.entitlementUserId : null
}
async function verifyImage(bytes: Uint8Array, ref: QuestionImageRef): Promise<boolean> {
  if (bytes.length < 16 || bytes.length > QUESTION_MEDIA_MAX_BYTES) return false
  const sha = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)))
    .map(value => value.toString(16).padStart(2, '0')).join('')
  if (sha !== ref.sha256) return false
  if (ref.mime === 'image/png') return [137,80,78,71,13,10,26,10].every((b,i)=>bytes[i]===b)
  if (ref.mime === 'image/jpeg') return bytes[0]===255 && bytes[1]===216 && bytes[2]===255
  return ref.mime === 'image/webp' &&
    String.fromCharCode(...bytes.slice(0,4))==='RIFF' &&
    String.fromCharCode(...bytes.slice(8,12))==='WEBP'
}
async function cached(owner: string, track: TrackId, ref: QuestionImageRef): Promise<Blob | null> {
  try {
    const saved = await (await database).get('images', cacheKey(owner,track,ref.sha256))
    if (!saved || saved.ownerId!==owner || saved.track!==track || saved.mime!==ref.mime) return null
    const bytes = new Uint8Array(await saved.blob.arrayBuffer())
    if (!await verifyImage(bytes,ref)) {
      await (await database).delete('images',saved.id)
      return null
    }
    return saved.blob
  } catch { return null }
}
async function store(owner: string, track: TrackId, ref: QuestionImageRef, blob: Blob) {
  try {
    const db = await database
    await db.put('images', { id:cacheKey(owner,track,ref.sha256),
      ownerId:owner,track,sha256:ref.sha256,mime:ref.mime,blob,storedAt:Date.now() })
    const all = await db.getAll('images')
    if (all.length > CACHE_LIMIT) {
      const stale = all.sort((a,b)=>a.storedAt-b.storedAt).slice(0,all.length-CACHE_LIMIT)
      const tx = db.transaction('images','readwrite')
      for (const item of stale) await tx.store.delete(item.id)
      await tx.done
    }
  } catch { /* optional browser cache; never block the reviewer */ }
}

/**
 * Only requests authenticated images when the current signed offline/online
 * entitlement permits this track. Cached bytes are owner-scoped and SHA-verified.
 * An expired or revoked local license cannot display previously stored images.
 */
export async function loadLicensedQuestionImage(track: TrackId, ref: QuestionImageRef): Promise<Blob> {
  const owner = currentOwner(track)
  if (!owner) throw new Error('An active track license is required to view this image.')
  const existing = await cached(owner,track,ref)
  if (existing) return existing
  if (!supabase || !supabaseUrl || !supabaseAnonKey) throw new Error('Image delivery is unavailable offline.')
  const { data: { session } } = await supabase.auth.getSession()
  if (!session || session.user.id !== owner) throw new Error('Sign in to download the licensed image.')
  const params = new URLSearchParams({track,sha256:ref.sha256,mime:ref.mime})
  const resp = await fetch(`${supabaseUrl}/functions/v1/question-media?${params.toString()}`,{
    headers: {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': supabaseAnonKey
    },
    cache: 'no-store'
  })
  if (!resp.ok) throw new Error(resp.status===403 ? 'This image requires a current track license.' :
    'The question image could not be downloaded.')
  if (resp.headers.get('content-type')?.split(';')[0] !== ref.mime ||
      resp.headers.get('X-Hyperion-Media-SHA256') !== ref.sha256 ||
      Number(resp.headers.get('content-length')||0) > QUESTION_MEDIA_MAX_BYTES) {
    throw new Error('The image response did not match its protected reference.')
  }
  const bytes = new Uint8Array(await resp.arrayBuffer())
  if (!await verifyImage(bytes,ref)) throw new Error('Image integrity verification failed.')
  if (currentOwner(track) !== owner) throw new Error('License/account changed during image loading.')
  const blob = new Blob([bytes], {type:ref.mime})
  await store(owner,track,ref,blob)
  return blob
}
