export * from '../../src/lib/supabase'

// Synthetic account responses for the isolated browser fixture; no production services.
export const supabaseConfigured = true
export const supabaseUrl = location.origin
export const supabaseAnonKey = 'synthetic-anon-key'
export const fixtureCalls: { action: string; data?: unknown }[] = []
let user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.invalid',
  user_metadata: { full_name: 'Synthetic Member', company: 'Fixture Company', school: 'Fixture School' },
}
const fixtureOrders = () => user.id !== '11111111-1111-4111-8111-111111111111' ? [] : localStorage.getItem('fixture-large-history') === 'yes' ? Array.from({ length: 65 }, (_, index) => ({
  id: `00000000-0000-4000-8000-${String(999 - index).padStart(12, '0')}`,
  product_code: 'oic_nw', license_term: 'year', amount_php: 350,
  status: index === 40 && localStorage.getItem('fixture-history-paid') !== 'yes' ? 'pending' : 'paid', payment_method: 'PayMongo Checkout',
  payment_reference: `history-reference-${index}`, customer_note: `Saved purchase note ${index}`, checkout_batch_id: null,
  created_at: new Date(Number(localStorage.getItem('fixture-history-epoch')) - Math.floor(index / 3) * 1000).toISOString(),
})) : localStorage.getItem('fixture-pending-orders') === 'yes' ? [
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
const authListeners = new Set<(event: string, value: ReturnType<typeof session>) => void>()
let releaseEntitlements: (() => void) | undefined
export function releaseFixtureEntitlements() { releaseEntitlements?.(); releaseEntitlements = undefined }
export function switchFixtureAccount() {
  user = { ...user, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.invalid', user_metadata: { full_name: 'Other Member', company: '', school: '' } }
  for (const listener of authListeners) listener('SIGNED_IN', session())
}
export const supabase = {
  auth: {
    getSession: async () => ({ data: { session: session() }, error: null }),
    onAuthStateChange: (listener: (event: string, value: ReturnType<typeof session>) => void) => {
      authListeners.add(listener)
      return { data: { subscription: { unsubscribe() { authListeners.delete(listener) } } } }
    },
    updateUser: async ({ data }: { data: typeof user.user_metadata }) => {
      fixtureCalls.push({ action: 'update-profile', data })
      user = { ...user, user_metadata: data }
      return { data: { user }, error: null }
    },
    signOut: async () => { fixtureCalls.push({ action: 'sign-out' }); return { error: null } },
  },
  from: (table: string) => {
    fixtureCalls.push({ action: `table:${table}` })
    const filters: { key: string; kind: string; value: unknown }[] = []
    const ordering: { key: string; ascending: boolean }[] = []
    let columns = '', limit = Infinity, cursor = ''
    const query = {
      select: (value: string) => { columns = value; return query },
      eq: (key: string, value: unknown) => { filters.push({ key, kind: 'eq', value }); return query },
      gt: (key: string, value: unknown) => { filters.push({ key, kind: 'gt', value }); return query },
      in: (key: string, value: unknown[]) => { filters.push({ key, kind: 'in', value }); return query },
      or: (value: string) => { cursor = value; return query },
      order: (key: string, { ascending }: { ascending: boolean }) => { ordering.push({ key, ascending }); return query },
      limit: (value: number) => { limit = value; return query },
      then: (resolve: (value: { data: unknown[]; error: unknown }) => unknown) => {
        fixtureCalls.push({ action: `select:${table}`, data: { columns, limit, cursor, filters } })
        if (cursor && localStorage.getItem('fixture-fail-older-orders') === 'yes') return Promise.resolve({ data: [], error: { message: 'Synthetic page failure' } }).then(resolve)
        let rows: Record<string, any>[] = table === 'orders' ? fixtureOrders().map(row => ({ ...row, user_id: user.id })) : []
        rows = rows.filter(row => filters.every(({ key, kind, value }) => kind === 'in' ? (value as unknown[]).includes(row[key]) : kind === 'gt' ? row[key] > value! : row[key] === value))
        if (cursor) {
          const match = cursor.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^\)]+)\)$/)
          if (!match) throw Error('Invalid synthetic cursor')
          rows = rows.filter(row => row.created_at < match[1] || row.created_at === match[2] && row.id < match[3])
        }
        rows.sort((a,b) => { for (const { key, ascending } of ordering) { const delta = String(a[key]).localeCompare(String(b[key])); if (delta) return ascending ? delta : -delta } return 0 })
        return Promise.resolve({ data: rows.slice(0, limit).map(row => Object.fromEntries(columns.split(',').map(key => [key, row[key]]))), error: null }).then(resolve)
      },
    }
    return query
  },
  functions: {
    invoke: async (name: string, request: { body?: { action?: string; orderId?: string; base64?: string; track?: string; mime?: string } }) => {
      fixtureCalls.push({ action: `${name}:${request.body?.action ?? ''}`, data: request.body })
      if (name === 'question-media') {
        const bytes = Uint8Array.from(atob(request.body?.base64 || ''), char => char.charCodeAt(0))
        const sha256 = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))).map(value => value.toString(16).padStart(2, '0')).join('')
        return { data: { track: request.body?.track, mime: request.body?.mime, bytes: bytes.length, sha256 }, error: null }
      }
      if (name === 'question-bank' && localStorage.getItem('fixture-hold-entitlements') === 'yes') {
        fixtureCalls.push({ action: 'fixture-entitlements-held' })
        return new Promise(resolve => { releaseEntitlements = () => resolve({ data: { token: 'invalid-synthetic-token' }, error: null }) })
      }
      if (name === 'verify-checkout' && localStorage.getItem('fixture-hold-payment') === 'yes') return new Promise(() => {})
      if (name === 'verify-checkout' && (localStorage.getItem('fixture-pending-orders') === 'yes' || localStorage.getItem('fixture-large-history') === 'yes')) {
        const paid = request.body?.orderId === 'recent-checkout' && localStorage.getItem('fixture-payment-paid') === 'yes' || request.body?.orderId === '00000000-0000-4000-8000-000000000959' && localStorage.getItem('fixture-history-paid') === 'yes'
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
