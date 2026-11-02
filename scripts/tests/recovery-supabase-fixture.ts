export * from '../../src/lib/supabase'
// Isolated synthetic backend for the real browser sync engine. Never used by app builds.
export const supabaseUrl = undefined
export const supabaseAnonKey = undefined
export const fixtureUsers = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222' }
let userId = localStorage.getItem('fixture-user') || fixtureUsers.a
const listeners = new Set<(event: string, session: unknown) => void>()
export const fixtureCalls: { userId: string; action: string }[] = []
const session = () => ({ user: { id: userId, email: 'synthetic@example.invalid' }, access_token: 'fixture-' + userId })
export function fixtureCloud(id = userId) { const raw = localStorage.getItem('fixture-cloud:' + id); return raw ? JSON.parse(raw) : null }
export function fixtureSetUser(id: string) { userId = id; localStorage.setItem('fixture-user', id); for (const listener of listeners) listener('SIGNED_IN', session()) }
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange: (listener: (event: string, session: unknown) => void) => { listeners.add(listener); return { data: { subscription: { unsubscribe: () => listeners.delete(listener) } } } }
  },
  functions: {
    invoke: async (name: string, request: { body?: Record<string, any>; headers?: Record<string, string> }) => {
      if (navigator.onLine === false) return { data: null, error: new Error('Synthetic offline connection') }
      const body = request.body ?? {}
      const bound = request.headers?.Authorization?.replace('Bearer fixture-', '') || userId
      fixtureCalls.push({ userId: bound, action: body.action ?? name })
      if (name !== 'learning-progress') return { data: { ok: true, isAdmin: true }, error: null }
      if (body.action === 'read') {
        const saved = fixtureCloud(bound)
        return { data: { data: saved?.data ?? null, updated_at: saved?.updated_at ?? null }, error: null }
      }
      if (body.action === 'write') {
        const saved = fixtureCloud(bound)
        if ((saved?.updated_at ?? null) !== body.expected_updated_at) return { data: null, error: Object.assign(new Error('409 conflict'), { context: { status: 409 } }) }
        const updated_at = new Date().toISOString()
        localStorage.setItem('fixture-cloud:' + bound, JSON.stringify({ data: body.data, updated_at }))
        return { data: { ok: true, updated_at }, error: null }
      }
      if (body.action === 'recover-saved') return { data: { ok: true }, error: null }
      const archiveKey = `fixture-archive:${bound}:${body.sessionId}`
      if (body.action === 'write-session') {
        localStorage.setItem(archiveKey, JSON.stringify(body.snapshot))
        return { data: { ok: true }, error: null }
      }
      if (body.action === 'read-session') return { data: { snapshot: JSON.parse(localStorage.getItem(archiveKey) || 'null') }, error: null }
      return { data: null, error: new Error('Unexpected fixture action') }
    }
  }
}
