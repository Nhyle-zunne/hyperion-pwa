import { createPaymentPollingState, pendingPaymentCheckoutIds, startPaymentPolling } from '../lib/paymentPolling'
import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import AccountSectionTabs from '../components/AccountSectionTabs'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { LICENSE_TERMS, priceForTerm } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

type Order = {
  id: string
  product_code: string
  license_term: LicenseTerm
  amount_php: number
  status: string
  payment_reference: string | null
  payment_method: string | null
  customer_name: string | null
  customer_company: string | null
  customer_school: string | null
  created_at: string
  paid_at: string | null
  checkout_batch_id: string | null
}
type OwnedTrack = { product_code: string; order_id: string | null; license_term: LicenseTerm | null; status: string; granted_at: string; expires_at: string | null; renewed_at: string | null; source?: 'website' | 'google_play' }
type BasketItem = { code: PaidTrack; term: LicenseTerm }

// A raised desktop card needs to retain its collapsed grid-cell height.
// Reuse this for both hover and explicit See all actions so clicking never
// makes the card expand into the document or push Buy Now below the screen.
function prepareStoreCardLift(slot: HTMLElement) {
  if (slot.style.height) return
  const card = slot.querySelector<HTMLElement>('.account-product-card')
  if (!card) return
  const bounds = slot.getBoundingClientRect()
  slot.style.height = `${Math.ceil(card.getBoundingClientRect().height)}px`
  const sidebarRight = document.querySelector('.account-sidebar')?.getBoundingClientRect().right ?? 0
  const extra = Math.min(54, bounds.width * .24)
  slot.style.setProperty('--store-hover-left', `${Math.max(0, Math.min(extra, bounds.left - Math.max(12, sidebarRight + 10)))}px`)
  slot.style.setProperty('--store-hover-right', `${Math.max(0, Math.min(extra, window.innerWidth - bounds.right - 12))}px`)
}

function releaseStoreCardLift(slot: HTMLElement) {
  window.requestAnimationFrame(() => {
    if (slot.matches(':hover') || slot.classList.contains('is-expanded')) return
    slot.style.height = ''
    slot.style.removeProperty('--store-hover-left')
    slot.style.removeProperty('--store-hover-right')
  })
}

// Hold an exiting card in its absolute, bottom-anchored position until its
// geometry finishes animating. Switching straight back to normal layout made
// adjacent cards snap and could retrigger mouseenter/mouseleave mid-transition.
const storeCardSettleTimers = new WeakMap<HTMLElement, number>()
function cancelStoreCardSettle(slot: HTMLElement) {
  const timer = storeCardSettleTimers.get(slot)
  if (timer !== undefined) window.clearTimeout(timer)
  storeCardSettleTimers.delete(slot)
}
function beginStoreCardLift(slot: HTMLElement) {
  cancelStoreCardSettle(slot)
  prepareStoreCardLift(slot)
  slot.dataset.storeLift = 'entering'
  // Establish the original absolute geometry before React applies is-hovered,
  // so the horizontal expansion animates rather than instantly jumping.
  void slot.querySelector<HTMLElement>('.account-product-card')?.offsetWidth
}
function settleStoreCardLift(slot: HTMLElement, force = false) {
  cancelStoreCardSettle(slot)
  if (!force && slot.classList.contains('is-expanded')) {
    delete slot.dataset.storeLift
    return
  }
  slot.dataset.storeLift = 'settling'
  const timer = window.setTimeout(() => {
    storeCardSettleTimers.delete(slot)
    delete slot.dataset.storeLift
    releaseStoreCardLift(slot)
  }, 320)
  storeCardSettleTimers.set(slot, timer)
}

const STORE_FEATURES = [
  'Unlimited practice sessions',
  'Unlimited timed mock exams',
  'Full question bank for your licensed track',
  'Custom drills and question ranges',
  'Quick Scan Mode',
  'Mistakes Notebook and bookmarks',
  'Full-text question search',
  'Offline review after downloading',
  'Study history and cross-device progress sync'
] as const

const STORE_TRACK_CAPTIONS: Record<PaidTrack, string> = {
  oic_nw: 'DECK · OPERATIONAL',
  engine_ew: 'ENGINE · OPERATIONAL',
  gmdss: 'GMDSS · RADIO',
  deck_mgt: 'DECK · MANAGEMENT',
  engine_mgt: 'ENGINE · MANAGEMENT'
}

const STORE_CATEGORY_ICON: Record<PaidTrack, number> = {
  oic_nw: 1, engine_ew: 2, gmdss: 3, deck_mgt: 1, engine_mgt: 2
}
const STORE_LEVEL_ICON: Partial<Record<PaidTrack, number>> = {
  oic_nw: 4, engine_ew: 4, deck_mgt: 5, engine_mgt: 5
}
// Exact supplied Hyperion banner artwork, cropped into one local image sprite.
// Cells: anchor, deck helm, engine, GMDSS, operational shield, management cap.
function StoreBannerSymbol({ index, small = false }: { index: number; small?: boolean }) {
  const size = small ? 24 : 42
  return <span aria-hidden="true" className={`store-banner-symbol${small ? ' store-banner-symbol--small' : ''}`} style={{ backgroundPosition: `-${size * index}px 0px` }} />
}

function safeAccountError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (!message || /supabase|postgrest|postgres|sqlstate|provider credentials|redirect settings|edge function|row[- ]level security|\bpgrst\b|\bjwt\b|database schema|relation .* does not exist|violates .* constraint/i.test(message)) return fallback
  return message
}

function isMissingGooglePlayEntitlementsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false
  const candidate = error as { code?: unknown; message?: unknown }
  if (candidate.code !== 'PGRST205' || typeof candidate.message !== 'string') return false
  const message = candidate.message.toLowerCase()
  return message.includes('google_play_entitlements') && message.includes('schema cache')
}

