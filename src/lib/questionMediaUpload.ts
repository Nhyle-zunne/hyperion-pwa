import { supabase } from './supabase'
import { QUESTION_MEDIA_MAX_BYTES, type QuestionImageRef } from './questionMedia'
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

export async function uploadQuestionImage(
  track: TrackId,
  file: File,
  placement: QuestionImageRef['placement'],
  alt: string
): Promise<QuestionImageRef> {
  if (alt.trim().length < 1 || alt.trim().length > 160 ||
      /[\x00-\x1F\x7F]/.test(alt)) throw Error('Enter an image description (1-160 characters).')
  if (!supabase) throw Error('Hyperion administration is not configured.')
  const blob = await toWebp(file)
  const bytes = new Uint8Array(await blob.arrayBuffer())
  const {data,error} = await supabase.functions.invoke('question-media', {
    body: {track,mime:'image/webp',base64:encodeBase64(bytes)}
  })
  if (error || data?.track!==track || data?.mime!=='image/webp' ||
      !/^[a-f0-9]{64}$/.test(data?.sha256||'') || data.bytes!==bytes.length) {
    throw Error('The protected image upload did not verify. Check admin sign-in and retry.')
  }
  const hashed = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)))
    .map(part=>part.toString(16).padStart(2,'0')).join('')
  if (hashed!==data.sha256) throw Error('The server image fingerprint did not match the uploaded bytes.')
  return {sha256:hashed,mime:'image/webp',placement,alt:alt.trim()}
}
