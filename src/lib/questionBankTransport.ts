import type { SupabaseClient } from '@supabase/supabase-js'

type Options = { body: Record<string, unknown> }

/** Public counts avoid account services; every question page still carries identity. */
export async function invokeBankTransport(options: Options, client: SupabaseClient | null,
  anonKey: string | undefined, githubDelivery: boolean, fetcher: typeof fetch = fetch) {
  const action = options.body.action
  const counts = action === 'counts' || action === 'catalog-counts'
  if (!githubDelivery || (!counts && action !== 'questions')) {
    if (!client) return { data: null as any, error: new Error('Question access is not configured.') as any }
    return client.functions.invoke('question-bank', options)
  }
  try {
    let response: Response
    if (counts) {
      const query = new URLSearchParams({ track: String(options.body.track || ''), freeOnly: options.body.freeOnly === true ? '1' : '0' })
      if (typeof options.body.bankRevision === 'string') query.set('bankRevision', options.body.bankRevision)
      response = await fetcher('/api/question-bank/counts?' + query)
    } else {
      if (!client) throw new Error('Question access is not configured.')
      const { data } = await client.auth.getSession()
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      const token = data.session?.access_token || anonKey
      if (token) headers.Authorization = `Bearer ${token}`
      response = await fetcher('/api/question-bank/questions', { method: 'POST', headers, body: JSON.stringify(options.body) })
    }
    if (!response.ok) {
      const failure = await response.clone().json().catch(() => null)
      return { data: null as any, error: Object.assign(new Error(failure?.error || 'Question access could not be verified.'), { context: response }) as any }
    }
    return { data: await response.json() as any, error: null as any }
  } catch (error) { return { data: null as any, error: error as any } }
}
