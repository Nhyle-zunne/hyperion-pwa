import { deriveKeyBytes } from '../supabase/functions/_shared/bankCodec.ts'
import { GITHUB_BANK_ROOT, readBounded } from '../supabase/functions/_shared/githubBankSource.ts'
import { MAX_IMAGE_BYTES, imageSignatureMatches, mediaObjectPath, sha256, validMime, validTrack, type ImageMime, type ImageTrack } from '../supabase/functions/question-media/policy.ts'
import { PublisherError, apiClient } from './githubBankPublisher.ts'
import type { BuildAsset, BuildImage } from '../supabase/functions/question-media-build/build.ts'

/**
 * Immutable encrypted diagrams live in the Android source repository.
 * Unpublished uploads are staged on a separate GitHub branch, so editing an
 * image cannot change main, invalidate an open question-bank draft or expose it
 * to the published question pool. Publishing promotes the verified ciphertext
 * into the same atomic tree as the encrypted questions.
 */
const MEDIA_ROOT = 'app/src/main/assets/question-media'
const STAGING_BRANCH = 'hyperion-media-staging'
const MAX_CIPHERTEXT_BYTES = MAX_IMAGE_BYTES + 28
type GitApi = ReturnType<typeof apiClient>
type Upload = { track: ImageTrack; mime: ImageMime; bytes: Uint8Array; digest: string }

function encodeBase64(bytes: Uint8Array): string {
  let binary = ''
  for (let i = 0; i < bytes.length; i += 32768) binary += String.fromCharCode(...bytes.subarray(i, i + 32768))
  return btoa(binary)
}

async function decodeUpload(input: unknown): Promise<Upload> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new PublisherError('Invalid image upload.')
  const data = input as Record<string, unknown>
  if (data.action !== 'media-upload' || !validTrack(data.track) || !validMime(data.mime) ||
      typeof data.base64 !== 'string' || data.base64.length < 24 || data.base64.length > 700000 ||
      !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(data.base64)) {
    throw new PublisherError('Choose a valid PNG, JPEG or WebP image under 512 KiB.')
  }
  const bytes = Uint8Array.from(atob(data.base64), char => char.charCodeAt(0))
  if (!imageSignatureMatches(bytes, data.mime)) throw new PublisherError('Invalid or oversized question image.')
  return { track: data.track, mime: data.mime, bytes, digest: await sha256(bytes) }
}

function assetPath(ref: BuildImage): string {
  const path = mediaObjectPath(ref.track, ref.sha256, ref.mime)
  if (!path) throw new PublisherError('Invalid question image reference.')
  return MEDIA_ROOT + '/' + path + '.enc'
}

async function readEncrypted(api: GitApi, branch: string, ref: BuildImage): Promise<Uint8Array | null> {
  const response = await api('contents/' + assetPath(ref) + '?ref=' + branch, 'GET', undefined, true, true)
  return response ? readBounded(response.body, MAX_CIPHERTEXT_BYTES) : null
}

async function verifyEncrypted(encrypted: Uint8Array, ref: BuildImage): Promise<void> {
  if (encrypted.length < 44 || encrypted.length > MAX_CIPHERTEXT_BYTES) throw new PublisherError('GitHub question image has invalid encrypted bytes.', 409)
  try {
    const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['decrypt'])
    const plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.slice(0, 12), tagLength: 128 }, key, encrypted.slice(12)))
    if (!imageSignatureMatches(plaintext, ref.mime) || await sha256(plaintext) !== ref.sha256) throw new Error('integrity')
  } catch {
    throw new PublisherError('GitHub question image failed integrity verification; it was not replaced.', 409)
  }
}

async function getBranchHead(api: GitApi, branch: string): Promise<string | null> {
  const response = await api('git/ref/heads/' + branch, 'GET', undefined, false, true)
  if (!response) return null
  const data = await response.json() as { object?: { sha?: string } }
  if (!/^[a-f0-9]{40}$/.test(data.object?.sha || '')) throw new PublisherError('GitHub returned an invalid media branch.', 502)
  return data.object!.sha!
}

