import { SOURCE_ASSETS, sourceInfo, toSearchQuestions } from '../supabase/functions/_shared/bankCodec.ts'
import type { BankRelease } from '../supabase/functions/_shared/githubBankSource.ts'

export const ADMIN_SEARCH_TRACKS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT']
export type AdminSearchInput = { query: string; track?: string; limit?: number; cursor?: number; bankRevision?: string }
export type AdminSearchResult = { path: string; ordinal: number; questionText: string; track: string; competenceId: string; part: number | null }
type SearchSource = { read: (path: string, release: BankRelease, persistToEdgeCache: boolean) => Promise<string> }
type IndexedQuestion = { result: AdminSearchResult; lowercaseText: string }

const orderedPaths = SOURCE_ASSETS.slice().sort((left, right) => {
  const a = sourceInfo(left)!, b = sourceInfo(right)!
  return ADMIN_SEARCH_TRACKS.indexOf(a.track) - ADMIN_SEARCH_TRACKS.indexOf(b.track)
    || Number(a.competenceId.slice(1)) - Number(b.competenceId.slice(1))
    || (a.part ?? 0) - (b.part ?? 0)
})

export function validAdminSearchInput(body: { query?: unknown; track?: unknown; limit?: unknown; cursor?: unknown; bankRevision?: unknown }): body is AdminSearchInput {
  return typeof body.query === 'string' && body.query.trim().length <= 160
    && (body.track === undefined || (typeof body.track === 'string' && ADMIN_SEARCH_TRACKS.includes(body.track)))
    && (body.bankRevision === undefined || (typeof body.bankRevision === 'string' && /^[a-f0-9]{40}$/.test(body.bankRevision)))
    && (body.cursor === undefined || (typeof body.cursor === 'number' && Number.isSafeInteger(body.cursor) && body.cursor >= 0 && body.cursor <= orderedPaths.filter(path => !body.track || sourceInfo(path)!.track === body.track).length))
    && (body.limit === undefined || (typeof body.limit === 'number' && Number.isSafeInteger(body.limit) && body.limit >= 1 && body.limit <= 100))
}

export function createAdminQuestionSearch() {
  // Keep completed metadata only: no answers, CSV, identities, or cross-request pending I/O.
  const indexes = new Map<string, IndexedQuestion[]>()
  return async (source: SearchSource, release: BankRelease, input: AdminSearchInput) => {
    const query = input.query.trim().toLowerCase(), limit = input.limit ?? 100
    const paths = orderedPaths.filter(path => !input.track || sourceInfo(path)!.track === input.track)
    const results: AdminSearchResult[] = []
    const cursor = input.cursor ?? 0, end = Math.min(paths.length, cursor + 12)
    // Twelve reads plus release/auth/config/cache operations fit the Free subrequest budget.
    for (let start = cursor; start < end; start += 4) {
      const loaded = await Promise.allSettled(paths.slice(start, Math.min(start + 4, end)).map(async path => {
        const key = release.revision + ':' + path
        let index = indexes.get(key)
        if (!index) {
          const text = await source.read(path, release, false)
          const info = sourceInfo(path)!
          index = toSearchQuestions(path, text).map((question, position) => {
            const questionText = String(question.questionText ?? '')
            return { result: { path, ordinal: position + 1, questionText: questionText.slice(0, 500), track: info.track, competenceId: info.competenceId, part: info.part }, lowercaseText: questionText.toLowerCase() }
          })
          indexes.set(key, index)
          while (indexes.size > SOURCE_ASSETS.length * 2) indexes.delete(indexes.keys().next().value!)
        }
        return index
      }))
      const failed = loaded.find(item => item.status === 'rejected')
      if (failed?.status === 'rejected') throw failed.reason
      const batch = loaded.flatMap(item => item.status === 'fulfilled' ? [item.value] : [])
      for (const index of batch) for (const question of index) {
        if (!query || String(question.result.ordinal) === query || question.lowercaseText.includes(query)) {
          results.push(question.result)
          if (results.length > limit) return { results: results.slice(0, limit), truncated: true, nextCursor: null, bankRevision: release.revision }
        }
      }
    }
    return { results, truncated: false, nextCursor: end < paths.length ? end : null, bankRevision: release.revision }
  }
}
