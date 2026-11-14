import { openDB, type DBSchema, type IDBPDatabase } from 'idb'
import { supabase } from './supabase'
import type { Question } from '../types/question'
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
let mediaDatabase: Promise<IDBPDatabase<MediaDB>> | undefined
function database() {
  return mediaDatabase ??= openDB<MediaDB>('hyperion-licensed-question-images', 1, {
    upgrade(db) { db.createObjectStore('images', { keyPath: 'id' }) }
  })
}
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
    const saved = await (await database()).get('images', cacheKey(owner,track,ref.sha256))
    if (!saved || saved.ownerId!==owner || saved.track!==track || saved.mime!==ref.mime) return null
    const bytes = new Uint8Array(await saved.blob.arrayBuffer())
    if (!await verifyImage(bytes,ref)) {
      await (await database()).delete('images',saved.id)
      return null
    }
    return saved.blob
  } catch { return null }
}
async function store(owner: string, track: TrackId, ref: QuestionImageRef, blob: Blob) {
  // No fixed entry cap: removing an older diagram silently breaks complete offline packs.
  // A quota error must stop offline preparation instead of showing SAVED ON DEVICE.
  await (await database()).put('images', { id: cacheKey(owner, track, ref.sha256),
    ownerId: owner, track, sha256: ref.sha256, mime: ref.mime, blob, storedAt: Date.now() })
}

/**
 * Published Free Reviewer diagrams are available without an account; paid
 * diagrams still require the current user's license and identity. Cached bytes
 * are hash-verified and stored in separate free or owner-specific namespaces.
 */
export async function loadQuestionImage(track: TrackId, ref: QuestionImageRef, freeOnly: boolean, signal?: AbortSignal): Promise<Blob> {
  const owner = freeOnly ? 'public-free' : currentOwner(track)
  if (!owner) throw new Error('An active track license is required to view this image.')
  const assertAccess = () => {
    if (signal?.aborted) throw new DOMException('Image loading cancelled.', 'AbortError')
    if (!freeOnly && currentOwner(track) !== owner) throw new Error('License/account changed during image loading.')
  }
  assertAccess()
  const existing = await cached(owner,track,ref)
  assertAccess()
  if (existing) return existing
  const headers: Record<string, string> = {}
  if (!freeOnly) {
    if (!supabase) throw new Error('Sign in to access this licensed diagram.')
    const { data: { session } } = await supabase.auth.getSession()
    assertAccess()
    if (!session || session.user.id !== owner) throw new Error('Sign in to download the licensed image.')
    headers.Authorization = 'Bearer ' + session.access_token
  }
  const params = new URLSearchParams({ track, sha256: ref.sha256, mime: ref.mime, freeOnly: freeOnly ? '1' : '0' })
  const controller = new AbortController()
  const abort = () => controller.abort()
  signal?.addEventListener('abort', abort, { once: true })
  const timeout = setTimeout(abort, 20000)
  try {
    assertAccess()
    const resp = await fetch('/api/question-bank/media?' + params.toString(), {
      headers, cache: 'no-store', signal: controller.signal
    })
    if (!resp.ok) throw new Error(resp.status === 403 ? 'This image requires a current track license.' : 'The published question diagram could not be loaded.')
    if (resp.headers.get('content-type')?.split(';')[0] !== ref.mime ||
        resp.headers.get('X-Hyperion-Media-SHA256') !== ref.sha256 ||
        Number(resp.headers.get('content-length') || 0) > QUESTION_MEDIA_MAX_BYTES) {
      await resp.body?.cancel()
      throw new Error('The image response did not match its protected reference.')
    }
    const reader = resp.body?.getReader()
    if (!reader) throw new Error('The question image response was empty.')
    const chunks: Uint8Array[] = []
    let size = 0
    try {
      while (true) {
        assertAccess()
        const { done, value } = await reader.read()
        if (done) break
        size += value.byteLength
        if (size > QUESTION_MEDIA_MAX_BYTES) throw new Error('The question image exceeds the 512 KB limit.')
        chunks.push(value)
      }
    } catch (error) {
      await reader.cancel().catch(() => undefined)
      throw error
    } finally { reader.releaseLock() }
    const bytes = new Uint8Array(size)
    let offset = 0
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
    if (!await verifyImage(bytes, ref)) throw new Error('Image integrity verification failed.')
    assertAccess()
    const blob = new Blob([bytes], { type: ref.mime })
    await store(owner, track, ref, blob)
    assertAccess()
    return blob
  } finally {
    clearTimeout(timeout)
    signal?.removeEventListener('abort', abort)
  }
}

/** Keep existing callers strictly licensed; Free Reviewer explicitly selects the public tier. */
export const loadLicensedQuestionImage = (track: TrackId, ref: QuestionImageRef, signal?: AbortSignal) =>
  loadQuestionImage(track, ref, false, signal)

export async function offlineQuestionImagesComplete(track: TrackId, questions: Question[], freeOnly: boolean): Promise<boolean> {
  const refs = new Map<string, QuestionImageRef>()
  for (const question of questions) for (const ref of question.imageAttachments || []) refs.set(ref.sha256, ref)
  if (!refs.size) return true
  const owner = freeOnly ? 'public-free' : currentOwner(track)
  if (!owner) return false
  for (const ref of refs.values()) if (!await cached(owner, track, ref)) return false
  return freeOnly || currentOwner(track) === owner
}

export async function preloadQuestionImages(
  track: TrackId, questions: Question[], freeOnly: boolean,
  canContinue: () => boolean = () => true,
): Promise<void> {
  const refs = new Map<string, QuestionImageRef>()
  for (const question of questions) for (const ref of question.imageAttachments || []) refs.set(ref.sha256, ref)
  if (!refs.size) return
  for (const ref of refs.values()) {
    if (!canContinue()) throw new Error('Offline diagram preparation was interrupted. Retry while connected.')
    await loadQuestionImage(track, ref, freeOnly)
  }
  if (!canContinue() || !await offlineQuestionImagesComplete(track, questions, freeOnly)) {
    throw new Error('Not every question diagram is saved. Offline study is not ready yet.')
  }
}