export async function stageGithubQuestionImage(fetcher: typeof fetch, token: string, input: unknown) {
  const { track, mime, bytes, digest } = await decodeUpload(input)
  const ref = { track, mime, sha256: digest }
  const api = apiClient(fetcher, token)
  // Re-uploading identical files is idempotent. Never overwrite an immutable hash.
  for (const branch of ['main', STAGING_BRANCH]) {
    const existing = await readEncrypted(api, branch, ref)
    if (existing) {
      await verifyEncrypted(existing, ref)
      return { track, mime, sha256: digest, bytes: bytes.length, source: 'github' }
    }
  }
  let stagingHead = await getBranchHead(api, STAGING_BRANCH)
  if (!stagingHead) {
    const mainHead = await getBranchHead(api, 'main')
    if (!mainHead) throw new PublisherError('The GitHub main branch is unavailable.', 503)
    await api('git/refs', 'POST', { ref: 'refs/heads/' + STAGING_BRANCH, sha: mainHead })
    stagingHead = mainHead
  }
  const base = await (await api('git/commits/' + stagingHead))!.json() as { tree?: { sha?: string } }
  if (!/^[a-f0-9]{40}$/.test(base.tree?.sha || '')) throw new PublisherError('Invalid GitHub staging tree.', 502)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['encrypt'])
  const ciphertext = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, bytes))
  const encrypted = new Uint8Array(iv.length + ciphertext.length)
  encrypted.set(iv)
  encrypted.set(ciphertext, iv.length)
  const blob = await (await api('git/blobs', 'POST', { encoding: 'base64', content: encodeBase64(encrypted) }))!.json() as { sha?: string }
  if (!/^[a-f0-9]{40}$/.test(blob.sha || '')) throw new PublisherError('GitHub returned an invalid media blob.', 502)
  const tree = await (await api('git/trees', 'POST', {
    base_tree: base.tree!.sha, tree: [{ path: assetPath(ref), mode: '100644', type: 'blob', sha: blob.sha }]
  }))!.json() as { sha?: string }
  if (!/^[a-f0-9]{40}$/.test(tree.sha || '')) throw new PublisherError('GitHub returned an invalid media tree.', 502)
  const commit = await (await api('git/commits', 'POST', {
    message: 'Stage encrypted Hyperion question image ' + digest.slice(0, 12),
    tree: tree.sha, parents: [stagingHead]
  }))!.json() as { sha?: string }
  if (!/^[a-f0-9]{40}$/.test(commit.sha || '')) throw new PublisherError('GitHub returned an invalid media commit.', 502)
  // Non-force update rejects concurrent writers rather than dropping uploads.
  await api('git/refs/heads/' + STAGING_BRANCH, 'PATCH', { sha: commit.sha, force: false })
  return { track, mime, sha256: digest, bytes: bytes.length, source: 'github' }
}

export function createGithubMediaBundler(fetcher: typeof fetch, token: string) {
  const api = apiClient(fetcher, token)
  return async (images: BuildImage[]): Promise<BuildAsset[]> => {
    const results: BuildAsset[] = []
    let total = 0
    for (const ref of images) {
      const encrypted = await readEncrypted(api, 'main', ref) ?? await readEncrypted(api, STAGING_BRANCH, ref)
      if (!encrypted) throw new PublisherError('Question image is not staged in GitHub. Upload the diagram again before publishing.', 409)
      await verifyEncrypted(encrypted, ref)
      total += encrypted.length
      if (total > 10 * 1024 * 1024) throw new PublisherError('Question images exceed the 10 MiB publication limit.', 413)
      results.push({ ...ref, path: 'question-media/' + mediaObjectPath(ref.track, ref.sha256, ref.mime) + '.enc', ciphertext: encodeBase64(encrypted) })
    }
    return results
  }
}
