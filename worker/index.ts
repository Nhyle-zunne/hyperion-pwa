import { PublisherError, publisherState, validateGithubBatch, publishGithubBatch, type PublishInput } from './githubBankPublisher.ts'
import { createGithubBankSource, GITHUB_BANK_REVISION, GITHUB_BANK_REPOSITORY, GITHUB_BANK_ROOT, githubAssetPath, readBounded } from '../supabase/functions/_shared/githubBankSource.ts'
import { SOURCE_ASSETS, sourceInfo, toSearchQuestions, sampleFreeCsv } from '../supabase/functions/_shared/bankCodec.ts'

type Env = { ASSETS: { fetch: typeof fetch }; GITHUB_BANK_READ_TOKEN?: string; GITHUB_BANK_WRITE_TOKEN?: string }
type Config = { supabaseUrl: string; supabaseAnonKey: string }
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function createBankWorker(fetcher: typeof fetch = fetch, cache?: Cache) {
  let source: ReturnType<typeof createGithubBankSource> | undefined
  let sourceToken: string | undefined
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    const readToken = env.GITHUB_BANK_READ_TOKEN
    if (!source || sourceToken !== readToken) { sourceToken = readToken; source = createGithubBankSource(fetcher, cache, readToken) }
    if (url.pathname === '/api/question-bank/source' && request.method === 'GET') {
      try { const release = await source.release(); return reply({ source: 'github', repository: GITHUB_BANK_REPOSITORY, root: GITHUB_BANK_ROOT, revision: release.revision, publishedAt: release.publishedAt, files: release.files.length }) }
      catch { return reply({ error: 'The GitHub release is temporarily unavailable.' }, 503) }
    }
    if (url.pathname === '/api/question-bank/admin') {
      if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
      if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) return reply({ error: 'Forbidden origin.' }, 403)
      const authorization = request.headers.get('Authorization')
      if (!authorization?.startsWith('Bearer ')) return reply({ error: 'Administrator sign-in is required.' }, 401)
      try {
        const configuration = await env.ASSETS.fetch(new Request(new URL('/hyperion-public-config.json', request.url)))
        const config = await configuration.json() as Config
        if (config.supabaseUrl !== 'https://evnjoezffghtrzqacwcj.supabase.co' || !config.supabaseAnonKey) return reply({ error: 'Administrator verification is unavailable.' }, 503)
        const grantResponse = await fetcher(config.supabaseUrl + '/functions/v1/question-bank', { method: 'POST', headers: { Authorization: authorization, apikey: config.supabaseAnonKey, 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'github-admin-access' }), signal: AbortSignal.timeout(15000) })
        if (!grantResponse.ok) return reply({ error: grantResponse.status === 401 || grantResponse.status === 403 ? 'Administrator access is required.' : 'Could not verify administrator access.' }, [401, 403].includes(grantResponse.status) ? grantResponse.status : 503)
        const grant = await grantResponse.json() as { allowed?: boolean; access?: string }
        if (grant.allowed !== true || grant.access !== 'admin') return reply({ error: 'Administrator access is required.' }, 403)
        if (Number(request.headers.get('Content-Length')) > 12 * 1024 * 1024) return reply({ error: 'Publication request exceeds 12 MiB.' }, 413)
        let body: PublishInput & { action?: string }
        try { body = JSON.parse(new TextDecoder().decode(await readBounded(request.body, 12 * 1024 * 1024))) } catch { return reply({ error: 'Invalid or oversized publication request.' }, 400) }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid administration request.' }, 400)
        const assets = SOURCE_ASSETS.map(path => ({ path, ...sourceInfo(path), repositoryPath: GITHUB_BANK_ROOT + '/' + githubAssetPath(path) }))
        const token = env.GITHUB_BANK_WRITE_TOKEN
        if (body.action === 'inventory') {
          const state = token ? await publisherState(fetcher, token) : null
          return reply({ assets, configured: !!token, source: 'github', repository: GITHUB_BANK_REPOSITORY, root: GITHUB_BANK_ROOT, head: state?.head, bankRevision: state?.release.revision, deliveryRevision: (await source.release()).revision })
        }
        if (!token) return reply({ error: 'GitHub publishing is not configured. Add GITHUB_BANK_WRITE_TOKEN as a Cloudflare Worker secret.' }, 503)
        if (body.action === 'validate') return reply({ preview: await validateGithubBatch(body, fetcher, token) })
        if (body.action === 'publish') { const result = await publishGithubBatch(body, fetcher, token); source.invalidate(); return reply({ ...result, source: 'github' }) }
        return reply({ error: 'Unknown administration action.' }, 400)
      } catch (error) { return reply({ error: error instanceof PublisherError ? error.message : 'GitHub administration is temporarily unavailable. Your live bank and saved progress remain preserved.' }, error instanceof PublisherError ? error.status : 503) }
    }
    if (url.pathname !== '/api/question-bank/questions') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
    if (Number(request.headers.get('Content-Length')) > 8192) return reply({ error: 'Request is too large.' }, 413)
    let body: { track?: string; competenceId?: string; part?: number | null; offset?: number; limit?: number; randomSample?: boolean; freeOnly?: boolean; bankRevision?: string }
    try {
      const raw = await request.text()
      if (raw.length > 8192) return reply({ error: 'Request is too large.' }, 413)
      body = JSON.parse(raw)
      if (!body || typeof body !== 'object' || Array.isArray(body)) return reply({ error: 'Invalid question request.' }, 400)
    } catch { return reply({ error: 'Invalid question request.' }, 400) }
    const track = body.track || '', competence = body.competenceId || ''
    const offset = body.offset ?? 0, limit = body.limit ?? 100, part = body.part ?? null
    const random = body.randomSample === true, freeOnly = body.freeOnly === true
    if (!['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'].includes(track) || !/^C\d+$/.test(competence) || !Number.isSafeInteger(offset) || offset < 0 || offset > 100000 || !Number.isSafeInteger(limit) || limit < 1 || limit > 200 || (part !== null && (!Number.isSafeInteger(part) || part < 1)) || (random && offset !== 0)) return reply({ error: 'Invalid question range.' }, 400)
    try {
      const configuration = await env.ASSETS.fetch(new Request(new URL('/hyperion-public-config.json', url)))
      if (!configuration.ok) throw new Error('Public configuration unavailable.')
      const config = await configuration.json() as Config
      if (config.supabaseUrl !== 'https://evnjoezffghtrzqacwcj.supabase.co' || typeof config.supabaseAnonKey !== 'string' || !config.supabaseAnonKey) throw new Error('Invalid public configuration.')
      const headers = new Headers({ 'Content-Type': 'application/json', apikey: config.supabaseAnonKey })
      const authorization = request.headers.get('Authorization')
      if (authorization) headers.set('Authorization', authorization)
      // Access checks are never cached. The server resolves Auth + current entitlement.
      const verified = await fetcher(`${config.supabaseUrl}/functions/v1/question-bank`, { method: 'POST', headers, body: JSON.stringify({ action: 'github-delivery-access', track, freeOnly, deliveryRoot: GITHUB_BANK_ROOT }), signal: AbortSignal.timeout(15000) })
      if (!verified.ok) return reply({ error: verified.status === 401 || verified.status === 403 ? 'An active license is required for this track.' : 'Could not verify question access.' }, verified.status === 401 || verified.status === 403 ? verified.status : 503)
      const grant = await verified.json() as { allowed?: boolean; track?: string; access?: string }
      if (grant.allowed !== true || grant.track !== track || (freeOnly ? grant.access !== 'free-sample' : !['admin', 'licensed'].includes(grant.access || ''))) return reply({ error: 'Could not verify question access.' }, 503)
      const release = await source.release()
      if (body.bankRevision && body.bankRevision !== release.revision) return reply({ error: 'The question bank changed. Reload this question set and retry.' }, 409)
      const paths = SOURCE_ASSETS.filter(path => { const info = sourceInfo(path); return info?.track === track && info.competenceId === competence && (part === null || info.part === part) }).sort((a, b) => (sourceInfo(a)?.part ?? 0) - (sourceInfo(b)?.part ?? 0))
      const questions: Record<string, unknown>[] = []
      for (const path of paths) {
        const text = await source.read(path, release)
        questions.push(...toSearchQuestions(path, freeOnly ? sampleFreeCsv(path, text) : text))
      }
      if (random) for (let index = questions.length - 1; index > 0; index--) { const next = Math.floor(Math.random() * (index + 1)); [questions[index], questions[next]] = [questions[next], questions[index]] }
      return reply({ questions: questions.slice(offset, offset + limit), totalCount: questions.length, offset, limit, access: grant.access, source: 'github', bankRevision: release.revision })
    } catch { return reply({ error: 'The GitHub question bank could not be loaded. Your saved study data is preserved; retry when connected.' }, 503) }
  }
}

let worker: ReturnType<typeof createBankWorker> | undefined
export default { fetch: (request: Request, env: Env) => {
  worker ??= createBankWorker(fetch, typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: Cache }).default)
  return worker(request, env)
} }
