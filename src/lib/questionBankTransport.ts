import type { SupabaseClient } from '@supabase/supabase-js'

type Options = { body: Record<string, unknown> }
const SIGN_IN_AGAIN = 'Your sign-in session has expired. Please sign in again to load licensed questions.'

function isExpiredSessionError(error: unknown): boolean {
  const code = (error as { code?: unknown } | null)?.code
  return code === 'refresh_token_not_found' || code === 'refresh_token_already_used' ||
    code === 'invalid_refresh_token' || code === 'session_not_found' ||
    (error instanceof Error && /invalid refresh token|refresh token not found|auth session missing/i.test(error.message))
}

/** Public counts and free question pages avoid Auth; paid pages always carry identity. */
export async function invokeBankTransport(options: Options, client: SupabaseClient | null,
  _anonKey: string | undefined, githubDelivery: boolean, fetcher: typeof fetch = fetch) {
  const action = options.body.action
  const counts = action === 'counts' || action === 'catalog-counts'
  if (!githubDelivery || (!counts && action !== 'questions')) {
    if (!client) return { data: null as any, error: new Error('Question access is not configured.') as any }
    return client.functions.invoke('question-bank', options)
  }
  try {
    let response: Response
    let authenticatedToken: string | undefined
    let authenticatedUserId: string | undefined
    if (counts) {
      const query = new URLSearchParams({ track: String(options.body.track || ''), freeOnly: options.body.freeOnly === true ? '1' : '0' })
      query.set('retirement', '1')
      if (typeof options.body.bankRevision === 'string') query.set('bankRevision', options.body.bankRevision)
      response = await fetcher('/api/question-bank/counts?' + query)
    } else {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' }
      // Free Reviewer is served entirely by the public Cloudflare/GitHub
      // endpoint: no session refresh, anonymous credential, or Supabase call.
      // Paid pages still require the authenticated delivery path.
      if (options.body.freeOnly !== true) {
        if (!client) throw new Error('Question access is not configured.')
        const { data, error } = await client.auth.getSession().catch((error: unknown) => {
          throw isExpiredSessionError(error) ? new Error(SIGN_IN_AGAIN) : error
        })
        if (error) throw isExpiredSessionError(error) ? new Error(SIGN_IN_AGAIN) : error
        authenticatedToken = data.session?.access_token
        authenticatedUserId = data.session?.user?.id
        if (!authenticatedToken || !authenticatedUserId) throw new Error(SIGN_IN_AGAIN)
        headers.Authorization = `Bearer ${authenticatedToken}`
      }
      response = await fetcher('/api/question-bank/questions', { method: 'POST', headers, body: JSON.stringify(options.body) })
      // A token can be rejected after a local signed lease has been verified.
      // Renew only on 401, retry once for the same range and account, and let
      // the server re-check the live entitlement. Never substitute the anon key.
      if (response.status === 401 && options.body.freeOnly !== true && client) {
        const { data, error } = await client.auth.refreshSession().catch(() => ({ data: { session: null }, error: new Error(SIGN_IN_AGAIN) }))
        const renewed = data.session
        if (error || !renewed?.access_token ||
            renewed.user?.id !== authenticatedUserId ||
            renewed.access_token === authenticatedToken) {
          throw Object.assign(new Error(SIGN_IN_AGAIN), { context: response })
        }
        headers.Authorization = `Bearer ${renewed.access_token}`
        response = await fetcher('/api/question-bank/questions', { method: 'POST', headers, body: JSON.stringify(options.body) })
        if (response.status === 401) {
          throw Object.assign(new Error(SIGN_IN_AGAIN), { context: response })
        }
      }
    }
    if (!response.ok) {
      const failure = await response.clone().json().catch(() => null)
      return { data: null as any, error: Object.assign(new Error(failure?.error || 'Question access could not be verified.'), { context: response }) as any }
    }
    return { data: await response.json() as any, error: null as any }
  } catch (error) { return { data: null as any, error: error as any } }
}
