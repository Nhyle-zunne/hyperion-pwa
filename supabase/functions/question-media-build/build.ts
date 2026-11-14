import { deriveKeyBytes } from '../_shared/bankCodec.ts'
import { mediaObjectPath, imageSignatureMatches, sha256, isConfiguredQuestionBankAdmin, MAX_IMAGE_BYTES, type ImageTrack, type ImageMime } from '../question-media/policy.ts'
export const MAX_BUILD_BYTES = 10 * 1024 * 1024
export type BuildImage = { track: ImageTrack; sha256: string; mime: ImageMime }
export type BuildAsset = BuildImage & { path: string; ciphertext: string }
export function validateBuildImages(body: unknown): BuildImage[] {
  const images = (body as { images?: unknown })?.images
  if (!Array.isArray(images) || images.length < 1 || images.length > 20) throw new Error('Choose between 1 and 20 images.')
  const seen = new Set<string>()
  for (const ref of images) {
    const path = ref && mediaObjectPath(ref.track, ref.sha256, ref.mime)
    if (!path || Object.keys(ref).length !== 3 || seen.has(path)) throw new Error('Invalid or duplicate image reference.')
    seen.add(path)
  }
  return images
}
export async function authorizeBuild(authorization: string | null, mode: string | null, allowedEmails: string,
  getUser: () => Promise<{ id?: string; email?: string } | null>, fetcher: typeof fetch): Promise<boolean> {
  if (!authorization || !/^Bearer \S+$/.test(authorization)) return false
  if (mode === null) {
    try { const user = await getUser(); return !!user?.id && isConfiguredQuestionBankAdmin(user.email, allowedEmails) } catch { return false }
  }
  if (mode !== 'github') return false
  try {
    const response = await fetcher('https://api.github.com/repos/Nhyle-zunne/hyperion-reviewer', {
      headers: { Authorization: authorization, Accept: 'application/vnd.github+json', 'User-Agent': 'Hyperion-Media-Build', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(15000)
    })
    if (!response.ok) return false
    const repo = await response.json()
    // Public repository read or push permission must never authorize protected exports.
    return repo.full_name === 'Nhyle-zunne/hyperion-reviewer' &&
      (repo.permissions?.admin === true || repo.permissions?.maintain === true)
  } catch { return false }
}
export async function buildMediaAssets(images: BuildImage[], download: (path: string) => Promise<Blob | null>, maxBytes = MAX_BUILD_BYTES): Promise<{ assets: BuildAsset[] }> {
  const assets: BuildAsset[] = []
  let total = 0
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['encrypt'])
  for (const ref of validateBuildImages({ images })) {
    const objectPath = mediaObjectPath(ref.track, ref.sha256, ref.mime)!
    const blob = await download(objectPath)
    if (!blob || blob.size > MAX_IMAGE_BYTES) throw new Error('Verified question image not found or oversized.')
    const bytes = new Uint8Array(await blob.arrayBuffer())
    if (!imageSignatureMatches(bytes, ref.mime) || await sha256(bytes) !== ref.sha256) throw new Error('Question image integrity check failed.')
    total += bytes.length + 28
    if (total > maxBytes) throw new Error('Image export exceeds the combined 10 MiB limit.')
    const iv = crypto.getRandomValues(new Uint8Array(12))
    const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, bytes))
    const encrypted = new Uint8Array(iv.length + cipher.length); encrypted.set(iv); encrypted.set(cipher, iv.length)
    let binary = ''
    for (let i = 0; i < encrypted.length; i += 32768) binary += String.fromCharCode(...encrypted.subarray(i, i + 32768))
    assets.push({ ...ref, path: 'question-media/' + objectPath + '.enc', ciphertext: btoa(binary) })
  }
  return { assets }
}
