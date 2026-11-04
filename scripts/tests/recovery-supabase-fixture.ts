export * from '../../src/lib/supabase'
// Isolated synthetic backend for the real browser sync engine. Never used by app builds.
export const supabaseUrl = undefined
export const supabaseAnonKey = undefined
export const fixtureUsers = { a: '11111111-1111-4111-8111-111111111111', b: '22222222-2222-4222-8222-222222222222' }
let userId: string | null = localStorage.getItem('fixture-guest') === 'yes' ? null : localStorage.getItem('fixture-user') || fixtureUsers.a
const listeners = new Set<(event: string, session: unknown) => void>()
export const fixtureCalls: { userId: string; action: string; sessionId?: string; sessionIds?: string[] }[] = []
let nextRecoveryGate: Promise<void> | null = null
let releaseRecovery: (() => void) | undefined
let recoverySkips=0
export function fixtureHoldRecovery(skip=0){recoverySkips=skip;nextRecoveryGate=new Promise(resolve=>{releaseRecovery=resolve})}
export function fixtureReleaseRecovery(){releaseRecovery?.()}
let nextReadGate: Promise<void> | null = null
let releaseRead: (() => void) | undefined
export function fixtureHoldNextRead() { nextReadGate = new Promise(resolve => { releaseRead = resolve }) }
export function fixtureReleaseRead() { releaseRead?.() }
let archiveGate: Promise<void> | null = null
let releaseArchive: (() => void) | undefined
export function fixturePauseArchives() { archiveGate = new Promise(resolve => { releaseArchive = resolve }) }
export function fixtureReleaseArchives() { archiveGate = null; releaseArchive?.() }
const session = () => localStorage.getItem('fixture-offline-auth-missing') === 'yes' && navigator.onLine === false ? null : userId ? ({ user: { id: userId, email: 'synthetic@example.invalid' }, access_token: 'fixture-' + userId }) : null
export function fixtureCloud(id = userId) { const raw = localStorage.getItem('fixture-cloud:' + id); return raw ? JSON.parse(raw) : null }
export function fixtureSetUser(id: string | null) { userId = id; if(id){localStorage.setItem('fixture-user',id);localStorage.removeItem('fixture-guest')}else{localStorage.removeItem('fixture-user');localStorage.setItem('fixture-guest','yes')} for(const listener of listeners)listener(id?'SIGNED_IN':'SIGNED_OUT',session()) }
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
      fixtureCalls.push({ userId: bound, action: body.action ?? name, sessionId: body.sessionId, sessionIds: body.sessions?.map((entry: any) => entry.sessionId) })
      if (name !== 'learning-progress') return { data: { ok: true, isAdmin: true }, error: null }
      if (body.action === 'read' && localStorage.getItem('fixture-progress-error')) return { data: null, error: Object.assign(new Error('Synthetic progress outage'), { context: { status: 503 } }) }
      if (body.action === 'read') {
        const gate = nextReadGate; nextReadGate = null; await gate
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
      if (body.action === 'recover-saved') {if(nextRecoveryGate && recoverySkips--<=0){const gate=nextRecoveryGate;nextRecoveryGate=null;await gate}return { data: { ok: true }, error: null }}
      if (body.action === 'write-session' || body.action === 'write-sessions') await archiveGate
      const archiveKey = `fixture-archive:${bound}:${body.sessionId}`
      if ((body.action === 'write-session' || body.action === 'write-sessions') && localStorage.getItem('fixture-archive-error')) return { data: null, error: Object.assign(new Error('Unknown progress action.'), { context: { status: Number(localStorage.getItem('fixture-archive-error')) } }) }
      if (body.action === 'write-sessions') {
        for (const entry of body.sessions) localStorage.setItem(`fixture-archive:${bound}:${entry.sessionId}`, JSON.stringify(entry.snapshot))
        return { data: { ok: true, sessionIds: body.sessions.map((entry: any) => entry.sessionId) }, error: null }
      }
      if (body.action === 'write-session') {
        localStorage.setItem(archiveKey, JSON.stringify(body.snapshot))
        return { data: { ok: true }, error: null }
      }
      if (body.action === 'read-session' && localStorage.getItem('fixture-audit-unavailable')) return { data: null, error: new Error('Synthetic audit service outage') }
      if (body.action === 'read-session') return { data: { snapshot: JSON.parse(localStorage.getItem(archiveKey) || 'null') }, error: null }
      return { data: null, error: new Error('Unexpected fixture action') }
    }
  }
}
