/** Security-sensitive, pure policy shared by upload/download and CI. */
export const MAX_IMAGE_BYTES = 524288
export const BUCKET = 'question-bank-media'
export const TRACKS = [
  'DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'
] as const
export type ImageTrack = typeof TRACKS[number]
export type ImageMime = 'image/webp' | 'image/png' | 'image/jpeg'

const exts: Record<ImageMime, string> = {
  'image/webp': 'webp',
  'image/png': 'png',
  'image/jpeg': 'jpg'
}
const SHA = /^[a-f0-9]{64}$/

export function validTrack(value: unknown): value is ImageTrack {
  return typeof value === 'string' && (TRACKS as readonly string[]).includes(value)
}
export function validMime(value: unknown): value is ImageMime {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(exts, value)
}
export function mediaObjectPath(track: unknown, sha: unknown, mime: unknown): string | null {
  if (!validTrack(track) || typeof sha !== 'string' || !SHA.test(sha) || !validMime(mime)) return null
  return `${track}/${sha}.${exts[mime]}`
}
export function imageSignatureMatches(bytes: Uint8Array, mime: ImageMime): boolean {
  if (bytes.byteLength < 16 || bytes.byteLength > MAX_IMAGE_BYTES) return false
  if (mime === 'image/png') return [137,80,78,71,13,10,26,10]
    .every((part, i) => bytes[i] === part)
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 &&
    bytes[2] === 0xff && bytes.at(-2) === 0xff && bytes.at(-1) === 0xd9
  if (mime === 'image/webp') return String.fromCharCode(...bytes.slice(0,4)) === 'RIFF' &&
    String.fromCharCode(...bytes.slice(8,12)) === 'WEBP'
  return false
}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', Uint8Array.from(bytes))))
    .map(part => part.toString(16).padStart(2, '0')).join('')
}
export function activePaidTrackRows(rows: unknown, userId: string, track: ImageTrack, now = Date.now()): boolean {
  if (!Array.isArray(rows)) return false
  return rows.some(row => row && typeof row === 'object' &&
    row.user_id === userId && row.track_id === track &&
    typeof row.expires_at === 'string' && Date.parse(row.expires_at) > now)
}
