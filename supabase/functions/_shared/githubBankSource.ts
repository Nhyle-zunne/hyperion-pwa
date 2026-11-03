import manifest from './github-bank-manifest.json' with { type: 'json' }
import { decryptToText } from './bankCodec.ts'

export const GITHUB_BANK_REVISION = '91677156579dfea6f092097f324bec96c7c13e5b'
export const GITHUB_BANK_REPOSITORY = 'Nhyle-zunne/hyperion-reviewer'
export const GITHUB_BANK_ROOT = 'app/src/main/assets/questions'
export const GITHUB_BANK_MANIFEST = 'hyperion-manifest.json'
export const GITHUB_BANK_RELEASE = 'hyperion-release.json'
export function githubAssetPath(path: string): string { return path.startsWith('gmdss/') ? 'pro/' + path.slice(6) : path }
export const GITHUB_BANK_FILES = manifest.files
export const GITHUB_BANK_PUBLISHED_AT = '2026-11-02T21:54:51Z'
export type BankFile = { path: string; bytes: number; sha256: string }
export type BankRelease = { revision: string; publishedAt: string; files: BankFile[]; publicationId?: string; inputDigest?: string; manifestSha256?: string }
export const INITIAL_BANK_RELEASE: BankRelease = { revision: GITHUB_BANK_REVISION, publishedAt: GITHUB_BANK_PUBLISHED_AT, files: GITHUB_BANK_FILES }
const paths = new Set(GITHUB_BANK_FILES.map(file => file.path))
class SourceUnavailable extends Error {}
class IntegrityError extends Error {}
export async function sha256(bytes: Uint8Array): Promise<string> {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', new Uint8Array(bytes).buffer))].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
export async function readBounded(stream: ReadableStream<Uint8Array> | null, max: number): Promise<Uint8Array> {
  if (!stream) return new Uint8Array()
  const reader = stream.getReader(), chunks: Uint8Array[] = []; let size = 0
  try { while (true) { const { value, done } = await reader.read(); if (done) break; size += value.byteLength; if (size > max) { await reader.cancel(); throw new Error('File or request exceeds its size limit.') } chunks.push(value) } }
  finally { reader.releaseLock() }
  const bytes = new Uint8Array(size); let offset = 0
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength }
  return bytes
}
export function githubBankRequest(path: string, revision: string, readToken?: string, fresh?: number): Request {
  const headers: Record<string, string> = { 'User-Agent': 'Hyperion-Question-Bank' }
  let url = `https://raw.githubusercontent.com/${GITHUB_BANK_REPOSITORY}/${revision}/${GITHUB_BANK_ROOT}/${githubAssetPath(path)}`
  if (readToken) {
    headers.Authorization = `Bearer ${readToken}`; headers.Accept = 'application/vnd.github.raw+json'
    url = `https://api.github.com/repos/${GITHUB_BANK_REPOSITORY}/contents/${GITHUB_BANK_ROOT}/${githubAssetPath(path)}?ref=${revision}`
  }
  if (fresh !== undefined) url += (url.includes('?') ? '&' : '?') + 'release-check=' + Math.floor(fresh / 60000)
  return new Request(url, { headers, signal: AbortSignal.timeout(20000) })
}
export function validateBankManifest(value: unknown): BankFile[] {
  const candidate = value as { version?: number; encrypted?: boolean; files?: BankFile[] }
  if (candidate?.version !== 1 || candidate.encrypted !== true || !Array.isArray(candidate.files) || candidate.files.length !== paths.size) throw new IntegrityError('Invalid GitHub bank manifest.')
  const seen = new Set<string>()
  return candidate.files.map(file => {
    if (!file || !paths.has(file.path) || seen.has(file.path) || !Number.isSafeInteger(file.bytes) || file.bytes < 28 || file.bytes > 1048576 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw new IntegrityError('Invalid GitHub bank manifest file.')
    seen.add(file.path); return { path: file.path, bytes: file.bytes, sha256: file.sha256 }
  })
}

/** Files and manifests use immutable commits. Only the small release pointer is refreshed. */
export function createGithubBankSource(fetcher: typeof fetch = fetch, cache?: Cache, readToken?: string, now = Date.now) {
  const memory = new Map<string, Promise<string>>()
  let verified: BankRelease | undefined, checkedAt = -Infinity, pending: Promise<BankRelease> | undefined
  async function release(force = false): Promise<BankRelease> {
    if (!force && verified && now() - checkedAt < 60000) return verified
    if (pending) return pending
    pending = (async () => {
      try {
        let response: Response
        try { response = await fetcher(githubBankRequest(GITHUB_BANK_RELEASE, 'main', readToken, now())) } catch { throw new SourceUnavailable('GitHub release is temporarily unavailable.') }
        if (response.status === 404) {
          if (verified && verified.revision !== GITHUB_BANK_REVISION) throw new IntegrityError('Published GitHub release pointer is missing.')
          verified = INITIAL_BANK_RELEASE; checkedAt = now(); return verified
        }
        if (!response.ok) throw new SourceUnavailable('GitHub release is temporarily unavailable.')
        let pointer: { version?: number; revision?: string; manifestSha256?: string; publishedAt?: string; publicationId?: string; inputDigest?: string }
        try { pointer = JSON.parse(new TextDecoder().decode(await readBounded(response.body, 4096))) } catch { throw new IntegrityError('Invalid GitHub release pointer.') }
        if (pointer.version !== 1 || !/^[a-f0-9]{40}$/.test(pointer.revision || '') || !/^[a-f0-9]{64}$/.test(pointer.manifestSha256 || '') || !Number.isFinite(Date.parse(pointer.publishedAt || '')) || typeof pointer.publicationId !== 'string' || pointer.publicationId.length > 128 || !/^[a-f0-9]{64}$/.test(pointer.inputDigest || '')) throw new IntegrityError('Invalid GitHub release pointer.')
        if (verified && verified.revision === pointer.revision && verified.manifestSha256 === pointer.manifestSha256) { checkedAt = now(); return verified }
        let manifestResponse: Response
        try { manifestResponse = await fetcher(githubBankRequest(GITHUB_BANK_MANIFEST, pointer.revision!, readToken)) } catch { throw new SourceUnavailable('GitHub manifest is temporarily unavailable.') }
        if (!manifestResponse.ok) throw new SourceUnavailable('GitHub manifest is temporarily unavailable.')
        const bytes = await readBounded(manifestResponse.body, 65536)
        if (await sha256(bytes) !== pointer.manifestSha256) throw new IntegrityError('GitHub manifest integrity check failed.')
        let parsed: unknown
        try { parsed = JSON.parse(new TextDecoder().decode(bytes)) } catch { throw new IntegrityError('Invalid GitHub bank manifest.') }
        verified = { revision: pointer.revision!, publishedAt: pointer.publishedAt!, files: validateBankManifest(parsed), manifestSha256: pointer.manifestSha256, publicationId: pointer.publicationId, inputDigest: pointer.inputDigest }
        checkedAt = now(); return verified
      } catch (error) {
        if (error instanceof SourceUnavailable && verified) { checkedAt = now(); return verified }
        throw error
      }
    })()
    try { return await pending } finally { pending = undefined }
  }
  async function read(path: string, snapshot: BankRelease): Promise<string> {
    const file = snapshot.files.find(item => item.path === path)
    if (!paths.has(path) || !file) throw new Error('Unsupported GitHub question-bank path.')
    const key = file.sha256 + ':' + path
    const found = memory.get(key); if (found) return found
    const load = (async () => {
      const request = githubBankRequest(path, snapshot.revision, readToken)
      const cached = await cache?.match(request), response = cached || await fetcher(request)
      if (!response.ok) throw new Error('The GitHub question bank is temporarily unavailable.')
      const bytes = await readBounded(response.body, 1048576)
      if (bytes.length !== file.bytes || await sha256(bytes) !== file.sha256) throw new IntegrityError('GitHub question-bank integrity check failed.')
      const text = await decryptToText(bytes)
      if (!cached && cache) { try { await cache.put(request, new Response(new Uint8Array(bytes).buffer, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })) } catch { /* Verified content remains usable if edge caching is unavailable. */ } }
      return text
    })()
    if (memory.size >= paths.size * 2) memory.delete(memory.keys().next().value!)
    memory.set(key, load)
    try { return await load } catch (error) { memory.delete(key); throw error }
  }
  const source = async (path: string) => read(path, await release())
  return Object.assign(source, { release, read, invalidate: () => { checkedAt = -Infinity } })
}
