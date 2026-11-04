export * from '../../src/lib/supabase'

// Synthetic account responses for the isolated browser fixture; no production services.
export const supabaseConfigured = true
export const fixtureCalls: { action: string; data?: unknown }[] = []
let user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.invalid',
  user_metadata: { full_name: 'Synthetic Member', company: 'Fixture Company', school: 'Fixture School' },
}
const session = () => localStorage.getItem('fixture-guest') === 'yes' ? null : { user, access_token: 'fixture-token' }
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
    updateUser: async ({ data }: { data: typeof user.user_metadata }) => {
      fixtureCalls.push({ action: 'update-profile', data })
      user = { ...user, user_metadata: data }
      return { data: { user }, error: null }
    },
    signOut: async () => { fixtureCalls.push({ action: 'sign-out' }); return { error: null } },
  },
  from: (table: string) => {
    fixtureCalls.push({ action: `table:${table}` })
    const query = {
      select: () => query, eq: () => query, gt: () => query, in: () => query,
      order: () => query, limit: () => query,
      then: (resolve: (value: { data: never[]; error: null }) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
    }
    return query
  },
  functions: {
    invoke: async (name: string, request: { body?: { action?: string } }) => {
      fixtureCalls.push({ action: `${name}:${request.body?.action ?? ''}` })
      if (name === 'admin-payment-review') return { data: { isAdmin: false }, error: null }
      if (name === 'create-checkout' && request.body?.action === 'status') return { data: { action: 'status', enabled: true }, error: null }
      return { data: { entitlements: [] }, error: null }
    },
  },
}
