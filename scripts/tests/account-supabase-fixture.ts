export * from '../../src/lib/supabase'

// Synthetic account responses for the isolated browser fixture; no production services.
export const supabaseConfigured = true
export const fixtureCalls: { action: string; data?: unknown }[] = []
let user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.invalid',
  user_metadata: { full_name: 'Synthetic Member', company: 'Fixture Company', school: 'Fixture School' },
}
const fixtureOrders = () => localStorage.getItem('fixture-pending-orders') === 'yes' ? [
  { id: 'recent-checkout', product_code: 'oic_nw', license_term: 'year', amount_php: 350,
    status: localStorage.getItem('fixture-recent-confirmed') === 'yes' ? 'paid' : 'pending', payment_method: 'PayMongo Checkout',
    created_at: new Date(Date.now() - 60_000).toISOString(), checkout_batch_id: null },
  { id: 'old-checkout', product_code: 'gmdss', license_term: 'month', amount_php: 40, status: 'pending',
    payment_method: 'PayMongo Checkout', created_at: new Date(Date.now() - 2 * 86400_000).toISOString(), checkout_batch_id: null },
  ...(localStorage.getItem('fixture-multiple-pending') === 'yes' ? [
    { id: 'second-checkout', product_code: 'oic_ew', license_term: 'year', amount_php: 350, status: 'pending',
      payment_method: 'PayMongo Checkout', created_at: new Date(Date.now() - 60_000).toISOString(), checkout_batch_id: null },
  ] : []),
] : []
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
      then: (resolve: (value: { data: unknown[]; error: null }) => unknown) => Promise.resolve({ data: table === 'orders' ? fixtureOrders() : [], error: null }).then(resolve),
    }
    return query
  },
  functions: {
    invoke: async (name: string, request: { body?: { action?: string; orderId?: string } }) => {
      fixtureCalls.push({ action: `${name}:${request.body?.action ?? ''}`, data: request.body })
      if (name === 'verify-checkout' && localStorage.getItem('fixture-hold-payment') === 'yes') return new Promise(() => {})
      if (name === 'verify-checkout' && localStorage.getItem('fixture-pending-orders') === 'yes') {
        const paid = request.body?.orderId === 'recent-checkout' && localStorage.getItem('fixture-payment-paid') === 'yes'
        if (paid) localStorage.setItem('fixture-recent-confirmed', 'yes')
        return { data: { status: paid ? 'paid' : 'pending', productCodes: paid ? ['oic_nw'] : [] }, error: null }
      }
      if (name === 'admin-license-management' && request.body?.action === 'list') return {
        data: { users: [
          { id: 'fixture-active', display_name: 'Synthetic Licensed Member', email: 'licensed@example.invalid', created_at: '2026-10-01T00:00:00Z', last_accessed_at: '2026-11-01T00:00:00Z', last_access_source: 'website_activity', retention_status: 'active_license_protected', retention_due_at: null, licenses: { oic_nw: { status: 'active' } } },
          { id: 'fixture-free', display_name: 'Synthetic Free Member', email: 'free@example.invalid', created_at: '2026-10-02T00:00:00Z', last_accessed_at: '2026-11-01T00:00:00Z', last_access_source: 'website_activity', retention_status: 'free_account_active', retention_due_at: '2027-01-01T00:00:00Z', licenses: {} },
        ], audit: [] }, error: null,
      }
      if (name === 'admin-payment-review') return { data: { isAdmin: false }, error: null }
      if (name === 'create-checkout' && request.body?.action === 'status') return { data: { action: 'status', enabled: true }, error: null }
      return { data: { entitlements: [] }, error: null }
    },
  },
}