async function edgeFunctionErrorMessage(error: unknown): Promise<string | null> {
  if (!error || typeof error !== 'object' || !('context' in error)) return null
  const context = (error as { context?: unknown }).context
  if (!(context instanceof Response)) return null
  try {
    const payload = await context.clone().json() as { error?: unknown }
    return typeof payload.error === 'string' && payload.error.trim() ? payload.error : null
  } catch {
    return null
  }
}
function licenseExpiryDetails(value: string | null, now = Date.now()) {
  if (!value) return { state: 'unknown' as const, label: 'Expiry date unavailable', daysRemaining: null as number | null }
  const expiresAt = Date.parse(value)
  if (!Number.isFinite(expiresAt)) return { state: 'unknown' as const, label: 'Expiry date unavailable', daysRemaining: null as number | null }
  if (expiresAt <= now) return { state: 'expired' as const, label: `Expired on ${new Date(expiresAt).toLocaleDateString()}`, daysRemaining: 0 }
  const hoursRemaining = Math.ceil((expiresAt - now) / (60 * 60 * 1000))
  const daysRemaining = Math.ceil(hoursRemaining / 24)
  const label = hoursRemaining < 24
    ? 'Expires in less than a day'
    : `Expires in ${daysRemaining} day${daysRemaining === 1 ? '' : 's'}`
  return { state: daysRemaining <= 7 ? 'soon' as const : 'active' as const, label, daysRemaining }
}
function isCurrentLicense(item: OwnedTrack, now = Date.now()) {
  const expiresAt = item.expires_at ? Date.parse(item.expires_at) : 0
  return item.status === 'active' && Number.isFinite(expiresAt) && expiresAt > now
}
export default function AccountScreen({ children }: { children?: React.ReactNode }) {
  const isLayout = children !== undefined
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const [accountTab, setAccountTab] = useState<'licenses' | 'payments' | 'delete'>(() => params.get('tab') === 'licenses' ? 'licenses' : params.get('tab') === 'delete' ? 'delete' : 'payments')
  useEffect(() => { setAccountTab(params.get('tab') === 'licenses' ? 'licenses' : params.get('tab') === 'delete' ? 'delete' : 'payments') }, [params])
  const [session, setSession] = useState<Session | null>(null)
  const [basket, setBasket] = useState<BasketItem[]>(() => {
    try {
      const raw = localStorage.getItem('hyperion-account-basket-v1')
      const saved: unknown = raw ? JSON.parse(raw) : []
      if (!Array.isArray(saved)) return []
      const normalized: BasketItem[] = saved.flatMap((entry: unknown) => {
        if (typeof entry === 'string' && PAID_PRODUCTS.some(item => item.code === entry)) {
          return [{ code: entry as PaidTrack, term: 'year' as const }]
        }
        if (!entry || typeof entry !== 'object') return []
        const item = entry as { code?: unknown; term?: unknown }
        if (typeof item.code !== 'string' || !PAID_PRODUCTS.some(product => product.code === item.code)) return []
        const term: LicenseTerm = item.term === 'week' || item.term === 'month' || item.term === 'year' ? item.term : 'year'
        return [{ code: item.code as PaidTrack, term }]
      })
      return [...new Map(normalized.map(item => [item.code, item] as const)).values()]
    } catch {
      return []
    }
  })
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [school, setSchool] = useState('')
  const [profileEditing, setProfileEditing] = useState(false)
  const [profileExpanded, setProfileExpanded] = useState(false)
  const [savedProfile, setSavedProfile] = useState({ fullName: '', company: '', school: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [deletionSuccess, setDeletionSuccess] = useState(false)
  const [signedOutSuccess, setSignedOutSuccess] = useState(false)
  const [successClosing, setSuccessClosing] = useState(false)
  const keepSuccessBackdropRef = useRef(false)
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [owned, setOwned] = useState<OwnedTrack[]>([])
  const [inactiveLicenses, setInactiveLicenses] = useState<OwnedTrack[]>([])
  const [renewalGraceUntil, setRenewalGraceUntil] = useState<string | null>(null)
  const [selectedTerms, setSelectedTerms] = useState<Record<PaidTrack, LicenseTerm>>(() => Object.fromEntries(PAID_PRODUCTS.map(item => [item.code, basket.find(entry => entry.code === item.code)?.term ?? 'year'])) as Record<PaidTrack, LicenseTerm>)
  const [expandedStorePerks, setExpandedStorePerks] = useState<PaidTrack | null>(null)
  const [hoveredStore, setHoveredStore] = useState<PaidTrack | null>(null)
  const [orders, setOrders] = useState<Order[]>([])
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)
  const entitlementExpiryRevision = useLicenseStore(s => s.entitlementExpiryRevision)

  useEffect(() => {
    // Checkout owns cart persistence when this screen supplies only the profile layout.
    if (isLayout) return
    try {
      if (basket.length) localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(basket))
      else localStorage.removeItem('hyperion-account-basket-v1')
    } catch { /* basket remains available for this page session */ }
  }, [basket, isLayout])

  const buyNow = (code: PaidTrack, term: LicenseTerm) => {
    const nextItem: BasketItem = { code, term }
    const nextBasket = basket.some(item => item.code === code)
      ? basket.map(item => item.code === code ? nextItem : item)
      : [...basket, nextItem]
    try {
      if (nextBasket.length) localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(nextBasket))
    } catch { /* Keep this purchase selection in memory for the current page. */ }
    setBasket(nextBasket)
    navigate('/checkout')
  }
  const clearBasketItems = (codes: string[]) => setBasket(current => current.filter(item => !codes.includes(item.code)))

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      // Keep the page the user acted on mounted behind the success dialog until Continue is pressed.
      if (nextSession || !keepSuccessBackdropRef.current) setSession(nextSession)
    })
    return () => listener.subscription.unsubscribe()
  }, [])


  useEffect(() => {
    const metadata = session?.user.user_metadata ?? {}
    const identityNames = (session?.user.identities ?? [])
      .filter(identity => identity.provider === 'google')
      .map(identity => {
        const data = identity.identity_data as Record<string, unknown> | null
        return data?.full_name ?? data?.name
      })
    const metadataGivenName = [metadata.given_name, metadata.family_name]
      .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
      .join(' ')
    const emailName = (session?.user.email?.split('@')[0] ?? '')
      .replace(/[._+-]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\b\w/g, letter => letter.toUpperCase())
    const nameCandidate = [
      metadata.full_name,
      metadata.name,
      metadataGivenName,
      ...identityNames,
      emailName,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    const resolvedFullName = nameCandidate?.trim() ?? ''
    const resolvedCompany = typeof metadata.company === 'string' ? metadata.company : ''
    const resolvedSchool = typeof metadata.school === 'string' ? metadata.school : ''
    setFullName(resolvedFullName)
    setCompany(resolvedCompany)
    setSchool(resolvedSchool)
    setSavedProfile({ fullName: resolvedFullName, company: resolvedCompany, school: resolvedSchool })
    setProfileEditing(false)
  }, [session?.user.id])
  useEffect(() => {
    if (!supabase || !session) { setIsAdmin(false); return }
    let active = true
    void supabase.functions.invoke('admin-payment-review', { body: { action: 'check-admin' } })
      .then(({ data, error }) => { if (active) setIsAdmin(!error && data?.isAdmin === true) })
      .catch(() => { if (active) setIsAdmin(false) })
    return () => { active = false }
  }, [session?.user.id])
  const saveProfile = async () => withPageLoading('Saving profile', async () => {
    if (!supabase || !session) return
    if (!fullName.trim()) { setMessage('Please enter your full name.'); return }
    setBusy(true); setMessage('Saving your profile…')
    try {
      const { data, error } = await supabase.auth.updateUser({ data: { full_name: fullName.trim(), company: company.trim(), school: school.trim() } })
      if (error) throw error
      if (data.user) setSession(current => current ? { ...current, user: data.user! } : current)
      setSavedProfile({ fullName: fullName.trim(), company: company.trim(), school: school.trim() })
      setProfileEditing(false)
      setMessage('Your profile has been saved.')
    } catch { setMessage('Unable to save profile details. Please try again.') }
    finally { setBusy(false) }
  })
  const refreshAccount = async (quiet = false, refreshEntitlements = true) => {
    if (isLayout) return
    const loadAccount = async () => {
    if (!supabase || !session?.user.id) { setOwned([]); setInactiveLicenses([]); setOrders([]); setRenewalGraceUntil(null); return }
    const orderColumns = 'id,product_code,license_term,amount_php,status,payment_reference,payment_method,customer_name,customer_company,customer_school,created_at,paid_at,checkout_batch_id'
    const [entitlements, playEntitlements, orderResult] = await Promise.all([
      supabase.from('entitlements')
        .select('product_code,order_id,license_term,status,granted_at,expires_at,renewed_at')
        .eq('user_id', session.user.id),
      supabase.from('google_play_entitlements')
        .select('product_code,status,granted_at,expires_at,updated_at')
        .eq('user_id', session.user.id),
      supabase.from('orders')
        .select(orderColumns)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    // The Google Play table is optional until its backend migration is released.
    // Ignore only PostgREST's exact missing-table/schema-cache response.
    const playTableMissing = isMissingGooglePlayEntitlementsTable(playEntitlements.error)
    const entitlementError = entitlements.error || (playTableMissing ? null : playEntitlements.error)
    const mergeNow = Date.now()
    const fetchedEntitlements: OwnedTrack[] = [
      ...((entitlements.data ?? []) as Omit<OwnedTrack, 'source'>[]).map(row => ({ ...row, source: 'website' as const })),
      ...((playTableMissing ? [] : (playEntitlements.data ?? [])).map(row => ({
        product_code: row.product_code,
        order_id: null,
        license_term: null,
        status: row.status,
        granted_at: row.granted_at,
        expires_at: row.expires_at,
        renewed_at: row.updated_at,
        source: 'google_play' as const,
      })))
    ]
    // Preserve the last known license display during network outages, then re-evaluate expiry locally.
    const entitlementRows = !entitlementError
      ? Array.from(fetchedEntitlements.reduce((map, row) => {
          const previous = map.get(row.product_code)
          if (!previous) {
            map.set(row.product_code, row)
            return map
          }
          const rowIsCurrent = isCurrentLicense(row, mergeNow)
          const previousIsCurrent = isCurrentLicense(previous, mergeNow)
          if ((rowIsCurrent && !previousIsCurrent) ||
              (rowIsCurrent === previousIsCurrent && Date.parse(row.expires_at || '') > Date.parse(previous.expires_at || ''))) {
            map.set(row.product_code, row)
          }
          return map
        }, new Map<string, OwnedTrack>()).values())
      : [...owned, ...inactiveLicenses]
    const now = Date.now()
    const activeLicenses = entitlementRows.filter(item => isCurrentLicense(item, now))
    const pastLicenses = entitlementRows
      .filter(item => !isCurrentLicense(item, now))
      .sort((a, b) => Date.parse(b.expires_at || '') - Date.parse(a.expires_at || ''))
    const latestExpiredAt = entitlementRows.reduce((latest, item) => {
      if (item.status === 'revoked') return latest
      const expiry = item.expires_at ? Date.parse(item.expires_at) : 0
      return Number.isFinite(expiry) && expiry > 0 && expiry <= now ? Math.max(latest, expiry) : latest
    }, 0)
    const graceUntil = latestExpiredAt + 30 * 24 * 60 * 60 * 1000
    setRenewalGraceUntil(activeLicenses.length === 0 && latestExpiredAt > 0 && graceUntil > now ? new Date(graceUntil).toISOString() : null)
    setOwned(activeLicenses)
    setInactiveLicenses(pastLicenses)
    if (entitlementError) {
      setMessage('Unable to refresh account details. Please try again.')
    }

    let linkedOrders: Order[] = []
    const linkedOrderIds = [...new Set(entitlementRows.map(item => item.order_id).filter(Boolean))]
    if (linkedOrderIds.length > 0) {
      const { data, error } = await supabase.from('orders').select(orderColumns).in('id', linkedOrderIds)
      if (error) setMessage('Unable to refresh license transaction details. Please try again.')
      else linkedOrders = (data ?? []) as Order[]
    }

    if (orderResult.error) setMessage('Unable to refresh payment history. Please try again.')
    const recentOrders = (orderResult.data ?? []) as Order[]
    const combinedOrders = [...recentOrders, ...linkedOrders.filter(linked => !recentOrders.some(recent => recent.id === linked.id))]
    combinedOrders.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    setOrders(combinedOrders)
    if (refreshEntitlements) await refreshCloudEntitlements()
    }
    return quiet ? loadAccount() : withPageLoading('Loading account and licenses', loadAccount)
  }
  useEffect(() => { void refreshAccount() }, [session?.user.id, isLayout])
  useEffect(() => {
    if (entitlementExpiryRevision > 0) void refreshAccount(true, false)
  }, [entitlementExpiryRevision, isLayout])

  // A checkout return triggers direct server-to-PayMongo verification. The return URL
  // itself grants nothing; only a paid session checked by the server or signed webhook can activate a license.
  useEffect(() => {
    if (isLayout) return
    const paymentState = params.get('payment')
    const orderId = params.get('order_id')
    if (!session) return
    if (!paymentState) return
    let cancelled = false

    if (paymentState === 'cancelled') {
      setMessage('PayMongo returned you to Hyperion. Cancelling a hosted checkout does not close the payment session automatically. Use CANCEL CHECKOUT below before switching to manual payment.')
      void refreshAccount()
      return () => { cancelled = true }
    }
    if (paymentState !== 'success') return

    setMessage('Returned from PayMongo. Verifying your payment with Hyperion…')
    const checkPayment = async () => {
      if (!supabase || !orderId) {
        await refreshAccount()
        if (!cancelled) setMessage('Your checkout return was received, but we could not verify an order from this link. Check Active licenses or refresh your order status.')
        return
      }

      let lastVerificationMessage = ''
      for (let attempt = 0; attempt < 6; attempt++) {
        const { data, error } = await supabase.functions.invoke('verify-checkout', { body: { orderId } })
        if (cancelled) return
        if (!error && data?.status === 'paid') {
          const paidCodes: string[] = Array.isArray(data.productCodes)
            ? data.productCodes
            : typeof data.productCode === 'string' ? [data.productCode] : []
          clearBasketItems(paidCodes)
          await refreshAccount()
          const purchased = paidCodes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code)
          if (!cancelled) setMessage(`Payment confirmed. Activated: ${purchased.join(', ')}. No manual approval is needed.`)
          return
        }
        if (error) lastVerificationMessage = (await edgeFunctionErrorMessage(error)) || 'PayMongo verification is temporarily unavailable.'
        else if (typeof data?.error === 'string') lastVerificationMessage = data.error
        else if (data?.status === 'pending') lastVerificationMessage = data.message || 'PayMongo has not confirmed a successful payment yet.'
        if (attempt < 5) await new Promise(resolve => window.setTimeout(resolve, 1800))
      }

      await refreshAccount()
      if (!cancelled) setMessage(`${lastVerificationMessage || 'Payment is still awaiting PayMongo confirmation.'} Hyperion will activate only the track attached to this paid order. Do not pay again. Use Refresh status to check again.`)
    }
    void checkPayment()
    return () => { cancelled = true }
  }, [session?.user.id, params, isLayout])
  const signInWithGoogle = async () => {
    if (!supabase) {
      setMessage('Sign-in is temporarily unavailable. Please try again later.')
      return
    }

    const requestedReturnTo = window.location.pathname + window.location.search + window.location.hash
    const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/'
    try {
      localStorage.setItem('hyperion-oauth-return-to', JSON.stringify({
        path: returnTo,
        startedAt: Date.now(),
        mode: 'redirect',
      }))
    } catch {
      // The callback will fall back to the dashboard if browser storage is unavailable.
    }

    setBusy(true)
    setMessage('')
    try {
      // Let Supabase navigate this same tab to Google, then back to our callback.
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://hyperionmaritime.org/auth/callback',
          // Always show Google's account chooser instead of silently reusing the last account.
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) throw error
    } catch {
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      setMessage('Sign-in could not be completed. Please try again.')
      setBusy(false)
    }
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', marginBottom: '1rem', borderRadius: 10 }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', minHeight: 40, padding: '.45rem .55rem', marginTop: '.25rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit', fontSize: '.85rem' }
  const profileField = (editable: boolean): React.CSSProperties => ({ ...field, background: editable ? 'var(--bg-elevated)' : 'var(--bg)', color: editable ? 'var(--text)' : 'var(--text-muted)', border: editable ? '1px solid var(--border)' : '1px solid #cbd5e1', boxShadow: 'none', outline: 'none', cursor: editable ? 'text' : 'default', userSelect: editable ? 'text' : 'none', WebkitUserSelect: editable ? 'text' : 'none', pointerEvents: editable ? 'auto' : 'none', caretColor: editable ? 'auto' : 'transparent' })
  const label: React.CSSProperties = { display: 'block', marginTop: '.5rem', fontSize: '.8rem', lineHeight: 1.35 }
  const pendingPayMongoOrders = orders.filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
  const pendingCheckoutIds = pendingPaymentCheckoutIds(orders)
  const paymentPolling = useRef<{ userId: string; state: ReturnType<typeof createPaymentPollingState> } | null>(null)

  // Keep checking pending PayMongo sessions while the user is in their account.
  // The signed webhook remains primary; this server-side verification is the automatic fallback.
  useEffect(() => {
    if (isLayout) return
    const client = supabase
    if (!session?.user.id) { paymentPolling.current = null; return }
    if (!client || !pendingCheckoutIds) return
    if (paymentPolling.current?.userId !== session.user.id) {
      paymentPolling.current = { userId: session.user.id, state: createPaymentPollingState() }
    }
    let active = true
    let checking = false
    const checkPending = async (isCurrent: () => boolean) => {
      if (checking) return
      checking = true
      try {
        const activated: string[] = []
        for (const orderId of pendingPaymentCheckoutIds(orders).split(',').filter(Boolean)) {
          if (!active) return
          if (!isCurrent()) break
          const { data, error } = await client.functions.invoke('verify-checkout', { body: { orderId } })
          if (!active) return
          if (error || data?.status !== 'paid') continue
          const codes: string[] = Array.isArray(data.productCodes)
            ? data.productCodes
            : typeof data.productCode === 'string' ? [data.productCode] : []
          activated.push(...codes)
        }
        if (active && activated.length) {
          const uniqueCodes = [...new Set(activated)]
          const labels = uniqueCodes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code)
          setMessage(`Payment confirmed automatically. Activated: ${labels.join(', ')}.`)
          clearBasketItems(uniqueCodes)
          await refreshAccount()
        }
      } catch {
        // A transient network or provider issue is retried with bounded backoff.
      } finally {
        checking = false
      }
    }
    const stop = startPaymentPolling(checkPending, { state: paymentPolling.current.state })
    return () => { active = false; stop() }
  }, [session?.user.id, pendingCheckoutIds, isLayout])

  const signOut = async () => withPageLoading('Signing out', async () => {
    if (!supabase) {
      setMessage('Sign-out is temporarily unavailable. Please try again.')
      return
    }
    setBusy(true)
    try {
      keepSuccessBackdropRef.current = true
      const { error } = await supabase.auth.signOut()
      if (error) throw error
      // Clear the device-bound offline grant only for an intentional user sign-out.
      useLicenseStore.getState().clearLicense()
      setMessage('')
      setSuccessClosing(false)
      setSignedOutSuccess(true)
    } catch {
      keepSuccessBackdropRef.current = false
      setMessage('Unable to sign out. Please check your connection and try again.')
    } finally {
      setBusy(false)
    }
  })
  const closeSuccessModal = () => {
    setSuccessClosing(true)
    window.setTimeout(() => {
      keepSuccessBackdropRef.current = false
      setSession(null)
      setOwned([])
      setOrders([])
      setSignedOutSuccess(false)
      setDeletionSuccess(false)
      setSuccessClosing(false)
      navigate('/account', { replace: true })
    }, 220)
  }

  const deleteAccount = async () => withPageLoading('Deleting account', async () => {
    if (!supabase || !session || deleteConfirmation !== 'DELETE') return
    setBusy(true)
    setMessage('Deleting your account and associated account data…')
    try {
      keepSuccessBackdropRef.current = true
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation: 'DELETE' } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (data?.success !== true) throw new Error('Account deletion could not be confirmed. Please try again or contact support.')
      useLicenseStore.getState().clearLicense()
      await supabase.auth.signOut()
      setDeleteConfirmOpen(false)
      setDeleteConfirmation('')
      setMessage('')
      setSuccessClosing(false)
      setDeletionSuccess(true)
    } catch (error) {
      keepSuccessBackdropRef.current = false
      setMessage(safeAccountError(error, 'Unable to delete your account. Please try again or contact support.'))
    } finally {
      setBusy(false)
    }
  })




  return <div className="screen account-page" style={{ width: isLayout ? 'min(calc(100% - 2rem), 1320px)' : 'min(calc(100% - 2rem), 1540px)', maxWidth: isLayout ? 1320 : 1540, margin: '0 auto', paddingTop: '.75rem', paddingBottom: '2rem' }}>
    <style>{`
      .account-page .account-layout{display:grid;grid-template-columns:minmax(230px,19%) minmax(0,1fr);gap:clamp(.75rem,1.1vw,1rem);align-items:start}
      .account-page > [role="status"] + .account-layout{margin-top:1.1rem}
      .account-page .account-sidebar{display:grid;gap:1rem;align-content:start;position:sticky;top:80px;min-width:0;align-self:start}
      .account-page .account-main{min-width:0}
      .account-page .account-main > .screen{width:100%!important;max-width:none!important;margin:0!important;padding:0!important}
      @media(max-width:1180px){.account-page .basket-page .basket-layout{grid-template-columns:minmax(0,1fr)}.account-page .basket-page .basket-summary{position:static}}
      .account-page .account-section-tabs{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;min-width:0}
      .account-page .account-section-tabs button{min-height:48px;padding:.7rem 1rem;font-weight:850;font-size:.9rem;border-radius:9px;white-space:nowrap}
      .account-page .account-section-tabs button[aria-selected="true"]{background:#147d43;border-color:#147d43;color:#fff}
      .account-page .account-toolbar-actions{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}
      .account-page .account-toolbar-actions button{min-height:42px}
      .account-page .account-products-grid{display:grid;grid-template-columns:repeat(5,minmax(0,1fr));width:100%;gap:clamp(.55rem,.75vw,.9rem);isolation:isolate;align-items:start}
      .account-page .account-product-slot{min-width:0;position:relative;z-index:0}
      .account-page .account-product-slot.is-hovered,.account-page .account-product-slot.is-expanded{z-index:8}
      .account-page .account-product-slot[data-store-lift="settling"]{z-index:1;pointer-events:none}
      .account-page .account-product-card{position:relative;z-index:0;min-width:0;display:flex;flex-direction:column;padding:clamp(.58rem,.8vw,.8rem);border:1px solid var(--border);border-radius:13px;background:var(--bg-card);transition:left .26s cubic-bezier(.2,.8,.2,1),right .26s cubic-bezier(.2,.8,.2,1),transform .26s cubic-bezier(.2,.8,.2,1),border-color .26s ease,box-shadow .26s ease;transform-origin:50% 100%;will-change:transform;box-sizing:border-box}
      .account-page .account-product-card:focus-within{z-index:5;border-color:#d9ad36;box-shadow:0 14px 30px rgba(4,35,83,.13)}
      .account-page .account-product-card .product-art{min-height:58px;display:flex;align-items:center;gap:.5rem;padding:.45rem .55rem;border-radius:9px;background:radial-gradient(circle at 95% 0%,#17497d 0,transparent 45%),linear-gradient(125deg,#042353,#061a3b);color:#f6c84a;margin-bottom:.6rem;position:relative;overflow:hidden;border:1px solid rgba(241,195,70,.5)}
      .account-page .account-product-card .product-art:before{content:"";position:absolute;inset:0;border-top:2px solid #f3c452;pointer-events:none}
      .account-page .account-product-card .product-art:after{content:"";position:absolute;width:96px;height:96px;border:1px solid rgba(244,191,51,.25);border-radius:50%;right:-37px;top:-51px;pointer-events:none}
      .account-page .store-banner-symbol{position:relative;z-index:1;display:block;flex:0 0 42px;width:42px;height:42px;background-image:url('/store-art/hyperion-banner-sprite.png');background-repeat:no-repeat;background-size:252px 42px}
      .account-page .store-banner-symbol--small{flex-basis:24px;width:24px;height:24px;background-size:144px 24px}
      .account-page .store-banner-text{position:relative;z-index:1;min-width:0;flex:1;display:grid;gap:.15rem}
      .account-page .store-banner-text strong{display:block;color:#ffcf55;font-size:.73rem;line-height:1.1;font-weight:950;letter-spacing:.045em}
      .account-page .store-banner-text small{color:#f8e6a7;font-size:.52rem;font-weight:800;letter-spacing:.02em;line-height:1.2}
      .account-page .store-banner-track{position:relative;z-index:1;display:flex;align-items:center;gap:0;flex-shrink:0}
      .account-page .product-price{font-size:clamp(1.2rem,1.4vw,1.48rem);font-weight:950;line-height:1.1;color:var(--text);margin:.4rem 0 .55rem}
      .account-page .store-feature-highlight{font-size:.7rem;font-weight:850;letter-spacing:.02em;color:#b4871b;margin:.15rem 0 .2rem}
      .account-page .store-benefits-list{display:grid;gap:.14rem;list-style:none;padding:0;margin:.3rem 0 .1rem;max-height:3.55rem;overflow:hidden;transition:max-height .3s cubic-bezier(.2,.8,.2,1)}
      .account-page .store-benefits-list li{display:flex;gap:.3rem;align-items:flex-start;line-height:1.25;font-size:.66rem;color:var(--text-muted);overflow-wrap:anywhere}
      .account-page .store-benefits-list li:before{content:"✓";color:#b68714;font-weight:900;flex-shrink:0}
      .account-page .account-product-card.perks-expanded .store-benefits-list{max-height:18rem}
      .account-page .store-benefits-toggle{margin:.15rem 0 .5rem;padding:.15rem 0;border:0;text-align:left;background:none;color:var(--accent);font:inherit;font-size:.67rem;font-weight:850;line-height:1.3;cursor:pointer;align-self:flex-start}
      .account-page .store-benefits-toggle:hover{text-decoration:underline}
      .account-page .store-benefits-toggle:focus-visible{outline:2px solid var(--accent);outline-offset:3px;border-radius:3px}
      .account-page .product-status{display:inline-flex;align-self:flex-start;border-radius:999px;background:var(--bg-elevated);border:1px solid var(--border);padding:.25rem .45rem;font-size:.61rem;font-weight:850;letter-spacing:.01em;margin-top:auto;line-height:1.3;max-width:100%}
      @media (hover:hover) and (pointer:fine){
        .account-page .account-product-slot[data-store-lift="entering"] .account-product-card,
        .account-page .account-product-slot.is-hovered .account-product-card,
        .account-page .account-product-slot.is-expanded .account-product-card,
        .account-page .account-product-slot[data-store-lift="settling"] .account-product-card{position:absolute;bottom:0;left:0;right:0}
        .account-page .account-product-slot.is-hovered:not([data-store-lift="settling"]) .account-product-card,
        .account-page .account-product-slot.is-expanded:not([data-store-lift="settling"]) .account-product-card{left:calc(-1 * var(--store-hover-left,0px));right:calc(-1 * var(--store-hover-right,0px));z-index:9;border-color:#e7bc41;box-shadow:0 20px 42px rgba(4,35,83,.24),0 0 0 1px rgba(243,195,67,.28);transform:translateY(-3px) scale(1.035);transform-origin:50% 100%;background:var(--bg-card)}
      }
      @media(prefers-reduced-motion:reduce){
        .account-page .account-product-card,.account-page .store-benefits-list{transition:none}
        .account-page .account-product-slot.is-hovered .account-product-card,.account-page .account-product-slot.is-expanded .account-product-card{transform:none}
      }
      .account-page .account-panel-title{display:flex;align-items:center;justify-content:space-between;gap:.6rem;flex-wrap:wrap;margin-bottom:.7rem}
      .account-page .account-cart-row{display:flex;align-items:center;justify-content:space-between;gap:.8rem;border-bottom:1px solid var(--border);padding:.75rem 0}
      .account-page .account-cart-row:last-child{border-bottom:0}
      .account-page .account-total-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-top:1rem;margin-top:.4rem;border-top:1px solid var(--border)}
      .account-page .profile-avatar{width:44px;height:44px;flex-shrink:0;display:grid;place-items:center;border-radius:12px;background:#042353;color:#4ade80;font-weight:950;font-size:.95rem;letter-spacing:.03em}
      .account-page .profile-mobile-toggle{display:none;width:100%;min-height:44px;box-sizing:border-box;margin-bottom:.6rem;border:1px solid var(--border);border-radius:9px;background:var(--bg-elevated);color:var(--text);padding:.65rem .8rem;font-size:.8rem;font-weight:850;align-items:center;justify-content:space-between;gap:.6rem;cursor:pointer}
      .account-page .profile-mobile-toggle:focus-visible{outline:3px solid var(--accent);outline-offset:3px}
      .account-page .profile-mobile-toggle svg{flex-shrink:0;transition:transform .18s ease}
      .account-page .profile-mobile-toggle[aria-expanded="true"] svg{transform:rotate(180deg)}
      @media(prefers-reduced-motion:reduce){.account-page .profile-mobile-toggle svg{transition:none}}
      .account-page .account-profile-content{display:block}
      .account-page .account-section-tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1rem}
      .account-page .account-section-tabs button{min-height:48px;padding:.75rem 1rem;font-weight:850;border-radius:9px}
      .account-page .profile-side-links{font-size:.76rem;color:var(--text-muted);line-height:1.4}
      .account-cart-fab{position:fixed;right:max(1.25rem,env(safe-area-inset-right));bottom:max(1.25rem,env(safe-area-inset-bottom));z-index:160;display:grid;place-items:center;width:56px;height:56px;padding:0;border:2px solid #e2e8f0;border-radius:50%;background:#fff;color:#147d43;line-height:1;box-shadow:0 8px 24px rgba(4,35,83,.24);cursor:pointer;touch-action:manipulation;transition:box-shadow .2s ease}
      [data-theme='dark'] .account-cart-fab{background:#147d43;border-color:#147d43;color:#fff}
      .account-cart-fab:focus-visible{outline:3px solid var(--text);outline-offset:4px}
      body:has([aria-modal="true"]) .account-cart-fab{display:none}
      .account-cart-icon{display:block;width:28px;height:28px;transform-origin:50% 75%}
      @keyframes account-cart-wiggle{0%,18%,100%{transform:rotate(0)}3%{transform:translateX(-2px) rotate(-12deg)}6%{transform:translateX(2px) rotate(10deg)}9%{transform:translateX(-1px) rotate(-7deg)}12%{transform:rotate(4deg)}15%{transform:rotate(-2deg)}}
      @media(prefers-reduced-motion:no-preference){.account-cart-icon{animation:account-cart-wiggle 8s ease-in-out .6s infinite}}
      @media(hover:hover){.account-cart-fab:hover{box-shadow:0 12px 28px rgba(4,35,83,.3)}}
      @media(prefers-reduced-motion:reduce){.account-cart-fab{transition:none}}
      @media(max-width:899px){.account-cart-fab{bottom:calc(82px + env(safe-area-inset-bottom))}}
      .account-page .payment-method-pills{display:flex;flex-wrap:wrap;gap:.4rem}
      .account-page .payment-method-pills span{padding:.3rem .5rem;border:1px solid var(--border);background:var(--bg-elevated);border-radius:6px;font-size:.7rem;font-weight:750}
      @media(max-width:1279px){.account-page .account-products-grid{grid-template-columns:repeat(3,minmax(0,1fr))}}
      @media(max-width:950px){.account-page .account-products-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:800px){.account-page .account-layout{grid-template-columns:minmax(0,1fr)}.account-page .account-sidebar{position:static;grid-template-columns:minmax(0,1fr)}.account-page .account-profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 .8rem}.account-page .account-toolbar-actions{display:flex;justify-content:flex-end}.account-page .profile-mobile-toggle{display:inline-flex}.account-page .account-profile-content{display:none}.account-page .account-profile-content.is-expanded{display:block}.account-page .account-section-tabs{display:grid;grid-template-columns:1fr;gap:.45rem}.account-page .account-section-tabs button{text-align:left}}
      @media(max-width:520px){.account-page .account-products-grid{grid-template-columns:minmax(0,1fr)}.account-page .account-profile-fields{grid-template-columns:minmax(0,1fr)}.account-page .account-product-card .product-art{min-height:64px}.account-page .account-cart-row{align-items:flex-start}}
      /* Checkout is a focused mobile purchase flow, not the profile overview. */
      @media(max-width:800px){
        .account-page:has(.basket-page) .account-layout{grid-template-columns:minmax(0,1fr);gap:0}
        .account-page:has(.basket-page) .account-sidebar{display:none}
        .account-page:has(.basket-page){padding-top:.3rem!important}
      }

      .account-page .account-success-backdrop{position:fixed;inset:0;z-index:10000;display:grid;place-items:center;padding:1rem;box-sizing:border-box;background:radial-gradient(ellipse at 50% 36%,rgba(34,197,94,.13),transparent 48%),linear-gradient(135deg,rgba(4,15,35,.94),rgba(8,20,39,.92));backdrop-filter:blur(12px) saturate(125%);-webkit-backdrop-filter:blur(12px) saturate(125%);animation:hyperion-backdrop-enter 260ms ease-out both}
      .account-page .account-success-card{position:relative;overflow:hidden;border-radius:20px!important;border-color:rgba(148,163,184,.28)!important;box-shadow:0 30px 90px rgba(0,0,0,.42),0 0 0 1px rgba(255,255,255,.035)!important;animation:hyperion-success-card-enter 380ms cubic-bezier(.18,.89,.32,1.12) both}
      .account-page .account-success-card:before{content:"";position:absolute;top:0;left:0;right:0;height:4px;background:linear-gradient(90deg,#15803d,#4ade80,#15803d)}
      .account-page .account-success-check{animation:hyperion-success-check-enter 440ms cubic-bezier(.18,.89,.32,1.28) 80ms both}
      .account-page .account-success-backdrop--closing{animation:hyperion-backdrop-exit 220ms ease-in both}
      .account-page .account-success-backdrop--closing .account-success-card{animation:hyperion-success-card-exit 190ms ease-in both}
      @keyframes hyperion-backdrop-enter{from{opacity:0}to{opacity:1}}
      @keyframes hyperion-backdrop-exit{from{opacity:1}to{opacity:0}}
      @keyframes hyperion-success-card-enter{from{opacity:0;transform:translateY(16px) scale(.955);filter:blur(3px)}to{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}}
      @keyframes hyperion-success-card-exit{from{opacity:1;transform:translateY(0) scale(1);filter:blur(0)}to{opacity:0;transform:translateY(8px) scale(.98);filter:blur(2px)}}
      @keyframes hyperion-success-check-enter{from{opacity:0;transform:scale(.55)}to{opacity:1;transform:scale(1)}}
      @media(prefers-reduced-motion:reduce){.account-page .account-success-backdrop,.account-page .account-success-card,.account-page .account-success-check{animation-duration:.01ms!important;animation-delay:0ms!important}.account-page .account-success-backdrop--closing{animation-duration:.01ms!important}.account-page .account-success-backdrop--closing .account-success-card{animation-duration:.01ms!important}}
    `}</style>

    {signedOutSuccess && <div
      role="presentation"
      className={`account-success-backdrop${successClosing ? ' account-success-backdrop--closing' : ''}`}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="sign-out-success-title"
        className="account-success-card"
        style={{ width: 'min(100%, 440px)', boxSizing: 'border-box', padding: '1.65rem', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', textAlign: 'center' }}
      >
        <div className="account-success-check" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, margin: '0 auto .9rem', borderRadius: '50%', background: 'rgba(20,125,67,.14)', color: '#16834a', fontSize: '2rem', fontWeight: 900 }}>✓</div>
        <h2 id="sign-out-success-title" style={{ margin: '0 0 .6rem' }}>Signed out successfully</h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 1.25rem' }}>You have been signed out of your Hyperion account.</p>
        <button type="button" className="btn btn-primary" autoFocus onClick={closeSuccessModal} style={{ width: '100%', minHeight: 46 }}>Continue</button>
      </section>
    </div>}

    {deletionSuccess && <div
      role="presentation"
      className={`account-success-backdrop${successClosing ? ' account-success-backdrop--closing' : ''}`}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-deletion-success-title"
        className="account-success-card"
        style={{ width: 'min(100%, 440px)', boxSizing: 'border-box', padding: '1.65rem', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', textAlign: 'center' }}
      >
        <div className="account-success-check" aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 58, height: 58, margin: '0 auto .9rem', borderRadius: '50%', background: 'rgba(20,125,67,.14)', color: '#16834a', fontSize: '2rem', fontWeight: 900 }}>✓</div>
        <h2 id="account-deletion-success-title" style={{ margin: '0 0 .6rem' }}>Account deletion successful</h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 1rem' }}>Your Hyperion account has been deleted successfully.</p>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 1.25rem' }}>You can now sign in again and choose any Google account.</p>
        <button type="button" className="btn btn-primary" autoFocus onClick={closeSuccessModal} style={{ width: '100%', minHeight: 46 }}>Continue</button>
      </section>
    </div>}

    <>
      {session && message && <div role="status" style={{ ...card, lineHeight: 1.5, marginTop: '.8rem', marginBottom: 0 }}>{message}</div>}
      {session && renewalGraceUntil && <div role="status" style={{ ...card, lineHeight: 1.55, marginTop: '.8rem', marginBottom: 0, borderColor: 'var(--warning, #c2410c)' }}>
        <strong style={{ display: 'block', marginBottom: '.25rem' }}>Your license has expired</strong>
        Paid-track access ended at expiry. Your account is in its 30-day retention grace period until <strong>{new Date(renewalGraceUntil).toLocaleDateString()}</strong>, giving you time to purchase an eligible website license. This is an account-retention safeguard, not extra paid access. Account deletion is considered only after the separate inactivity and grace requirements are met.
        <button type="button" className="btn btn-primary" style={{ width: '100%', marginTop: '.65rem' }} onClick={() => setAccountTab('payments')}>View available licenses</button>
      </div>}

      <div className="account-layout">
        <aside className="account-sidebar">
          {session && <section style={{ ...card, padding: '.8rem', marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: '.6rem', alignItems: 'center', marginBottom: '.6rem' }}>
              <div className="profile-avatar">{(fullName || 'H').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: '1rem', overflowWrap: 'anywhere' }}>{fullName || 'Hyperion Member'}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', overflowWrap: 'anywhere', marginTop: '.2rem' }}>{session.user.email}</div>
                {isAdmin && <button type="button" title="Open admin dashboard" aria-label="Admin" onClick={() => navigate('/admin/licenses')} style={{ display: 'inline-flex', alignItems: 'center', marginTop: '.35rem', border: '1px solid #86cba0', borderRadius: 999, background: '#dcfce7', color: '#166534', padding: '.15rem .5rem', fontWeight: 800, fontSize: '.68rem', lineHeight: 1.2, cursor: 'pointer' }}>Admin</button>}
              </div>
            </div>
            <button type="button" className="profile-mobile-toggle" aria-expanded={profileExpanded} aria-controls="account-profile-content" onClick={() => setProfileExpanded(value => !value)}>
              {profileExpanded ? 'Hide profile' : 'Edit profile'}
              <svg aria-hidden="true" focusable="false" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="m6 9 6 6 6-6" /></svg>
            </button>
            <div id="account-profile-content" className={`account-profile-content${profileExpanded ? ' is-expanded' : ''}`}>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.6rem' }}>
              <h3 style={{ margin: '0 0 .25rem', fontSize: '.88rem' }}>Your profile</h3>
              <p className="profile-side-links" style={{ margin: '0 0 .4rem' }}>Your saved details are reused for checkout and purchase records.</p>
              <div className="account-profile-fields">
                <label style={label}>Full name<input required maxLength={160} readOnly={!profileEditing} value={fullName} onChange={e => setFullName(e.target.value)} style={profileField(profileEditing)} /></label>
                <label style={label}>Company (optional)<input maxLength={160} readOnly={!profileEditing} value={company} onChange={e => setCompany(e.target.value)} style={{ ...field, opacity: profileEditing ? 1 : 0.8, cursor: profileEditing ? 'text' : 'default' }} /></label>
                <label style={label}>School (optional)<input maxLength={160} readOnly={!profileEditing} value={school} onChange={e => setSchool(e.target.value)} style={{ ...field, opacity: profileEditing ? 1 : 0.8, cursor: profileEditing ? 'text' : 'default' }} /></label>
              </div>
              {!profileEditing ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setMessage(''); setProfileEditing(true) }} style={{ width: '100%', marginTop: '.65rem', minHeight: 44, padding: '.45rem .65rem', fontSize: '.82rem' }}>EDIT PROFILE</button> : <div style={{ display: 'flex', gap: 8, marginTop: '.65rem' }}>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setFullName(savedProfile.fullName); setCompany(savedProfile.company); setSchool(savedProfile.school); setProfileEditing(false); setMessage('') }} style={{ flex: 1 }}>CANCEL</button>
                <button type="button" className="btn btn-primary" disabled={busy || !fullName.trim() || (fullName.trim() === savedProfile.fullName && company.trim() === savedProfile.company && school.trim() === savedProfile.school)} onClick={() => void saveProfile()} style={{ flex: 1 }}>{busy ? 'Please wait…' : 'SAVE CHANGES'}</button>
              </div>}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2,minmax(0,1fr))', gap: '.5rem', marginTop: '.5rem' }}>
                <button type="button" className="btn btn-outline" onClick={() => setAccountTab(accountTab === 'delete' ? 'payments' : 'delete')} style={{ minWidth: 0, minHeight: 44, padding: '.45rem .5rem', fontSize: '.78rem', borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)' }}>Delete account</button>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void signOut()} style={{ minWidth: 0, minHeight: 44, padding: '.45rem .5rem', fontSize: '.78rem' }}>{busy ? 'Signing out…' : 'Sign out'}</button>
              </div>
              {accountTab === 'delete' && <section style={{ ...card, marginTop: '1rem', borderColor: 'var(--danger, #dc2626)' }}>
                <h3 style={{ marginTop: 0, color: 'var(--danger, #dc2626)' }}>Delete account</h3>
                <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>Permanently delete your Hyperion account, linked licenses, and payment submissions associated with this account. This action cannot be undone. It does not delete records retained independently by Google Play, Google, or Facebook.</p>
                {!deleteConfirmOpen ? <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setDeleteConfirmation(''); setDeleteConfirmOpen(true) }} style={{ width: '100%', borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)' }}>DELETE MY ACCOUNT</button> : <div>
                  <label style={label}>To confirm, type DELETE below<input autoComplete="off" value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} style={field} /></label>
                  <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
                    <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmation('') }} style={{ flex: 1 }}>Cancel</button>
                    <button type="button" className="btn btn-primary" disabled={busy || deleteConfirmation !== 'DELETE'} onClick={() => void deleteAccount()} style={{ flex: 1, background: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}>{busy ? 'Deleting…' : 'Permanently delete'}</button>
                  </div>
                </div>}
              </section>}
            </div>
            </div>
          </section>}
          {!session && <section style={{ ...card, padding: '.8rem', marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', marginBottom: '.8rem' }}>
              <div className="profile-avatar">H</div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1rem' }}>Welcome to Hyperion</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', marginTop: '.2rem' }}>Guest visitor</div>
              </div>
            </div>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.85rem' }}>
              <h3 style={{ margin: '0 0 .25rem', fontSize: '.98rem' }}>Your profile</h3>
              <p className="profile-side-links" style={{ margin: '0 0 .8rem' }}>Sign in with Google to manage your Hyperion account, sync licenses, and complete purchases.</p>
              <button type="button" className="btn btn-primary" disabled={!supabaseConfigured || busy} onClick={() => void signInWithGoogle()} style={{ width: '100%', minHeight: 46 }}>
                {busy ? 'Opening Google…' : 'Sign in with Google'}
              </button>
              <p className="profile-side-links" style={{ margin: '.7rem 0 0' }}>You can browse the Bond Store without signing in. Sign-in is required only when you proceed to checkout or manage your account.</p>
            </div>
          </section>}
        </aside>

        <main className="account-main">
          {isLayout ? children : <>
          {session && <AccountSectionTabs active={accountTab === 'licenses' ? 'licenses' : 'store'} />}
          {session && accountTab === 'licenses' ? <>
          <section style={card}>
            <div className="account-panel-title">
              <div><div style={{ color: 'var(--accent)', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em' }}>YOUR SUBSCRIPTIONS</div><h2 style={{ margin: '.2rem 0 0', fontSize: '1.25rem' }}>Active licenses</h2></div>
              <span style={{ borderRadius: 999, border: '1px solid var(--border)', padding: '.35rem .65rem', fontWeight: 850, fontSize: '.78rem' }}>{owned.length} active</span>
            </div>
            {owned.length ? owned.map(item => {
              const transaction = orders.find(order => order.id === item.order_id)
              const expiry = licenseExpiryDetails(item.expires_at)
              const expiringSoon = expiry.daysRemaining !== null && expiry.daysRemaining <= 7
              return <div key={item.product_code} style={{ padding: '.9rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code}</strong>
                  <span style={{ color: expiringSoon ? 'var(--warning, #c2410c)' : 'var(--success, #15803d)', fontSize: '.82rem', fontWeight: 850 }}>{expiringSoon ? 'EXPIRING SOON' : 'ACTIVE'}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginTop: '.35rem' }}>{item.source === 'google_play' ? 'Google Play subscription' : (item.license_term === 'week' ? 'Weekly' : item.license_term === 'month' ? 'Monthly' : 'Yearly') + ' website access'} · Valid until {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>
                <div role="status" style={{ marginTop: '.45rem', padding: '.55rem .7rem', borderRadius: 8, background: expiringSoon ? 'var(--bg-elevated)' : 'transparent', border: expiringSoon ? '1px solid var(--border)' : '1px solid transparent', color: expiringSoon ? 'var(--warning, #c2410c)' : 'var(--text-muted)', fontSize: '.84rem', fontWeight: expiringSoon ? 800 : 600 }}>
                  {expiry.label}{expiringSoon ? ' · You can purchase access again after this license expires.' : ''}
                </div>
                <div style={{ marginTop: '.75rem', padding: '.75rem', borderRadius: 8, background: 'var(--bg-elevated)', lineHeight: 1.6 }}>
                  <strong style={{ display: 'block', marginBottom: '.25rem' }}>{item.source === 'google_play' ? 'Subscription details' : 'Transaction details'}</strong>
                  {transaction ? <>
                    {transaction.customer_name && <div>Customer name: {transaction.customer_name}</div>}
                    <div>Access duration: {transaction.license_term === 'week' ? 'Weekly' : transaction.license_term === 'month' ? 'Monthly' : 'Yearly'}</div>
                    <div>Amount paid: ₱{transaction.amount_php}</div>
                    <div>Purchase date: {new Date(transaction.paid_at || transaction.created_at).toLocaleString()}</div>
                    <div>Payment method: {transaction.payment_method || 'Not recorded'}</div>
                    <div>Reference number: {transaction.payment_reference || 'Not provided'}</div>
                    <div style={{ fontSize: '.8rem', overflowWrap: 'anywhere' }}>Order ID: {transaction.id}</div>
                    {transaction.customer_company && <div>Company: {transaction.customer_company}</div>}
                    {transaction.customer_school && <div>School: {transaction.customer_school}</div>}
                  </> : item.source === 'google_play' ? <>
                    <div>Source: Google Play</div>
                    <div>Subscription state: checked against Google Play during the last account sync</div>
                    <div>Access expiry: {item.expires_at ? new Date(item.expires_at).toLocaleString() : 'Unavailable'}</div>
                  </> : <div style={{ color: 'var(--text-muted)' }}>Order reference: {item.order_id || 'Not recorded'}</div>}
                </div>
              </div>
            }) : <p style={{ color: 'var(--text-muted)' }}>No active licenses are linked to this account yet. Any previous licenses appear below.</p>}
          </section>
          {inactiveLicenses.length > 0 && <section style={{ ...card, marginTop: '1rem' }}>
            <div className="account-panel-title">
              <div>
                <div style={{ color: 'var(--text-muted)', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em' }}>LICENSE HISTORY</div>
                <h2 style={{ margin: '.2rem 0 0', fontSize: '1.12rem' }}>Expired and revoked licenses</h2>
              </div>
              <span style={{ borderRadius: 999, border: '1px solid var(--border)', padding: '.35rem .65rem', fontWeight: 850, fontSize: '.78rem' }}>{inactiveLicenses.length} ended</span>
            </div>
            {inactiveLicenses.map(item => {
              const transaction = orders.find(order => order.id === item.order_id)
              const revoked = item.status === 'revoked'
              return <div key={item.product_code} style={{ padding: '.85rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong>{PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code}</strong>
                  <span style={{ color: revoked ? 'var(--danger, #b91c1c)' : 'var(--text-muted)', fontSize: '.8rem', fontWeight: 850 }}>{revoked ? (item.source === 'google_play' ? 'INACTIVE' : 'REVOKED') : 'EXPIRED'}</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '.88rem', marginTop: '.3rem' }}>
                  {revoked ? (item.source === 'google_play' ? 'Google Play no longer reports this subscription as active.' : 'Access was revoked by an administrator.') : item.expires_at ? `Access ended on ${new Date(item.expires_at).toLocaleDateString()}.` : 'No valid expiry date is recorded.'}
                </div>
                {transaction && <div style={{ marginTop: '.5rem', color: 'var(--text-muted)', fontSize: '.82rem' }}>
                  {transaction.amount_php > 0 ? `Last recorded purchase: ₱${transaction.amount_php} · ` : ''}{new Date(transaction.paid_at || transaction.created_at).toLocaleDateString()}
                </div>}
              </div>
            })}
            <button type="button" className="btn btn-outline" style={{ width: '100%', marginTop: '.9rem' }} onClick={() => setAccountTab('payments')}>Browse available licenses</button>
          </section>}
          </> : <>
            <section style={{ ...card, marginBottom: '1rem' }}>
              <div className="account-panel-title">
                <div><h3 style={{ margin: 0, fontSize: '1.05rem' }}>Available reviewer tracks</h3><p style={{ margin: '.25rem 0 0', color: 'var(--text-muted)', fontSize: '.82rem' }}>Unlimited practice, mock exams, and offline study for your chosen track. Active licenses cannot be purchased again.</p></div>
                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 800 }}>WEEK · MONTH · YEAR ACCESS</span>
              </div>
              <div className="account-products-grid">
                {PAID_PRODUCTS.map(item => {
                  const isOwned = owned.some(license => license.product_code === item.code)
                  const basketItem = basket.find(entry => entry.code === item.code)
                  const inBasket = Boolean(basketItem)
                  const selectedTerm = selectedTerms[item.code]
                  const selectedPrice = priceForTerm(item, selectedTerm)
                  const manualPending = orders.some(order => order.product_code === item.code && ['submitted','pending'].includes(order.status) && order.payment_method !== 'PayMongo Checkout')
                  const paymongoPending = pendingPayMongoOrders.some(order => order.product_code === item.code)
                  return <div className={`account-product-slot${hoveredStore === item.code ? ' is-hovered' : ''}${expandedStorePerks === item.code ? ' is-expanded' : ''}`} key={item.code}
                    onMouseEnter={event => {
                      if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return
                      beginStoreCardLift(event.currentTarget)
                      setHoveredStore(item.code)
                    }}
                    onMouseLeave={event => {
                      if (!window.matchMedia('(hover:hover) and (pointer:fine)').matches) return
                      // On desktop the full feature list is temporary: leaving
                      // the card collapses it, even after See all was clicked.
                      // Touch and keyboard toggles continue to work independently.
                      setHoveredStore(current => current === item.code ? null : current)
                      setExpandedStorePerks(current => current === item.code ? null : current)
                      // Force a bottom-anchored exit; otherwise the old
                      // is-expanded class skips settling and freezes the slot.
                      settleStoreCardLift(event.currentTarget, true)
                    }}>
                    <article className={`account-product-card${expandedStorePerks === item.code ? ' perks-expanded' : ''}`} aria-label={`${item.label} reviewer plan`}>
                      <div className="product-art">
                        <StoreBannerSymbol index={0} />
                        <div className="store-banner-text"><strong>HYPERION</strong><small>{STORE_TRACK_CAPTIONS[item.code]}</small></div>
                        <span className="store-banner-track">
                          <StoreBannerSymbol index={STORE_CATEGORY_ICON[item.code]} />
                          {STORE_LEVEL_ICON[item.code] != null && <StoreBannerSymbol index={STORE_LEVEL_ICON[item.code]!} small />}
                        </span>
                      </div>
                    <h3 style={{ margin: 0, fontSize: '.94rem', minHeight: '2.3em', lineHeight: 1.2 }}>{item.label}</h3>
                    <div className="product-price">₱{selectedPrice}<span style={{ fontSize: '.68rem', color: 'var(--text-muted)', fontWeight: 650 }}> / {selectedTerm}</span></div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '.61rem', fontWeight: 900, letterSpacing: '.04em' }}>CHOOSE DURATION</div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '.25rem', margin: '.35rem 0 .65rem' }}>
                      {LICENSE_TERMS.map(option => {
                        const optionPrice = priceForTerm(item, option.code)
                        const isSelected = selectedTerm === option.code
                        return <button key={option.code} type="button" aria-label={`${item.label} ${option.label} ₱${optionPrice}`} aria-pressed={isSelected} disabled={busy || isOwned || manualPending} onClick={() => setSelectedTerms(old => ({ ...old, [item.code]: option.code }))} style={{ minWidth: 0, minHeight: 40, border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--border)'), borderRadius: 7, padding: '.3rem .1rem', background: isSelected ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text)', fontSize: '.66rem', lineHeight: 1.15, fontWeight: 800, cursor: busy || isOwned || manualPending ? 'not-allowed' : 'pointer' }}><span style={{ display: 'block' }}>{option.label}</span><span style={{ display: 'block', marginTop: '.12rem' }}>₱{optionPrice}</span></button>
                      })}
                    </div>
                    <div className="store-feature-highlight">✦ Full reviewer access</div>
                    <ul className="store-benefits-list" id={`store-benefits-${item.code}`} aria-label={`Premium features for ${item.label}`}>
                      {STORE_FEATURES.map(feature => <li key={feature}>{feature}</li>)}
                    </ul>
                    <button type="button" className="store-benefits-toggle" aria-controls={`store-benefits-${item.code}`} aria-expanded={expandedStorePerks === item.code} onClick={event => {
                      const slot = event.currentTarget.closest<HTMLElement>('.account-product-slot')
                      if (slot && window.matchMedia('(hover:hover) and (pointer:fine)').matches) {
                        if (expandedStorePerks !== item.code) beginStoreCardLift(slot)
                        else if (!slot.matches(':hover')) settleStoreCardLift(slot, true)
                      }
                      setExpandedStorePerks(current => current === item.code ? null : item.code)
                    }}>
                      {expandedStorePerks === item.code ? 'Show fewer features ↑' : 'See all 9 premium features ↓'}
                    </button>
                    <span className="product-status" style={isOwned ? { color: 'var(--success, #15803d)', borderColor: '#86cba0' } : inBasket ? { color: 'var(--accent)', borderColor: 'rgba(34,197,94,.5)', background: 'rgba(34,197,94,.1)' } : undefined}>{isOwned ? '✓ LICENSE ACTIVE' : inBasket ? '✓ IN YOUR BASKET' : manualPending ? 'MANUAL REVIEW PENDING' : paymongoPending ? 'CHECKOUT ALREADY OPEN' : 'AVAILABLE'}</span>
                    <button type="button" className="btn btn-primary" disabled={busy || isOwned || manualPending} onClick={() => buyNow(item.code, selectedTerm)} style={{ width: '100%', marginTop: '.5rem', minHeight: 44, background: '#3abfc0', borderColor: '#3abfc0', color: '#fff', padding: '.5rem .25rem', fontSize: '.78rem' }}>
                      {isOwned ? 'LICENSE ACTIVE' : manualPending ? 'AWAITING REVIEW' : 'BUY NOW'}
                    </button>

                    </article>
                  </div>
                })}
              </div>
              <p style={{ margin: '.8rem 0 0', fontSize: '.73rem', lineHeight: 1.5, color: 'var(--text-muted)' }}>
                Features unlock only for the purchased track during its active license. Offline review requires downloading that track, and cross-device progress uses the same Google account.
              </p>
            </section>


          </>}
          </>}
        </main>
      </div>
    </>
    {!signedOutSuccess && !deletionSuccess && !/^\/(?:checkout|basket)\/?$/i.test(pathname) && createPortal(<button type="button" className="account-cart-fab" aria-label="Shopping cart" title="Shopping cart" onClick={() => navigate('/checkout')}><span className="account-cart-icon" aria-hidden="true"><svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M3 3h2l2.4 12h11.2l2-8H6" /><circle cx="9" cy="20" r="1" /><circle cx="18" cy="20" r="1" /></svg></span></button>, document.body)}
  </div>
}
