import { createGithubBankSource, GITHUB_BANK_REVISION, GITHUB_BANK_REPOSITORY } from '../supabase/functions/_shared/githubBankSource.ts'
import { SOURCE_ASSETS, sourceInfo, toSearchQuestions, sampleFreeCsv } from '../supabase/functions/_shared/bankCodec.ts'

type Env = { ASSETS: { fetch: typeof fetch }; GITHUB_BANK_READ_TOKEN?: string }
type Config = { supabaseUrl: string; supabaseAnonKey: string }
const reply = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })

export function createBankWorker(fetcher: typeof fetch = fetch, cache?: Cache) {
  let source: ReturnType<typeof createGithubBankSource> | undefined
  let sourceToken: string | undefined
  return async (request: Request, env: Env): Promise<Response> => {
    const url = new URL(request.url)
    if (url.pathname === '/api/question-bank/source' && request.method === 'GET') return reply({ source: 'github', repository: GITHUB_BANK_REPOSITORY, revision: GITHUB_BANK_REVISION, files: SOURCE_ASSETS.length })
    if (url.pathname !== '/api/question-bank/questions') return env.ASSETS.fetch(request)
    if (request.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
    if (Number(request.headers.get('Content-Length')) > 8192) return reply({ error: 'Request is too large.' }, 413)
    let body: { track?: string; competenceId?: string; part?: number | null; offset?: number; limit?: number; randomSample?: boolean; freeOnly?: boolean }
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
      const verified = await fetcher(`${config.supabaseUrl}/functions/v1/question-bank`, { method: 'POST', headers, body: JSON.stringify({ action: 'github-delivery-access', track, freeOnly }), signal: AbortSignal.timeout(15000) })
      if (!verified.ok) return reply({ error: verified.status === 401 || verified.status === 403 ? 'An active license is required for this track.' : 'Could not verify question access.' }, verified.status === 401 || verified.status === 403 ? verified.status : 503)
      const grant = await verified.json() as { allowed?: boolean; track?: string; access?: string }
      if (grant.allowed !== true || grant.track !== track || (freeOnly ? grant.access !== 'free-sample' : !['admin', 'licensed'].includes(grant.access || ''))) return reply({ error: 'Could not verify question access.' }, 503)
      if (!source || sourceToken !== env.GITHUB_BANK_READ_TOKEN) {
        sourceToken = env.GITHUB_BANK_READ_TOKEN
        source = createGithubBankSource(fetcher, cache, sourceToken)
      }
      const paths = SOURCE_ASSETS.filter(path => { const info = sourceInfo(path); return info?.track === track && info.competenceId === competence && (part === null || info.part === part) }).sort((a, b) => (sourceInfo(a)?.part ?? 0) - (sourceInfo(b)?.part ?? 0))
      const questions: Record<string, unknown>[] = []
      for (const path of paths) {
        const text = await source(path)
        questions.push(...toSearchQuestions(path, freeOnly ? sampleFreeCsv(path, text) : text))
      }
      if (random) for (let index = questions.length - 1; index > 0; index--) { const next = Math.floor(Math.random() * (index + 1)); [questions[index], questions[next]] = [questions[next], questions[index]] }
      return reply({ questions: questions.slice(offset, offset + limit), totalCount: questions.length, offset, limit, access: grant.access, source: 'github', bankRevision: GITHUB_BANK_REVISION })
    } catch { return reply({ error: 'The GitHub question bank could not be loaded. Your saved study data is preserved; retry when connected.' }, 503) }
  }
}

let worker: ReturnType<typeof createBankWorker> | undefined
export default { fetch: (request: Request, env: Env) => {
  worker ??= createBankWorker(fetch, typeof caches === 'undefined' ? undefined : (caches as CacheStorage & { default?: Cache }).default)
  return worker(request, env)
} }
