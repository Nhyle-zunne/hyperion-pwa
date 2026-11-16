import { deriveKeyBytes } from '../supabase/functions/_shared/bankCodec.ts'
import { MAX_IMAGE_BYTES, imageSignatureMatches, mediaObjectPath, sha256, type ImageMime, type ImageTrack } from '../supabase/functions/question-media/policy.ts'
import { readBounded } from '../supabase/functions/_shared/githubBankSource.ts'

/** Image bytes are SHA-addressed and checked against the published question refs before this is called. */
export async function readGithubQuestionImage(
  fetcher: typeof fetch, track: ImageTrack, digest: string, mime: ImageMime,
): Promise<Uint8Array> {
  const objectPath = mediaObjectPath(track, digest, mime)
  if (!objectPath) throw new Error('Invalid question image reference.')
  // The bank publication writes encrypted assets into the Android repository.
  // Main is used for older bundled diagrams that predate the release pointer;
  // the signed question reference and SHA-256 enforce their exact content.
  const url = 'https://raw.githubusercontent.com/Nhyle-zunne/hyperion-reviewer/main/app/src/main/assets/question-media/' + objectPath + '.enc'
  const upstream = await fetcher(url, { signal: AbortSignal.timeout(20000) })
  if (!upstream.ok) throw new Error('Question image is missing from the repository.')
  const encrypted = await readBounded(upstream.body, MAX_IMAGE_BYTES + 28)
  if (encrypted.length < 44) throw new Error('Encrypted diagram is incomplete.')
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['decrypt'])
  const decrypted = new Uint8Array(await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: encrypted.slice(0, 12), tagLength: 128 }, key, encrypted.slice(12)
  ))
  if (!imageSignatureMatches(decrypted, mime) || await sha256(decrypted) !== digest) {
    throw new Error('Question diagram failed integrity verification.')
  }
  return decrypted
}
