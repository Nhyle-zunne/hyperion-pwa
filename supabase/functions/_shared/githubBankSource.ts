import manifest from './github-bank-manifest.json' with { type: 'json' }
import { decryptToText } from './bankCodec.ts'

export const GITHUB_BANK_REVISION = '91677156579dfea6f092097f324bec96c7c13e5b'
export const GITHUB_BANK_REPOSITORY = 'Nhyle-zunne/hyperion-reviewer'
export const GITHUB_BANK_FILES = manifest.files
export const GITHUB_BANK_PUBLISHED_AT = '2026-11-02T21:54:51Z'
const BASE = `https://raw.githubusercontent.com/${GITHUB_BANK_REPOSITORY}/${GITHUB_BANK_REVISION}/question-banks/`
const files = new Map(manifest.files.map(file => [file.path, file]))

/** Immutable GitHub files are hash-checked before decryption. No user data is cached. */
export function createGithubBankSource(fetcher: typeof fetch, cache?: Cache, readToken?: string) {
  const memory = new Map<string, Promise<string>>()
  return async (path: string): Promise<string> => {
    const file = files.get(path)
    if (!file) throw new Error('Unsupported GitHub question-bank path.')
    const found = memory.get(path)
    if (found) return found
    const load = (async () => {
      const request = readToken
        ? new Request(`https://api.github.com/repos/${GITHUB_BANK_REPOSITORY}/contents/question-banks/${path}?ref=${GITHUB_BANK_REVISION}`, { headers: { Authorization: `Bearer ${readToken}`, Accept: 'application/vnd.github.raw+json', 'User-Agent': 'Hyperion-Question-Bank' }, signal: AbortSignal.timeout(20000) })
        : new Request(BASE + path, { signal: AbortSignal.timeout(20000) })
      const cached = await cache?.match(request)
      const response = cached || await fetcher(request)
      if (!response.ok) throw new Error('The GitHub question bank is temporarily unavailable.')
      const bytes = new Uint8Array(await response.arrayBuffer())
      const hash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(byte => byte.toString(16).padStart(2, '0')).join('')
      if (bytes.length !== file.bytes || hash !== file.sha256) throw new Error('GitHub question-bank integrity check failed.')
      const text = await decryptToText(bytes)
      if (!cached && cache) { try { await cache.put(request, new Response(bytes, { headers: { 'Cache-Control': 'public, max-age=31536000, immutable' } })) } catch { /* Edge caching is best effort; verified source bytes are usable. */ } }
      return text
    })()
    memory.set(path, load)
    try { return await load } catch (error) { memory.delete(path); throw error }
  }
}
