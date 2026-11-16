import { supabase } from './supabase'
import { QUESTION_MEDIA_MAX_BYTES, type QuestionImageRef } from './questionMedia'
import { cacheUploadedQuestionImage } from './questionMediaCache'
import type { TrackId } from '../types/question'

function encodeBase64(bytes: Uint8Array): string {
  // Chunk encoding to avoid stack overflows on typical 100-500 KiB images.
  let binary = ''
  for (let pos=0;pos<bytes.length;pos+=8192) {
    binary += String.fromCharCode(...bytes.subarray(pos,pos+8192))
  }
  return btoa(binary)
}
async function toWebp(input: File): Promise<Blob> {
  if (!['image/webp','image/png','image/jpeg'].includes(input.type) ||
      input.size < 16 || input.size > 10_000_000) {
    throw Error('Choose a PNG, JPEG or WebP image under 10 MB.')
  }
  const bitmap = await createImageBitmap(input)
  try {
    if (bitmap.width < 1 || bitmap.height < 1 ||
        bitmap.width * bitmap.height > 20_000_000) {
      throw Error('Image dimensions are too large to process safely.')
    }
    // Bound image pixels, storage usage and offline cache size.
    const ratio = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement('canvas')
    canvas.width = Math.max(1, Math.round(bitmap.width * ratio))
    canvas.height = Math.max(1, Math.round(bitmap.height * ratio))
    const context = canvas.getContext('2d')
    if (!context) throw Error('This browser cannot resize images.')
    context.drawImage(bitmap,0,0,canvas.width,canvas.height)
    for (const quality of [0.82,0.70,0.56,0.4]) {
      const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve,'image/webp',quality))
      if (blob?.type === 'image/webp' && blob.size >= 16 &&
          blob.size <= QUESTION_MEDIA_MAX_BYTES) return blob
    }
    throw Error('Image cannot fit the 512 KB licensed attachment limit. Crop or reduce its resolution.')
  } finally {
    bitmap.close()
  }
}

export type ImageUploadProgress = { stage: 'preparing' | 'uploading' | 'verifying' | 'complete'; loaded: number; total: number }
type UploadOptions = { onProgress?: (progress: ImageUploadProgress) => void; signal?: AbortSignal }

function sendImage(body: string, token: string, options: UploadOptions): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest()
    const abort = () => { request.abort(); finish(new DOMException('Image upload cancelled.', 'AbortError')) }
    const finish = (error?: Error, data?: unknown) => {
      options.signal?.removeEventListener('abort', abort)
      if (error) reject(error); else resolve(data)
    }
    if (options.signal?.aborted) { reject(new DOMException('Image upload cancelled.', 'AbortError')); return }
    request.open('POST', '/api/question-bank/admin')
    request.timeout = 60000
    request.setRequestHeader('Authorization', `Bearer ${token}`)
    request.setRequestHeader('Content-Type', 'application/json')
    request.upload.onprogress = event => options.onProgress?.({ stage: 'uploading', loaded: event.loaded, total: event.lengthComputable ? event.total : 0 })
    request.upload.onload = () => options.onProgress?.({ stage: 'verifying', loaded: 0, total: 0 })
    request.onerror = () => finish(new Error('Image upload failed. Check your connection and retry.'))
    request.ontimeout = () => finish(new Error('Image upload timed out. Please retry.'))
    request.onabort = () => finish(new DOMException('Image upload cancelled.', 'AbortError'))
    request.onload = () => {
      if (request.status < 200 || request.status >= 300) { finish(new Error('The protected image upload failed. Check admin sign-in and retry.')); return }
      try { finish(undefined, JSON.parse(request.responseText)) }
      catch { finish(new Error('The image upload returned an invalid response.')) }
    }
    options.signal?.addEventListener('abort', abort, { once: true })
    options.onProgress?.({ stage: 'uploading', loaded: 0, total: new Blob([body]).size })
    if (options.signal?.aborted) { abort(); return }
    try { request.send(body) } catch { finish(new Error('Image upload could not start. Please retry.')) }
  })
}

export async function uploadQuestionImage(
  track: TrackId,
  file: File,
  placement: QuestionImageRef['placement'],
  alt: string,
  options: UploadOptions = {}
): Promise<QuestionImageRef> {
  if (alt.trim().length < 1 || alt.trim().length > 160 ||
      /[\x00-\x1F\x7F]/.test(alt)) throw Error('Enter an image description (1-160 characters).')
  if (!supabase) throw Error('Hyperion administration is not configured.')
  options.onProgress?.({ stage: 'preparing', loaded: 0, total: 0 })
  const blob = await toWebp(file)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const { data: { session }, error } = await supabase.auth.getSession()
  if (error || !session) throw Error('Sign in as an administrator to upload an image.')
  if (options.signal?.aborted) throw new DOMException('Image upload cancelled.', 'AbortError')
  const result = await sendImage(JSON.stringify({action:'media-upload',track,mime:'image/webp',base64:encodeBase64(bytes)}), session.access_token, options)
  const data = result as { track?: unknown; mime?: unknown; sha256?: unknown; bytes?: unknown } | null
  if (data?.track!==track || data?.mime!=='image/webp' || typeof data?.sha256 !== 'string' ||
      !/^[a-f0-9]{64}$/.test(data.sha256) || data.bytes!==bytes.length) {
    throw Error('The protected image upload did not verify. Check admin sign-in and retry.')
  }
  const hashed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
    .map(part=>part.toString(16).padStart(2,'0')).join('')
  if (options.signal?.aborted) throw new DOMException('Image upload cancelled.', 'AbortError')
  if (hashed!==data.sha256) throw Error('The server image fingerprint did not match the uploaded bytes.')
  const ref: QuestionImageRef = { sha256: hashed, mime: 'image/webp', placement, alt: alt.trim() }
  // A successful GitHub upload must stay successful even if this browser denies IndexedDB storage.
  await cacheUploadedQuestionImage(track, ref, blob).catch(() => undefined)
  options.onProgress?.({ stage: 'complete', loaded: bytes.length, total: bytes.length })
  return ref
}
