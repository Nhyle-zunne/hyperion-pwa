import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import AccountSectionTabs from '../components/AccountSectionTabs'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
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
  reviewed_at: string | null
  admin_note: string | null
  checkout_batch_id: string | null
}
type OwnedTrack = { product_code: string; order_id: string; license_term: LicenseTerm; granted_at: string; expires_at: string | null; renewed_at: string | null }
type BasketItem = { code: PaidTrack; term: LicenseTerm }

function safeAccountError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (!message || /supabase|postgrest|postgres|sqlstate|provider credentials|redirect settings|edge function|row[- ]level security|\bpgrst\b|\bjwt\b|database schema|relation .* does not exist|violates .* constraint/i.test(message)) return fallback
  return message
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
export default function AccountScreen() {
  const navigate = useNavigate()
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
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [owned, setOwned] = useState<OwnedTrack[]>([])
  const [selectedTerms, setSelectedTerms] = useState<Record<PaidTrack, LicenseTerm>>(() => Object.fromEntries(PAID_PRODUCTS.map(item => [item.code, basket.find(entry => entry.code === item.code)?.term ?? 'year'])) as Record<PaidTrack, LicenseTerm>)
  const [orders, setOrders] = useState<Order[]>([])
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    try {
      if (basket.length) localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(basket))
      else localStorage.removeItem('hyperion-account-basket-v1')
    } catch { /* basket remains available for this page session */ }
  }, [basket])

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
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
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
  const saveProfile = async () => {
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
  }
  const refreshAccount = async () => {
    if (!supabase || !session?.user.id) { setOwned([]); setOrders([]); return }
    const orderColumns = 'id,product_code,license_term,amount_php,status,payment_reference,payment_method,customer_name,customer_company,customer_school,created_at,paid_at,reviewed_at,admin_note,checkout_batch_id'
    const [entitlements, orderResult] = await Promise.all([
      supabase.from('entitlements')
        .select('product_code,order_id,license_term,granted_at,expires_at,renewed_at')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString()),
      supabase.from('orders')
        .select(orderColumns)
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(50),
    ])

    const activeLicenses = !entitlements.error ? (entitlements.data ?? []) as OwnedTrack[] : []
    setOwned(activeLicenses)
    if (entitlements.error) setMessage('Unable to refresh account details. Please try again.')

    let linkedOrders: Order[] = []
    const linkedOrderIds = [...new Set(activeLicenses.map(item => item.order_id).filter(Boolean))]
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
    await refreshCloudEntitlements()
  }

  useEffect(() => { void refreshAccount() }, [session?.user.id])

  // A checkout return triggers direct server-to-PayMongo verification. The return URL
  // itself grants nothing; only a paid session checked by the server or signed webhook can activate a license.
  useEffect(() => {
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
  }, [session?.user.id, params])
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
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }
  const profileField = (editable: boolean): React.CSSProperties => ({ ...field, background: editable ? 'var(--bg-elevated)' : 'var(--bg)', color: editable ? 'var(--text)' : 'var(--text-muted)', border: editable ? '1px solid var(--border)' : '1px solid #cbd5e1', boxShadow: 'none', outline: 'none', cursor: editable ? 'text' : 'default', userSelect: editable ? 'text' : 'none', WebkitUserSelect: editable ? 'text' : 'none', pointerEvents: editable ? 'auto' : 'none', caretColor: editable ? 'auto' : 'transparent' })
  const label: React.CSSProperties = { display: 'block', marginTop: '.8rem' }
  const pendingPayMongoOrders = orders.filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
  const pendingCheckoutIds = [...new Set(pendingPayMongoOrders.map(order => order.checkout_batch_id || order.id))].sort().join(',')

  // Keep checking pending PayMongo sessions while the user is in their account.
  // The signed webhook remains primary; this server-side verification is the automatic fallback.
  useEffect(() => {
    const client = supabase
    if (!client || !session?.user.id || !pendingCheckoutIds) return
    let active = true
    let checking = false
    const checkPending = async () => {
      if (checking) return
      checking = true
      try {
        const activated: string[] = []
        for (const orderId of pendingCheckoutIds.split(',').filter(Boolean)) {
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
        // A transient network or provider issue is retried by the next interval.
      } finally {
        checking = false
      }
    }
    void checkPending()
    const timer = window.setInterval(() => { void checkPending() }, 8000)
    return () => { active = false; window.clearInterval(timer) }
  }, [session?.user.id, pendingCheckoutIds])

  const deleteAccount = async () => {
    if (!supabase || !session || deleteConfirmation !== 'DELETE') return
    setBusy(true)
    setMessage('Deleting your account and associated account data…')
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation: 'DELETE' } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (data?.success !== true) throw new Error('Account deletion could not be confirmed. Please try again or contact support.')
      await supabase.auth.signOut()
      setSession(null)
      setOwned([])
      setOrders([])
      setDeleteConfirmOpen(false)
      setDeleteConfirmation('')
      setMessage('')
      setDeletionSuccess(true)
    } catch (error) {
      setMessage(safeAccountError(error, 'Unable to delete your account. Please try again or contact support.'))
    } finally {
      setBusy(false)
    }
  }



  return <div className="screen account-page" style={{ width: 'min(calc(100% - 2rem), 1320px)', maxWidth: 1320, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{`
      .account-page .account-layout{display:grid;grid-template-columns:minmax(250px,300px) minmax(0,1fr);gap:1.25rem;align-items:start;margin-top:1.1rem}
      .account-page .account-sidebar{display:grid;gap:1rem;align-content:start;position:sticky;top:80px;min-width:0;align-self:start}
      .account-page .account-main{min-width:0}
      .account-page .account-toolbar{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap;margin:1rem 0}
      .account-page .account-section-tabs{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap;min-width:0}
      .account-page .account-section-tabs button{min-height:44px;padding:.65rem 1rem;font-weight:850;border-radius:9px;white-space:nowrap}
      .account-page .account-section-tabs button[aria-selected="true"]{background:#147d43;border-color:#147d43;color:#fff}
      .account-page .account-toolbar-actions{display:flex;align-items:center;gap:.45rem;flex-wrap:wrap}
      .account-page .account-toolbar-actions button{min-height:42px}
      .account-page .account-products-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:1rem}
      .account-page .account-product-card{min-width:0;display:flex;flex-direction:column;padding:1rem;border:1px solid var(--border);border-radius:12px;background:var(--bg-card);transition:border-color .16s ease,transform .16s ease,box-shadow .16s ease}
      .account-page .account-product-card:hover{border-color:#c9a44c;box-shadow:0 7px 20px rgba(4,35,83,.08);transform:translateY(-2px)}
      .account-page .account-product-card .product-art{display:grid;place-items:center;min-height:105px;border-radius:9px;background:linear-gradient(135deg,#042353,#0d376b);color:#f5c75e;font-size:2rem;margin-bottom:.9rem;position:relative;overflow:hidden}
      .account-page .account-product-card .product-art:after{content:"";position:absolute;width:130px;height:130px;border:1px solid rgba(245,199,94,.28);border-radius:50%;right:-36px;top:-62px}
      .account-page .account-product-card .product-art span{font-size:.66rem;letter-spacing:.13em;font-weight:900;color:#fff;position:absolute;bottom:.55rem;left:.7rem}
      .account-page .product-price{font-size:1.55rem;font-weight:900;line-height:1.1;color:var(--text);margin:.75rem 0 .25rem}
      .account-page .product-meta{font-size:.78rem;color:var(--text-muted);line-height:1.45}
      .account-page .product-card-spacer{flex:1;min-height:.75rem}
      .account-page .product-status{display:inline-flex;align-self:flex-start;border-radius:999px;background:var(--bg-elevated);border:1px solid var(--border);padding:.28rem .55rem;font-size:.67rem;font-weight:850;letter-spacing:.04em;margin-top:.65rem}
      .account-page .account-panel-title{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap;margin-bottom:1rem}
      .account-page .account-cart-row{display:flex;align-items:center;justify-content:space-between;gap:.8rem;border-bottom:1px solid var(--border);padding:.75rem 0}
      .account-page .account-cart-row:last-child{border-bottom:0}
      .account-page .account-total-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;padding-top:1rem;margin-top:.4rem;border-top:1px solid var(--border)}
      .account-page .profile-avatar{width:58px;height:58px;flex-shrink:0;display:grid;place-items:center;border-radius:16px;background:#042353;color:#f5c75e;font-weight:950;font-size:1.1rem;letter-spacing:.03em}
      .account-page .profile-mobile-toggle{display:none;border:1px solid var(--border);border-radius:9px;background:var(--bg-elevated);color:var(--text);padding:.5rem .65rem;font-size:.8rem;font-weight:850;align-items:center;gap:.35rem;cursor:pointer}
      .account-page .account-profile-content{display:block}
      .account-page .account-section-tabs{display:flex;gap:.5rem;flex-wrap:wrap;margin:0 0 1rem}
      .account-page .account-section-tabs button{min-height:44px;padding:.7rem .85rem;font-weight:850;border-radius:9px}
      .account-page .profile-side-links{font-size:.82rem;color:var(--text-muted);line-height:1.45}
      .account-page .payment-method-pills{display:flex;flex-wrap:wrap;gap:.4rem}
      .account-page .payment-method-pills span{padding:.3rem .5rem;border:1px solid var(--border);background:var(--bg-elevated);border-radius:6px;font-size:.7rem;font-weight:750}
      @media(max-width:1100px){.account-page .account-products-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:800px){.account-page .account-layout{grid-template-columns:minmax(0,1fr)}.account-page .account-sidebar{position:static;grid-template-columns:minmax(0,1fr)}.account-page .account-profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 .8rem}.account-page .account-toolbar-actions{display:flex;justify-content:flex-end}.account-page .profile-mobile-toggle{display:inline-flex}.account-page .account-profile-content{display:none}.account-page .account-profile-content.is-expanded{display:block}.account-page .account-section-tabs{display:grid;grid-template-columns:1fr;gap:.45rem}.account-page .account-section-tabs button{text-align:left}}
      @media(max-width:520px){.account-page .account-products-grid{grid-template-columns:minmax(0,1fr)}.account-page .account-profile-fields{grid-template-columns:minmax(0,1fr)}.account-page .account-product-card .product-art{min-height:88px}.account-page .account-cart-row{align-items:flex-start}}
    `}</style>

    {deletionSuccess && <div
      role="presentation"
      style={{ position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(3, 8, 18, .72)', boxSizing: 'border-box' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="account-deletion-success-title"
        style={{ width: 'min(100%, 440px)', boxSizing: 'border-box', padding: '1.5rem', borderRadius: 16, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: '0 24px 70px rgba(0,0,0,.4)', textAlign: 'center' }}
      >
        <div aria-hidden="true" style={{ display: 'grid', placeItems: 'center', width: 54, height: 54, margin: '0 auto .9rem', borderRadius: '50%', background: 'rgba(20,125,67,.14)', color: '#16834a', fontSize: '2rem', fontWeight: 900 }}>✓</div>
        <h2 id="account-deletion-success-title" style={{ margin: '0 0 .6rem' }}>Account deletion successful</h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 1rem' }}>Your Hyperion account has been deleted successfully.</p>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.6, margin: '0 0 1.25rem' }}>You can now sign in again and choose any Google account.</p>
        <button type="button" className="btn btn-primary" autoFocus onClick={() => setDeletionSuccess(false)} style={{ width: '100%', minHeight: 46 }}>Continue</button>
      </section>
    </div>}

    {!session ? <section style={{ ...card, maxWidth: 460, margin: '1.5rem auto' }}>
      <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>Sign in to manage your profile, purchase reviewer tracks, and view your licenses.</p>
      <button
        type="button"
        className="btn btn-outline"
        disabled={!supabaseConfigured || busy}
        onClick={() => void signInWithGoogle()}
        style={{ width: '100%', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.65rem', minHeight: 46 }}
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.02 13.22l7.98 6.19C11.89 13.72 17.48 9.5 24 9.5Z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.72 7.18l7.62 5.91c4.45-4.11 7.14-10.16 7.14-17.56Z"/>
          <path fill="#FBBC05" d="M9.99 28.59A14.4 14.4 0 0 1 9.2 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.57 10.78l7.42-6.19Z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.89l-7.62-5.91c-2.11 1.41-4.81 2.25-8.29 2.25-6.52 0-12.11-4.22-14-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/>
        </svg>
        Continue with Google
      </button>
      {params.get('payment') === 'success' && <div role="status" style={{ ...card, marginTop: '1rem', marginBottom: 0 }}>You returned from checkout. Sign in with the same Hyperion account to verify payment and activate the purchased track.</div>}
    </section> : <>
      {message && <div role="status" style={{ ...card, lineHeight: 1.5, marginTop: '.8rem', marginBottom: 0 }}>{message}</div>}

      <div className="account-toolbar" style={{ justifyContent: 'flex-end' }}>

      </div>

      <div className="account-layout">
        <aside className="account-sidebar">
          <section style={{ ...card, marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', marginBottom: '.8rem' }}>
              <div className="profile-avatar">{(fullName || 'H').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0, flex: 1 }}>
                <h2 style={{ margin: 0, fontSize: '1rem', overflowWrap: 'anywhere' }}>{fullName || 'Hyperion Member'}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', overflowWrap: 'anywhere', marginTop: '.2rem' }}>{session.user.email}</div>
                {isAdmin && <button type="button" title="Open admin dashboard" aria-label="Admin" onClick={() => navigate('/admin/licenses')} style={{ display: 'inline-flex', alignItems: 'center', marginTop: '.35rem', border: '1px solid #86cba0', borderRadius: 999, background: '#dcfce7', color: '#166534', padding: '.15rem .5rem', fontWeight: 800, fontSize: '.68rem', lineHeight: 1.2, cursor: 'pointer' }}>Admin</button>}
              </div>
              <button type="button" className="profile-mobile-toggle" aria-expanded={profileExpanded} onClick={() => setProfileExpanded(value => !value)}>{profileExpanded ? 'Hide profile' : 'Edit profile'} <span aria-hidden="true">{profileExpanded ? '⌃' : '⌄'}</span></button>
            </div>
            <div className={`account-profile-content${profileExpanded ? ' is-expanded' : ''}`}>
            <div style={{ borderTop: '1px solid var(--border)', paddingTop: '.85rem' }}>
              <h3 style={{ margin: '0 0 .25rem', fontSize: '.98rem' }}>Your profile</h3>
              <p className="profile-side-links" style={{ margin: '0 0 .6rem' }}>Your saved details are reused for PayMongo checkout and your purchase records.</p>
              <div className="account-profile-fields">
                <label style={label}>Full name<input required maxLength={160} readOnly={!profileEditing} value={fullName} onChange={e => setFullName(e.target.value)} style={profileField(profileEditing)} /></label>
                <label style={label}>Company (optional)<input maxLength={160} readOnly={!profileEditing} value={company} onChange={e => setCompany(e.target.value)} style={{ ...field, opacity: profileEditing ? 1 : 0.8, cursor: profileEditing ? 'text' : 'default' }} /></label>
                <label style={label}>School (optional)<input maxLength={160} readOnly={!profileEditing} value={school} onChange={e => setSchool(e.target.value)} style={{ ...field, opacity: profileEditing ? 1 : 0.8, cursor: profileEditing ? 'text' : 'default' }} /></label>
              </div>
              {!profileEditing ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setMessage(''); setProfileEditing(true) }} style={{ width: '100%', marginTop: '1rem' }}>EDIT PROFILE</button> : <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
                <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setFullName(savedProfile.fullName); setCompany(savedProfile.company); setSchool(savedProfile.school); setProfileEditing(false); setMessage('') }} style={{ flex: 1 }}>CANCEL</button>
                <button type="button" className="btn btn-primary" disabled={busy || !fullName.trim() || (fullName.trim() === savedProfile.fullName && company.trim() === savedProfile.company && school.trim() === savedProfile.school)} onClick={() => void saveProfile()} style={{ flex: 1 }}>{busy ? 'Please wait…' : 'SAVE CHANGES'}</button>
              </div>}
              <button type="button" className="btn btn-outline" onClick={() => setAccountTab(accountTab === 'delete' ? 'payments' : 'delete')} style={{ display: 'block', width: '100%', marginTop: '.6rem', borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)' }}>Delete account</button>
              <button type="button" className="btn btn-outline" onClick={async () => { await supabase?.auth.signOut(); setMessage('Signed out.') }} style={{ display: 'block', width: '100%', marginTop: '.6rem' }}>Sign out</button>
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
          </section>
        </aside>

        <main className="account-main">
          <AccountSectionTabs active={accountTab === 'licenses' ? 'licenses' : 'store'} />
          {accountTab === 'licenses' ? <section style={card}>
            <div className="account-panel-title">
              <div><div style={{ color: '#a47e2e', fontWeight: 900, fontSize: '.68rem', letterSpacing: '.12em' }}>YOUR SUBSCRIPTIONS</div><h2 style={{ margin: '.2rem 0 0', fontSize: '1.25rem' }}>Active licenses</h2></div>
              <span style={{ borderRadius: 999, border: '1px solid var(--border)', padding: '.35rem .65rem', fontWeight: 850, fontSize: '.78rem' }}>{owned.length} active</span>
            </div>
            {owned.length ? owned.map(item => {
              const transaction = orders.find(order => order.id === item.order_id)
              return <div key={item.product_code} style={{ padding: '.9rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                  <strong>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code}</strong>
                  <span style={{ color: 'var(--success, #15803d)', fontSize: '.82rem', fontWeight: 800 }}>ACTIVE</span>
                </div>
                <div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginTop: '.35rem' }}>{item.license_term === 'week' ? 'Weekly' : item.license_term === 'month' ? 'Monthly' : 'Yearly'} access · Valid until {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>
                <div style={{ marginTop: '.75rem', padding: '.75rem', borderRadius: 8, background: 'var(--bg-elevated)', lineHeight: 1.6 }}>
                  <strong style={{ display: 'block', marginBottom: '.25rem' }}>Transaction details</strong>
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
                  </> : <div style={{ color: 'var(--text-muted)' }}>Order reference: {item.order_id}</div>}
                </div>
              </div>
            }) : <p style={{ color: 'var(--text-muted)' }}>No active licenses are linked to this account yet.</p>}
          </section> : <>
            <section style={{ ...card, marginBottom: '1rem' }}>
              <div className="account-panel-title">
                <div><h3 style={{ margin: 0, fontSize: '1.05rem' }}>Available reviewer tracks</h3><p style={{ margin: '.25rem 0 0', color: 'var(--text-muted)', fontSize: '.82rem' }}>Choose the track or tracks you need. Active licenses cannot be purchased again.</p></div>
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
                  const description = item.code === 'oic_nw' ? 'Deck officer examination preparation and reviewer access.'
                    : item.code === 'gmdss' ? 'GMDSS GOC examination preparation and reviewer access.'
                    : item.code === 'engine_ew' ? 'Engine OIC-EW examination preparation and reviewer access.'
                    : item.code === 'deck_mgt' ? 'Deck management examination preparation and reviewer access.'
                    : 'Engine management examination preparation and reviewer access.'
                  return <article className="account-product-card" key={item.code}>
                    <div className="product-art"><div aria-hidden="true">{item.code === 'gmdss' ? '📡' : item.code === 'engine_ew' || item.code === 'engine_mgt' ? '⚙️' : '⚓'}</div><span>HYPERION REVIEWER</span></div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '.68rem', fontWeight: 900, letterSpacing: '.12em' }}>CHOOSE ACCESS DURATION</div>
                    <h3 style={{ margin: '.35rem 0 0', fontSize: '1.03rem', minHeight: '2.4em', lineHeight: 1.2 }}>{item.label}</h3>
                    <div className="product-price">₱{selectedPrice}<span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 650 }}> / {selectedTerm}</span></div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '.35rem', marginTop: '.6rem' }}>
                      {LICENSE_TERMS.map(option => {
                        const optionPrice = priceForTerm(item, option.code)
                        const isSelected = selectedTerm === option.code
                        return <button key={option.code} type="button" aria-pressed={isSelected} disabled={busy || isOwned || manualPending} onClick={() => setSelectedTerms(old => ({ ...old, [item.code]: option.code }))} style={{ border: '1px solid ' + (isSelected ? 'var(--accent)' : 'var(--border)'), borderRadius: 7, padding: '.45rem .2rem', background: isSelected ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text)', fontSize: '.72rem', fontWeight: 800, cursor: 'pointer' }}><span style={{ display: 'block' }}>{option.label}</span><span style={{ display: 'block', marginTop: '.15rem' }}>₱{optionPrice}</span></button>
                      })}
                    </div>
                    <div className="product-meta">{description}</div>
                    <div className="product-card-spacer" />
                    <span className="product-status" style={isOwned ? { color: 'var(--success, #15803d)', borderColor: '#86cba0' } : inBasket ? { color: '#946c12', borderColor: '#dfc277', background: 'rgba(245,199,94,.12)' } : undefined}>{isOwned ? '✓ LICENSE ACTIVE' : inBasket ? '✓ IN YOUR BASKET' : manualPending ? 'MANUAL REVIEW PENDING' : paymongoPending ? 'CHECKOUT ALREADY OPEN' : 'AVAILABLE'}</span>
                    <button type="button" className="btn btn-primary" disabled={busy || isOwned || manualPending} onClick={() => buyNow(item.code, selectedTerm)} style={{ width: '100%', marginTop: '.8rem', minHeight: 43, background: '#3abfc0', borderColor: '#3abfc0', color: '#fff' }}>
                      {isOwned ? 'LICENSE ACTIVE' : manualPending ? 'AWAITING REVIEW' : 'BUY NOW'}
                    </button>
                    {!isOwned && !manualPending && <button type="button" disabled={busy} onClick={() => navigate(`/manual-payment?product=${encodeURIComponent(item.code)}&term=${selectedTerm}`)} style={{ background: 'transparent', color: 'var(--text-muted)', width: '100%', padding: '.55rem .25rem .1rem', fontSize: '.78rem', textDecoration: 'underline', textUnderlineOffset: 3 }}>Pay manually with QR</button>}
                  </article>
                })}
              </div>
            </section>


          </>}
        </main>
      </div>
    </>}
  </div>
}
