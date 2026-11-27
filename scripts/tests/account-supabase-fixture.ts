export * from '../../src/lib/supabase'

// Synthetic account responses for the isolated browser fixture; no production services.
export const supabaseConfigured = true
export const supabaseUrl = location.origin
export const supabaseAnonKey = 'synthetic-anon-key'
export const fixtureCalls: { action: string; data?: unknown }[] = []
let user = {
  id: '11111111-1111-4111-8111-111111111111',
  email: 'synthetic@example.invalid',
  user_metadata: { full_name: 'Synthetic Member', company: 'Fixture Company', school: 'Fixture School', track_category: 'DECK' },
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
const fixtureManualClaims = () => user.id === '11111111-1111-4111-8111-111111111111' && localStorage.getItem('fixture-manual-claim') === 'yes' ? [{
  id: '33333333-3333-4333-8333-333333333333', user_id: user.id,
  selection_key: 'oic_nw:month',
  items: [{ code: 'oic_nw', label: 'Deck OIC-NW', term: 'month', amountPhp: 79 }],
  total_amount_php: 79, status: localStorage.getItem('fixture-manual-approved') === 'yes' ? 'approved' : 'awaiting_proof',
  created_at: new Date(Date.now() - 10_000).toISOString(), expires_at: new Date(Date.now() + 72 * 3600_000).toISOString(),
  reviewed_at: localStorage.getItem('fixture-manual-approved') === 'yes' ? localStorage.getItem('fixture-manual-approved-at') : null,
}] : []
const session = () => localStorage.getItem('fixture-guest') === 'yes' ? null : { user, access_token: 'fixture-token' }
const authListeners = new Set<(event: string, value: ReturnType<typeof session>) => void>()
const heldSessionResolvers: (() => void)[] = []
export function releaseFixtureHeldNullSession() {
  for (const resolve of heldSessionResolvers.splice(0)) resolve()
}
export function emitFixtureAuth(event: 'SIGNED_IN' | 'SIGNED_OUT') {
  for (const listener of authListeners) listener(event, event === 'SIGNED_OUT' ? null : session())
}
export function clearFixtureTrackCategory() {
  const { track_category: _oldCategory, ...details } = user.user_metadata
  user = { ...user, user_metadata: { ...details, track_category: '' } }
  emitFixtureAuth('SIGNED_IN')
}
let releaseEntitlements: (() => void) | undefined
export function releaseFixtureEntitlements() { releaseEntitlements?.(); releaseEntitlements = undefined }
export function switchFixtureAccount() {
  user = { ...user, id: '22222222-2222-4222-8222-222222222222', email: 'other@example.invalid', user_metadata: { full_name: 'Other Member', company: '', school: '', track_category: 'ENGINE' } }
  for (const listener of authListeners) listener('SIGNED_IN', session())
}
export const supabase = {
  auth: {
    getUser: async () => ({ data: { user: session()?.user ?? null }, error: null }),
    signInWithOAuth: async (options: unknown) => {
      fixtureCalls.push({ action: 'sign-in-google', data: options })
      return { data: { url: null }, error: null }
    },
    getSession: async () => {
      if (localStorage.getItem('fixture-hold-account-session') === 'yes') {
        return new Promise(resolve => heldSessionResolvers.push(() => resolve({ data: { session: null }, error: null })))
      }
      if (localStorage.getItem('fixture-account-auth-failure') === 'yes') throw Error('Synthetic mobile network failure')
      return { data: { session: session() }, error: null }
    },
    onAuthStateChange: (listener: (event: string, value: ReturnType<typeof session>) => void) => {
      authListeners.add(listener)
      return { data: { subscription: { unsubscribe() { authListeners.delete(listener) } } } }
    },
    updateUser: async ({ data }: { data: Partial<typeof user.user_metadata> }) => {
      fixtureCalls.push({ action: 'update-profile', data })
      user = { ...user, user_metadata: { ...user.user_metadata, ...data } }
      for (const listener of authListeners) listener('USER_UPDATED', session())
      return { data: { user }, error: null }
    },
    signOut: async (options?: { scope?: string }) => {
      fixtureCalls.push({ action: 'sign-out', data: options })
      localStorage.setItem('fixture-guest', 'yes')
      for (const listener of authListeners) listener('SIGNED_OUT', null)
      return { error: null }
    },
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
      not: (key: string, operator: string, value: unknown) => {
        if (operator !== 'is' || value !== null) throw Error('Unsupported fixture NOT filter')
        filters.push({ key, kind: 'not-null', value })
        return query
      },
      in: (key: string, value: unknown[]) => { filters.push({ key, kind: 'in', value }); return query },
      or: (value: string) => {
        if (table === 'manual_checkout_claims' && value.startsWith('status.eq.pending_verification,and(status.eq.awaiting_proof,expires_at.gt.')) {
          filters.push({ key: 'status', kind: 'open-manual', value: null })
        } else cursor = value
        return query
      },
      order: (key: string, { ascending }: { ascending: boolean }) => { ordering.push({ key, ascending }); return query },
      limit: (value: number) => { limit = value; return query },
      then: (resolve: (value: { data: unknown[]; error: unknown }) => unknown) => {
        fixtureCalls.push({ action: `select:${table}`, data: { columns, limit, cursor, filters } })
        if (table === 'payment_settings' && localStorage.getItem('fixture-checkout-fetch-fails') === 'yes') return Promise.resolve({ data: [], error: { message: 'Synthetic settings outage' } }).then(resolve)
        if (cursor && localStorage.getItem('fixture-fail-older-orders') === 'yes') return Promise.resolve({ data: [], error: { message: 'Synthetic page failure' } }).then(resolve)
        const websiteRenewal = localStorage.getItem('fixture-renewal-website') === 'yes'
        const playRenewal = localStorage.getItem('fixture-renewal-play') === 'yes'
        const fixtureLicense = {
          user_id: user.id, product_code: 'oic_nw', status: 'active',
          granted_at: new Date(Date.now() - 86400_000).toISOString(),
          expires_at: new Date(Date.now() + 5 * 86400_000).toISOString(),
        }
        let rows: Record<string, any>[] = table === 'payment_settings'
          ? [{ id: 1, website_checkout_enabled: localStorage.getItem('fixture-checkout-enabled') === 'yes' }]
          : table === 'manual_checkout_claims' ? fixtureManualClaims()
          : table === 'orders' ? fixtureOrders().map(row => ({ ...row, user_id: user.id }))
          : table === 'lifetime_orders' && user.id === '11111111-1111-4111-8111-111111111111'
            && localStorage.getItem('fixture-lifetime-pending') === 'yes'
              ? [{id:'88888888-8888-4888-8888-888888888888',user_id:user.id,product_code:'gmdss',
                  amount_php:1999,status:'pending',created_at:new Date().toISOString(),paid_at:null,
                  paymongo_checkout_session_id:'cs_fixture_lifetime'}]
          : table === 'entitlements' && websiteRenewal ? [{ ...fixtureLicense, order_id: null, license_term: 'week', renewed_at: null }]
          : table === 'google_play_entitlements' && playRenewal ? [{ ...fixtureLicense, updated_at: new Date().toISOString() }]
          : []
        rows = rows.filter(row => filters.every(({ key, kind, value }) => kind === 'open-manual' ? row.status === 'pending_verification' || (row.status === 'awaiting_proof' && Date.parse(row.expires_at) > Date.now()) : kind === 'in' ? (value as unknown[]).includes(row[key]) : kind === 'gt' ? row[key] > value! : kind === 'not-null' ? row[key] !== null && row[key] !== undefined : row[key] === value))
        if (cursor) {
          const match = cursor.match(/^created_at\.lt\.([^,]+),and\(created_at\.eq\.([^,]+),id\.lt\.([^\)]+)\)$/)
          if (!match) throw Error('Invalid synthetic cursor')
          rows = rows.filter(row => row.created_at < match[1] || row.created_at === match[2] && row.id < match[3])
        }
        rows.sort((a,b) => { for (const { key, ascending } of ordering) { const delta = String(a[key]).localeCompare(String(b[key])); if (delta) return ascending ? delta : -delta } return 0 })
        return Promise.resolve({ data: rows.slice(0, limit).map(row => Object.fromEntries(columns.split(',').map(key => [key, row[key]]))), error: null }).then(resolve)
      },
      single: async () => {
        const result = await query.then(value => value)
        return { data: result.data[0] ?? null, error: result.error || (result.data.length === 1 ? null : { message: 'Expected one row' }) }
      },
    }
    return query
  },
  functions: {
    invoke: async (name: string, request: { body?: { action?: string; orderId?: string; selection?: string; base64?: string; track?: string; mime?: string; enabled?: boolean } }) => {
      fixtureCalls.push({ action: `${name}:${request.body?.action ?? ''}`, data: request.body })
      if (name === 'create-manual-checkout-claim') {
        if (!user || localStorage.getItem('fixture-guest') === 'yes') return { data: { error: 'Sign in required' }, error: null }
        if (request.body?.selection !== 'oic_nw:month') return { data: { error: 'Invalid selection' }, error: null }
        if (localStorage.getItem('fixture-duplicate-conflict') === 'yes') {
          // Another checkout tab persisted the overlapping claim before this request arrived.
          localStorage.setItem('fixture-manual-claim', 'yes')
          return { data: { error: 'You already have a pending request for this track. Do not pay again. View your payment history instead.' }, error: null }
        }
        if (localStorage.getItem('fixture-lost-claim-response') === 'yes') {
          localStorage.setItem('fixture-manual-claim', 'yes')
          return { data: null, error: new Error('Synthetic connection lost after saving request') }
        }
        localStorage.setItem('fixture-manual-claim', 'yes')
        return { data: { id:'33333333-3333-4333-8333-333333333333',status:'awaiting_proof',totalAmountPhp:79 }, error: null }
      }
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
      if (name === 'admin-payment-review') {
        const isAdmin = localStorage.getItem('fixture-admin') === 'yes' && user.id === '11111111-1111-4111-8111-111111111111'
        if (request.body?.action === 'check-admin') return { data: { isAdmin }, error: null }
        if (!isAdmin) return { data: { error: 'Admin access denied' }, error: { message: 'Admin access denied' } }
        if (request.body?.action === 'list') {
          const sample = { user_id: user.id, email: 'customer@example.invalid', customer_name: 'Boss Sample Seafarer', items: [{ code: 'oic_nw', label: 'Deck OIC-NW', term: 'year', amountPhp: 499 }], total_amount_php: 499, created_at: '2026-11-25T00:00:00Z', expires_at: '2026-11-27T00:00:00Z', proof_received_at: null, reviewed_at: null, reviewed_by: null, admin_note: null }
          const includeClaims = localStorage.getItem('fixture-manual-claims') === 'yes'
          const manualClaimId = '55555555-5555-4555-8555-555555555555'
          const claims = includeClaims ? [
            { ...sample, id: '33333333-3333-4333-8333-333333333333', status: localStorage.getItem('fixture-approved-claim') === 'yes' ? 'approved' : 'awaiting_proof' },
            { ...sample, id: '44444444-4444-4444-8444-444444444444', status: 'pending_verification', proof_received_at: '2026-11-25T01:00:00Z' },
            { ...sample, id: manualClaimId, status: 'approved', reviewed_at: '2026-11-25T02:00:00Z' },
            { ...sample, id: '88888888-8888-4888-8888-888888888888', status: 'rejected', reviewed_at: '2026-11-25T03:00:00Z' },
            { ...sample, id: '99999999-9999-4999-8999-999999999999', status: 'expired' },
          ] : []
          const order = { user_id: user.id, email: 'customer@example.invalid', product_code: 'oic_nw', track_id: 'DECK_OIC_NW', license_term: 'year', amount_php: 499, status: 'paid', access_status: 'active', access_expires_at: '2027-11-25T00:00:00Z', payment_reference: null, proof_url: null, customer_note: null, customer_name: null, customer_company: null, customer_school: null, admin_note: null, created_at: '2026-11-25T00:00:00Z' }
          const orders = includeClaims ? [
            { ...order, id: '66666666-6666-4666-8666-666666666666', manual_claim_id: manualClaimId, payment_method: 'Manual QR Ph / InstaPay' },
            { ...order, id: '77777777-7777-4777-8777-777777777777', manual_claim_id: null, payment_method: 'PayMongo Checkout' },
          ] : []
          return { data: { orders, alerts: [], claims }, error: null }
        }
        if (request.body?.action === 'review-claim') {
          if (request.body.decision !== 'approve') return { data: { error: 'Fixture supports approval only.' }, error: null }
          localStorage.setItem('fixture-approved-claim','yes')
          return { data: { ok: true, status: 'approved' }, error: null }
        }
        if (request.body?.action === 'set-checkout-availability') {
          if (typeof request.body.enabled !== 'boolean') return { data: { error: 'Invalid checkout setting' }, error: { message: 'Invalid checkout setting' } }
          localStorage.setItem('fixture-checkout-enabled', request.body.enabled ? 'yes' : 'no')
          return { data: { enabled: request.body.enabled, updatedAt: new Date().toISOString() }, error: null }
        }
      }
      if (name === 'create-checkout' && request.body?.action === 'status') return { data: { action: 'status', enabled: true }, error: null }
      if (name === 'create-lifetime-checkout' && request.body?.action === 'status') {
        return {data:{enabled:localStorage.getItem('fixture-lifetime-enabled') === 'yes'},error:null}
      }
      if (name === 'create-lifetime-checkout' && request.body?.action === 'cancel') {
        localStorage.removeItem('fixture-lifetime-pending')
        return {data:{status:'cancelled',orderId:request.body?.orderId},error:null}
      }
      if (name === 'create-lifetime-checkout' && request.body?.action === 'create') {
        return {data:{error:'This synthetic fixture never initiates a real payment.'},error:null}
      }
      return { data: { entitlements: [] }, error: null }
    },
  },
}
