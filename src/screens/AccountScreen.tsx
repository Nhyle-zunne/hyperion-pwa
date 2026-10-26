import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import type { PaidTrack } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

type Order = {
  id: string
  product_code: string
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
type OwnedTrack = { product_code: string; order_id: string; granted_at: string; expires_at: string | null; renewed_at: string | null }

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
  const [session, setSession] = useState<Session | null>(null)
  const [accountTab, setAccountTab] = useState<'licenses' | 'payments' | 'delete'>(() => params.get('tab') === 'licenses' ? 'licenses' : params.get('tab') === 'delete' ? 'delete' : 'payments')
  const [product, setProduct] = useState('oic_nw')
  const [basket, setBasket] = useState<PaidTrack[]>(() => {
    try {
      const raw = localStorage.getItem('hyperion-account-basket-v1')
      const saved = raw ? JSON.parse(raw) : []
      return Array.isArray(saved)
        ? [...new Set(saved.filter((code): code is PaidTrack => typeof code === 'string' && PAID_PRODUCTS.some(item => item.code === code)))]
        : []
    } catch {
      return []
    }
  })
  const [manualPaymentOpen, setManualPaymentOpen] = useState(false)
  const paymentMethod = 'QR Ph (MariBank / InstaPay)'
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [school, setSchool] = useState('')
  const [profileEditing, setProfileEditing] = useState(false)
  const [savedProfile, setSavedProfile] = useState({ fullName: '', company: '', school: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const facebookPage = 'https://www.facebook.com/hyperionbynhyle'
  const qrPhImage = '/qr-ph.png'
  const [busy, setBusy] = useState(false)
  const [cancelingCheckoutId, setCancelingCheckoutId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const [owned, setOwned] = useState<OwnedTrack[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    try {
      if (basket.length) localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(basket))
      else localStorage.removeItem('hyperion-account-basket-v1')
    } catch { /* basket remains available for this page session */ }
  }, [basket])

  const buyNow = (code: PaidTrack) => {
    const nextBasket = basket.includes(code) ? basket : [...basket, code]
    try {
      if (nextBasket.length) localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(nextBasket))
    } catch { /* Keep this purchase selection in memory for the current page. */ }
    setBasket(nextBasket)
    navigate('/checkout')
  }
  const clearBasketItems = (codes: string[]) => setBasket(current => current.filter(code => !codes.includes(code)))

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
    const orderColumns = 'id,product_code,amount_php,status,payment_reference,payment_method,customer_name,customer_company,customer_school,created_at,paid_at,reviewed_at,admin_note,checkout_batch_id'
    const [entitlements, orderResult] = await Promise.all([
      supabase.from('entitlements')
        .select('product_code,order_id,granted_at,expires_at,renewed_at')
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

  const cancelPayMongoCheckout = async (orderId: string) => {
    if (!supabase || !session) {
      setMessage('Please sign in to the same Hyperion account before managing this checkout.')
      return
    }
    setBusy(true)
    setCancelingCheckoutId(orderId)
    setMessage('Checking the checkout with PayMongo before closing it…')
    try {
      const { data, error } = await supabase.functions.invoke('cancel-checkout', { body: { orderId } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)

      if (data?.status === 'already_paid') {
        setMessage('PayMongo has recorded this payment. Hyperion is checking the verified webhook status; do not send a second payment.')
        for (let attempt = 0; attempt < 7; attempt++) {
          const { data: verified, error: verifyError } = await supabase.functions.invoke('verify-checkout', { body: { orderId } })
          if (!verifyError && verified?.status === 'paid') {
            const paidCodes: string[] = Array.isArray(verified.productCodes)
              ? verified.productCodes
              : typeof verified.productCode === 'string' ? [verified.productCode] : []
            clearBasketItems(paidCodes)
            await refreshAccount()
            setMessage(`Payment confirmed. Activated: ${paidCodes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code).join(', ')}.`)
            return
          }
          if (attempt < 6) await new Promise(resolve => window.setTimeout(resolve, 1500))
        }
        await refreshAccount()
        setMessage('PayMongo reports a paid transaction, but the signed activation notification is still processing. Do not use manual payment or pay again; refresh status shortly.')
        return
      }

      if (data?.status === 'processing') {
        await refreshAccount()
        setMessage(data.message || 'A payment attempt is still processing. Wait for PayMongo to confirm its result before switching to manual payment.')
        return
      }

      if (data?.status === 'cancelled') {
        await refreshAccount()
        setMessage('The PayMongo checkout has been closed. You can now switch to manual QR payment if you still want this track.')
        return
      }

      await refreshAccount()
      setMessage('PayMongo returned an unexpected checkout status. Please refresh your account before retrying.')
    } catch (error) {
      await refreshAccount()
      setMessage(safeAccountError(error, 'Could not safely close this checkout. Resume the same checkout or contact Hyperion support; do not submit a second payment yet.'))
    } finally {
      setBusy(false)
      setCancelingCheckoutId(null)
    }
  }

  useEffect(() => { void refreshAccount() }, [session?.user.id])

  const refreshPaymentStatus = async () => {
    if (!supabase || !session) {
      await refreshAccount()
      return
    }
    setBusy(true)
    setMessage('Checking any pending PayMongo payments with the payment provider…')
    try {
      const pending = orders.filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
      const checkoutIds = [...new Set(pending.map(order => order.checkout_batch_id || order.id))]
      if (checkoutIds.length === 0) {
        await refreshAccount()
        setMessage('Account status refreshed. There are no pending PayMongo checkouts to verify.')
        return
      }
      let activated: string[] = []
      let pendingCount = 0
      let lastError = ''
      for (const orderId of checkoutIds) {
        const { data, error } = await supabase.functions.invoke('verify-checkout', { body: { orderId } })
        if (error) {
          lastError = (await edgeFunctionErrorMessage(error)) || 'Payment verification is temporarily unavailable.'
          continue
        }
        if (data?.status === 'paid') {
          const codes: string[] = Array.isArray(data.productCodes)
            ? data.productCodes
            : typeof data.productCode === 'string' ? [data.productCode] : []
          activated.push(...codes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code))
          clearBasketItems(codes)
        } else if (data?.status === 'pending') {
          pendingCount += 1
        } else if (typeof data?.error === 'string') {
          lastError = data.error
        }
      }
      await refreshAccount()
      if (activated.length) setMessage(`Payment confirmed. Activated: ${[...new Set(activated)].join(', ')}. Only the tracks in each paid basket were granted.`)
      else if (lastError) setMessage(lastError)
      else setMessage(pendingCount ? 'PayMongo has not yet confirmed these pending checkout(s) as paid. No license was granted. Try refreshing again after payment finishes.' : 'Payment status refreshed.')
    } catch (error) {
      const serverMessage = await edgeFunctionErrorMessage(error)
      setMessage(serverMessage || safeAccountError(error, 'Could not check PayMongo payment status right now. Please try again shortly.'))
    } finally {
      setBusy(false)
    }
  }

  // A checkout return triggers direct server-to-PayMongo verification. The return URL
  // itself grants nothing; only a paid session checked by the server or signed webhook can activate a license.
  useEffect(() => {
    const paymentState = params.get('payment')
    const orderId = params.get('order_id')
    const returnedProduct = params.get('product_code')
    if (!session) return
    if (returnedProduct && PAID_PRODUCTS.some(item => item.code === returnedProduct)) setProduct(returnedProduct)
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
        },
      })
      if (error) throw error
    } catch {
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      setMessage('Sign-in could not be completed. Please try again.')
      setBusy(false)
    }
  }

  const submitPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session) return
    if (!fullName.trim()) {
      setMessage('Please add your full name in Your profile before submitting a purchase.')
      return
    }
    if (owned.some(item => item.product_code === product)) {
      setMessage('This license is already active for your account. You do not need to purchase this track again.')
      return
    }
    setBusy(true); setMessage('Submitting your payment for manual review…')
    try {
      const { data, error } = await supabase.functions.invoke('submit-manual-payment', { body: { productCode: product, paymentMethod, paymentReference: reference, customerNote: note, customerProfile: { fullName: fullName.trim(), company: company.trim(), school: school.trim() } } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage(`Payment details submitted. Your reference is ${data.order.id}. Please send your payment screenshot to our Facebook page. Access will be enabled after manual verification.`)
      setReference(''); setNote('')
      await refreshAccount()
    } catch (error) { setMessage(safeAccountError(error, 'Unable to submit payment. Please try again.')) }
    finally { setBusy(false) }
  }
  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', marginBottom: '1rem', borderRadius: 10 }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }
  const profileField = (editable: boolean): React.CSSProperties => ({ ...field, background: editable ? 'var(--bg-elevated)' : 'var(--bg)', color: editable ? 'var(--text)' : 'var(--text-muted)', border: editable ? '1px solid var(--border)' : '1px solid #cbd5e1', boxShadow: 'none', outline: 'none', cursor: editable ? 'text' : 'default', userSelect: editable ? 'text' : 'none', WebkitUserSelect: editable ? 'text' : 'none', pointerEvents: editable ? 'auto' : 'none', caretColor: editable ? 'auto' : 'transparent' })
  const label: React.CSSProperties = { display: 'block', marginTop: '.8rem' }
  const statusLabel: Record<string,string> = { submitted: 'Awaiting manual review', pending: 'Awaiting payment', paid: 'Approved', failed: 'Rejected', refunded: 'Refunded', cancelled: 'Cancelled by you' }
  const activeLicense = owned.find(item => item.product_code === product)
  const pendingPayMongoOrder = orders.find(order => order.product_code === product && order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
  const pendingPayMongoOrders = orders.filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
  const pendingOrder = orders.find(order => order.product_code === product && ['submitted', 'pending'].includes(order.status) && order.payment_method !== 'PayMongo Checkout')
  const deleteAccount = async () => {
    if (!supabase || !session || deleteConfirmation !== 'DELETE') return
    setBusy(true)
    setMessage('Deleting your account and associated account data…')
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation: 'DELETE' } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await supabase.auth.signOut()
      setSession(null)
      setOwned([])
      setOrders([])
      setDeleteConfirmOpen(false)
      setDeleteConfirmation('')
      setMessage('Your Hyperion account has been deleted.')
    } catch (error) {
      setMessage(safeAccountError(error, 'Unable to delete your account. Please try again or contact support.'))
    } finally {
      setBusy(false)
    }
  }

  const cancelReview = async () => {
    if (!supabase || !pendingOrder) return
    setBusy(true); setMessage('Cancelling your review request…')
    try {
      const { data, error } = await supabase.functions.invoke('cancel-payment-review', { body: { orderId: pendingOrder.id } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage('Your payment review request has been cancelled. You can submit again if needed.')
      await refreshAccount()
    } catch (error) {
      setMessage(safeAccountError(error, 'Unable to cancel the review request. Please refresh and try again.'))
    } finally { setBusy(false) }
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
      .account-page .profile-side-links{font-size:.82rem;color:var(--text-muted);line-height:1.45}
      .account-page .payment-method-pills{display:flex;flex-wrap:wrap;gap:.4rem}
      .account-page .payment-method-pills span{padding:.3rem .5rem;border:1px solid var(--border);background:var(--bg-elevated);border-radius:6px;font-size:.7rem;font-weight:750}
      @media(max-width:1100px){.account-page .account-products-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:800px){.account-page .account-layout{grid-template-columns:minmax(0,1fr)}.account-page .account-sidebar{position:static;grid-template-columns:minmax(0,1fr)}.account-page .account-profile-fields{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:0 .8rem}.account-page .account-toolbar-actions{display:flex;justify-content:flex-end}}
      @media(max-width:520px){.account-page .account-products-grid{grid-template-columns:minmax(0,1fr)}.account-page .account-profile-fields{grid-template-columns:minmax(0,1fr)}.account-page .account-product-card .product-art{min-height:88px}.account-page .account-cart-row{align-items:flex-start}}
    `}</style>


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
        <div className="account-toolbar-actions">
          <button type="button" className="btn btn-outline" onClick={async () => { await supabase?.auth.signOut(); setMessage('Signed out.') }}>Sign out</button>
        </div>
      </div>

      <div className="account-layout">
        <aside className="account-sidebar">
          <section style={{ ...card, marginBottom: 0 }}>
            <div style={{ display: 'flex', gap: '.8rem', alignItems: 'center', marginBottom: '.8rem' }}>
              <div className="profile-avatar">{(fullName || 'H').split(/\s+/).filter(Boolean).map(part => part[0]).join('').slice(0, 2).toUpperCase()}</div>
              <div style={{ minWidth: 0 }}>
                <h2 style={{ margin: 0, fontSize: '1rem', overflowWrap: 'anywhere' }}>{fullName || 'Hyperion Member'}</h2>
                <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', overflowWrap: 'anywhere', marginTop: '.2rem' }}>{session.user.email}</div>
              </div>
            </div>
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
              {isAdmin && <button type="button" title="Open admin dashboard" aria-label="Admin" onClick={() => navigate('/admin/payments')} style={{ display: 'block', width: '100%', marginTop: '.9rem', border: '1px solid #86cba0', borderRadius: 8, background: '#dcfce7', color: '#166534', padding: '.65rem .8rem', fontWeight: 850, cursor: 'pointer' }}>Admin</button>}
              <button type="button" className="btn btn-outline" onClick={() => setAccountTab(accountTab === 'delete' ? 'payments' : 'delete')} style={{ display: 'block', width: '100%', marginTop: '.6rem', borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)' }}>Delete account</button>
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
          </section>
        </aside>

        <main className="account-main">
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
                <div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginTop: '.35rem' }}>Valid until {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>
                <div style={{ marginTop: '.75rem', padding: '.75rem', borderRadius: 8, background: 'var(--bg-elevated)', lineHeight: 1.6 }}>
                  <strong style={{ display: 'block', marginBottom: '.25rem' }}>Transaction details</strong>
                  {transaction ? <>
                    {transaction.customer_name && <div>Customer name: {transaction.customer_name}</div>}
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
                <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', fontWeight: 800 }}>12-MONTH ACCESS</span>
              </div>
              <div className="account-products-grid">
                {PAID_PRODUCTS.map(item => {
                  const isOwned = owned.some(license => license.product_code === item.code)
                  const inBasket = basket.includes(item.code)
                  const manualPending = orders.some(order => order.product_code === item.code && ['submitted','pending'].includes(order.status) && order.payment_method !== 'PayMongo Checkout')
                  const paymongoPending = pendingPayMongoOrders.some(order => order.product_code === item.code)
                  const description = item.code === 'oic_nw' ? 'Deck officer examination preparation and reviewer access.'
                    : item.code === 'gmdss' ? 'GMDSS GOC examination preparation and reviewer access.'
                    : item.code === 'engine_ew' ? 'Engine OIC-EW examination preparation and reviewer access.'
                    : item.code === 'deck_mgt' ? 'Deck management examination preparation and reviewer access.'
                    : 'Engine management examination preparation and reviewer access.'
                  return <article className="account-product-card" key={item.code}>
                    <div className="product-art"><div aria-hidden="true">{item.code === 'gmdss' ? '📡' : item.code === 'engine_ew' || item.code === 'engine_mgt' ? '⚙️' : '⚓'}</div><span>HYPERION REVIEWER</span></div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '.68rem', fontWeight: 900, letterSpacing: '.12em' }}>ANNUAL TRACK LICENSE</div>
                    <h3 style={{ margin: '.35rem 0 0', fontSize: '1.03rem', minHeight: '2.4em', lineHeight: 1.2 }}>{item.label}</h3>
                    <div className="product-price">₱{item.annualPrice}<span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 650 }}> / year</span></div>
                    <div className="product-meta">{description}</div>
                    <div className="product-card-spacer" />
                    <span className="product-status" style={isOwned ? { color: 'var(--success, #15803d)', borderColor: '#86cba0' } : inBasket ? { color: '#946c12', borderColor: '#dfc277', background: 'rgba(245,199,94,.12)' } : undefined}>{isOwned ? '✓ LICENSE ACTIVE' : inBasket ? '✓ IN YOUR BASKET' : manualPending ? 'MANUAL REVIEW PENDING' : paymongoPending ? 'CHECKOUT ALREADY OPEN' : 'AVAILABLE'}</span>
                    <button type="button" className="btn btn-primary" disabled={busy || isOwned || manualPending} onClick={() => buyNow(item.code)} style={{ width: '100%', marginTop: '.8rem', minHeight: 43, background: '#3abfc0', borderColor: '#3abfc0', color: '#fff' }}>
                      {isOwned ? 'LICENSE ACTIVE' : manualPending ? 'AWAITING REVIEW' : 'BUY NOW'}
                    </button>
                    {!isOwned && !manualPending && <button type="button" disabled={busy} onClick={() => { setProduct(item.code); setManualPaymentOpen(true) }} style={{ background: 'transparent', color: 'var(--text-muted)', width: '100%', padding: '.55rem .25rem .1rem', fontSize: '.78rem', textDecoration: 'underline', textUnderlineOffset: 3 }}>Pay manually with QR</button>}
                  </article>
                })}
              </div>
            </section>

            {manualPaymentOpen && <section style={card}>
              <div className="account-panel-title"><div><div style={{ color: '#a47e2e', fontSize: '.68rem', fontWeight: 900, letterSpacing: '.12em' }}>MANUAL ALTERNATIVE</div><h3 style={{ margin: '.2rem 0 0', fontSize: '1.08rem' }}>Manual QR payment · {PAID_PRODUCTS.find(item => item.code === product)?.label ?? product}</h3></div><button type="button" className="btn btn-outline" onClick={() => setManualPaymentOpen(false)}>CLOSE</button></div>
              {activeLicense ? <div style={{ ...card, borderColor: 'var(--success, #15803d)' }}><strong>License already active</strong><p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>This track is already active until {activeLicense.expires_at ? new Date(activeLicense.expires_at).toLocaleDateString() : 'its recorded expiration'}.</p></div> : pendingOrder ? <div style={{ ...card, borderColor: 'var(--warning, #d97706)' }}><strong>You already submitted this track for review.</strong><p style={{ color: 'var(--text-muted)' }}>Cancel the pending request before submitting another payment.</p><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancelReview()} style={{ width: '100%' }}>CANCEL REVIEW REQUEST</button></div> : pendingPayMongoOrder ? <div style={{ ...card, borderColor: 'var(--warning, #d97706)' }}><strong>A PayMongo checkout is open for this track.</strong><p style={{ color: 'var(--text-muted)' }}>Close that checkout first to avoid paying twice.</p><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancelPayMongoCheckout(pendingPayMongoOrder.checkout_batch_id || pendingPayMongoOrder.id)} style={{ width: '100%', color: 'var(--danger, #dc2626)' }}>{cancelingCheckoutId === (pendingPayMongoOrder.checkout_batch_id || pendingPayMongoOrder.id) ? 'CHECKING WITH PAYMONGO…' : 'CANCEL PAYMONGO CHECKOUT'}</button></div> : <form onSubmit={submitPayment}>
                <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', lineHeight: 1.5 }}>This fallback needs admin verification. The fastest option is the secure PayMongo basket checkout above.</p>
                <div style={{ ...card, textAlign: 'center', marginTop: '.9rem', background: '#fff', color: '#172033' }}>
                  <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '.25rem' }}>QR Ph · MariBank / InstaPay</div>
                  <p style={{ margin: '0 0 .75rem', color: '#4b5563', fontSize: '.9rem' }}>Scan this QR code using your bank or e-wallet app.</p>
                  <img src={qrPhImage} alt="MariBank InstaPay QR Ph payment code" style={{ display: 'block', width: 'min(100%, 340px)', height: 'auto', margin: '0 auto', imageRendering: 'pixelated' }} />
                  <p style={{ margin: '.75rem 0 0', color: '#4b5563', fontSize: '.85rem' }}>Account name and bank details are shown on the QR code. Verify the recipient in your payment app before sending.</p>
                </div>
                <div style={{ padding: '.85rem', border: '1px solid var(--border)', borderRadius: 8, marginTop: '.75rem', lineHeight: 1.5 }}><strong>Amount to send: ₱{PAID_PRODUCTS.find(item => item.code === product)?.annualPrice ?? 0}</strong><div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginTop: '.25rem' }}>Send the exact amount for {PAID_PRODUCTS.find(item => item.code === product)?.label ?? product} only. This covers one reviewer track for 12 months.</div></div>
                <label style={label}>Transaction/reference number<input required maxLength={160} value={reference} onChange={e => setReference(e.target.value)} style={field} /></label>
                <label style={label}>Additional notes (optional)<textarea maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} style={field} /></label>
                <a href={facebookPage} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '.8rem' }}>SEND PROOF TO OUR FACEBOOK PAGE</a>
                <button type="submit" className="btn btn-primary" disabled={busy || !supabaseConfigured || Boolean(pendingPayMongoOrder)} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Submitting…' : 'SUBMIT FOR MANUAL REVIEW'}</button>
              </form>}
            </section>}

            <section style={card}>
              <div className="account-panel-title"><div><h3 style={{ margin: 0, fontSize: '1rem' }}>Orders & payment history</h3><p style={{ color: 'var(--text-muted)', margin: '.25rem 0 0', fontSize: '.82rem' }}>Check the status of recent purchases and manual submissions.</p></div><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void refreshPaymentStatus()}>{busy ? 'Checking…' : 'Refresh status'}</button></div>
              {orders.length ? orders.map(order => <div key={order.id} style={{ padding: '.8rem 0', borderBottom: '1px solid var(--border)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: '.7rem', flexWrap: 'wrap' }}><strong>{PAID_PRODUCTS.find(item => item.code === order.product_code)?.label ?? order.product_code} · ₱{order.amount_php}</strong><span className="product-status" style={order.status === 'paid' ? { color: 'var(--success, #15803d)', borderColor: '#86cba0' } : undefined}>{statusLabel[order.status] || order.status}</span></div>
                <div style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginTop: '.3rem' }}>{new Date(order.paid_at || order.created_at).toLocaleString()} · {order.payment_method || 'Payment method not recorded'}</div>
                {order.customer_name && <div style={{ fontSize: '.82rem', marginTop: '.2rem' }}>Customer name: {order.customer_name}</div>}
                <div style={{ color: 'var(--text-muted)', fontSize: '.75rem', overflowWrap: 'anywhere', marginTop: '.2rem' }}>Reference: {order.payment_reference || 'Not provided'} · Order: {order.id}</div>
                {order.admin_note && <p style={{ marginBottom: 0, color: 'var(--text-muted)', fontSize: '.82rem' }}>Admin note: {order.admin_note}</p>}
              </div>) : <p style={{ color: 'var(--text-muted)' }}>No orders yet. Products purchased through the basket will appear here after checkout.</p>}
            </section>
          </>}
        </main>
      </div>
    </>}
  </div>
}
