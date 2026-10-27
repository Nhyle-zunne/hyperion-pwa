import { useEffect, useState } from 'react'
import type { CSSProperties, FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { priceForTerm } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

type Order = {
  id: string
  product_code: string
  amount_php: number
  status: string
  payment_method: string | null
  payment_reference: string | null
  checkout_batch_id: string | null
  paymongo_checkout_session_id: string | null
}

type Entitlement = { product_code: string; expires_at: string | null }

const paymentMethod = 'QR Ph (MariBank / InstaPay)'
const facebookPage = 'https://www.facebook.com/hyperionbynhyle'
const qrPhImage = '/qr-ph.png'

async function edgeMessage(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      // The server may return a useful validation message; no secrets are shown here.
      try {
        const body = await context.clone().json() as { error?: unknown }
        return typeof body.error === 'string' && body.error.trim() ? body.error : fallback
      } catch { return fallback }
    }
  }
  const message = error instanceof Error ? error.message : ''
  return !message || /supabase|postgrest|postgres|sqlstate|edge function|jwt|fetch failed/i.test(message) ? fallback : message
}

export default function ManualPaymentScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const rawProduct = params.get('product') ?? ''
  const productCode = PAID_PRODUCTS.some(item => item.code === rawProduct) ? rawProduct as PaidTrack : null
  const product = PAID_PRODUCTS.find(item => item.code === productCode)
  const rawTerm = params.get('term') ?? 'year'
  const licenseTerm: LicenseTerm = rawTerm === 'week' || rawTerm === 'month' ? rawTerm : 'year'
  const licensePrice = product ? priceForTerm(product, licenseTerm) : 0
  const [session, setSession] = useState<Session | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [school, setSchool] = useState('')
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [orders, setOrders] = useState<Order[]>([])
  const [owned, setOwned] = useState<Entitlement[]>([])
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    if (!supabase) { setAuthLoaded(true); return }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoaded(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoaded(true)
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
      .replace(/\\s+/g, ' ')
      .trim()
      .replace(/\\b\\w/g, letter => letter.toUpperCase())
    const nameCandidate = [
      metadata.full_name,
      metadata.name,
      metadataGivenName,
      ...identityNames,
      emailName,
    ].find((value): value is string => typeof value === 'string' && value.trim().length > 0)
    setFullName(nameCandidate?.trim() ?? '')
    setCompany(typeof metadata.company === 'string' ? metadata.company : '')
    setSchool(typeof metadata.school === 'string' ? metadata.school : '')
  }, [session?.user.id])

  const refreshData = async () => {
    if (!supabase || !session?.user.id || !productCode) return
    const [entitlements, orderResult] = await Promise.all([
      supabase.from('entitlements').select('product_code,expires_at')
        .eq('user_id', session.user.id).eq('status', 'active').gt('expires_at', new Date().toISOString())
        .eq('product_code', productCode),
      supabase.from('orders').select('id,product_code,amount_php,status,payment_method,payment_reference,checkout_batch_id,paymongo_checkout_session_id')
        .eq('user_id', session.user.id).eq('product_code', productCode)
        .order('created_at', { ascending: false }).limit(30)
    ])
    if (entitlements.error || orderResult.error) throw new Error('Could not check your current license or payment submissions. Please refresh and try again.')
    setOwned((entitlements.data ?? []) as Entitlement[])
    setOrders((orderResult.data ?? []) as Order[])
    await refreshCloudEntitlements()
  }

  useEffect(() => {
    if (!session || !productCode) return
    let active = true
    void refreshData().catch(error => {
      if (!active) return
      setIsError(true)
      void edgeMessage(error, 'Unable to load the payment status. Please refresh the page.').then(setMessage)
    })
    return () => { active = false }
  }, [session?.user.id, productCode])

  const activeLicense = owned.find(item => item.product_code === productCode && (!item.expires_at || new Date(item.expires_at).getTime() > Date.now()))
  const pendingManualOrder = orders.find(order => ['submitted', 'pending'].includes(order.status) && order.payment_method !== 'PayMongo Checkout')
  const preparingPayMongoOrder = orders.find(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout' && !order.paymongo_checkout_session_id)
  const pendingPayMongoOrder = orders.find(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout' && !!order.paymongo_checkout_session_id)
  const failedPayMongoOrder = orders.find(order => order.status === 'failed' && order.payment_method === 'PayMongo Checkout' && !!order.paymongo_checkout_session_id)
  const unresolvedPayMongoOrder = preparingPayMongoOrder || pendingPayMongoOrder || failedPayMongoOrder

  const submitPayment = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (!supabase || !session || !product) return
    if (!fullName.trim()) {
      setIsError(true)
      setMessage('Please add your full name in Your profile before submitting payment details.')
      return
    }
    if (activeLicense) {
      setIsError(true)
      setMessage('This license is already active for your account. You do not need to purchase this track again.')
      return
    }
    if (pendingManualOrder || unresolvedPayMongoOrder) {
      setIsError(true)
      setMessage('There is already a pending payment for this track. Resolve it before submitting another payment.')
      return
    }
    setBusy(true)
    setIsError(false)
    setMessage('Submitting your payment for manual review…')
    try {
      const { data, error } = await supabase.functions.invoke('submit-manual-payment', {
        body: {
          productCode: product.code,
          licenseTerm,
          paymentMethod,
          paymentReference: reference,
          customerNote: note,
          customerProfile: { fullName: fullName.trim(), company: company.trim(), school: school.trim() }
        }
      })
      if (error) throw new Error(await edgeMessage(error, 'Unable to submit payment. Please try again.'))
      if (data?.error) throw new Error(data.error)
      setReference('')
      setNote('')
      setMessage(`Payment details submitted. Your reference is ${data.order.id}. Please send your payment screenshot to our Facebook page. Access will be enabled after manual verification.`)
      await refreshData()
    } catch (error) {
      setIsError(true)
      setMessage(await edgeMessage(error, 'Unable to submit payment. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const cancelManualRequest = async () => {
    if (!supabase || !pendingManualOrder) return
    setBusy(true)
    setIsError(false)
    setMessage('Cancelling your manual payment review request…')
    try {
      const { data, error } = await supabase.functions.invoke('cancel-payment-review', { body: { orderId: pendingManualOrder.id } })
      if (error) throw new Error(await edgeMessage(error, 'Unable to cancel the request. Please try again.'))
      if (data?.error) throw new Error(data.error)
      await refreshData()
      setMessage('Your manual payment request has been cancelled. You may submit a new one if needed.')
    } catch (error) {
      setIsError(true)
      setMessage(await edgeMessage(error, 'Unable to cancel the request. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const cancelPayMongo = async (order: Order) => {
    if (!supabase) return
    setBusy(true)
    setIsError(false)
    setMessage('Checking the existing PayMongo checkout before switching payment methods…')
    try {
      const { data, error } = await supabase.functions.invoke('cancel-checkout', {
        body: { orderId: order.checkout_batch_id || order.id }
      })
      if (error) throw new Error(await edgeMessage(error, 'Unable to check the existing checkout. Please try again.'))
      if (data?.error) throw new Error(data.error)
      if (data?.status === 'already_paid' || data?.status === 'processing') {
        throw new Error(data.message || 'This payment is already paid or processing. Do not submit another payment.')
      }
      if (data?.status !== 'cancelled') throw new Error('PayMongo did not confirm cancellation. Do not submit a second payment yet.')
      await refreshData()
      setMessage('The existing PayMongo checkout was cancelled. You may now continue with manual payment.')
    } catch (error) {
      setIsError(true)
      setMessage(await edgeMessage(error, 'Unable to cancel the existing checkout. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  const card: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', borderRadius: 12 }
  const field: CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 7, font: 'inherit' }
  const label: CSSProperties = { display: 'block', marginTop: '.9rem' }

  return <div className="screen manual-payment-page" style={{ width: 'min(calc(100% - 2rem), 920px)', maxWidth: 920, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{`
      .manual-payment-page .manual-grid{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:1rem;align-items:start}
      .manual-payment-page .manual-summary{position:sticky;top:84px}
      .manual-payment-page .manual-section-title{display:flex;align-items:center;justify-content:space-between;gap:.8rem;flex-wrap:wrap}
      .manual-payment-page .manual-muted{color:var(--text-muted);font-size:.86rem;line-height:1.5}
      .manual-payment-page .manual-qr{background:#fff;color:#172033;border:1px solid #d7e0ea;border-radius:10px;padding:1rem;text-align:center}
      @media(max-width:760px){.manual-payment-page .manual-grid{grid-template-columns:minmax(0,1fr)}.manual-payment-page .manual-summary{position:static}}
    `}</style>
    <button type="button" onClick={() => navigate('/account?tab=payments')} style={{ color: 'var(--text-muted)', marginBottom: '.65rem' }}>← Back to Bond Store</button>
    <div style={{ marginBottom: '1.1rem' }}>
      <div style={{ color: '#a47e2e', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.14em' }}>MANUAL PAYMENT</div>
      <h1 className="page-title" style={{ textAlign: 'left', margin: '.15rem 0 .3rem' }}>Pay manually with QR</h1>
      <p className="manual-muted" style={{ margin: 0 }}>Send the exact amount, then submit your transaction reference for admin review.</p>
    </div>

    {!authLoaded ? <section style={card}>Checking your Hyperion account…</section>
      : !session ? <section style={card}><h2 style={{ marginTop: 0 }}>Sign in required</h2><p className="manual-muted">Sign in to your Hyperion account before submitting a manual payment.</p><button type="button" className="btn btn-primary" onClick={() => navigate('/account')} style={{ width: '100%' }}>OPEN ACCOUNT / SIGN IN</button></section>
      : !product ? <section style={card}><h2 style={{ marginTop: 0 }}>Choose a reviewer track</h2><p className="manual-muted">The requested track could not be found. Return to Bond Store and choose “Pay manually with QR” on a product.</p><button type="button" className="btn btn-primary" onClick={() => navigate('/account?tab=payments')}>BACK TO BOND STORE</button></section>
      : <>
        {message && <div role="status" style={{ ...card, borderColor: isError ? 'var(--danger, #dc2626)' : 'var(--border)', marginBottom: '1rem', lineHeight: 1.5 }}>{message}</div>}
        {activeLicense ? <section style={{ ...card, borderColor: 'var(--success, #15803d)' }}><h2 style={{ marginTop: 0 }}>License already active</h2><p className="manual-muted">Your {product.label} license is already active{activeLicense.expires_at ? ` until ${new Date(activeLicense.expires_at).toLocaleDateString()}` : ''}.</p><button type="button" className="btn btn-outline" onClick={() => navigate('/account?tab=licenses')}>VIEW MY LICENSES</button></section>
          : pendingManualOrder ? <section style={{ ...card, borderColor: '#d6a33a' }}><h2 style={{ marginTop: 0 }}>Manual payment already submitted</h2><p className="manual-muted">There is already a {pendingManualOrder.status === 'submitted' ? 'payment awaiting review' : 'pending payment'} for {product.label}. Cancel that request before submitting another one.</p><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancelManualRequest()} style={{ width: '100%' }}>CANCEL MANUAL PAYMENT REQUEST</button></section>
           : preparingPayMongoOrder ? <section style={{ ...card, borderColor: '#d6a33a' }}><h2 style={{ marginTop: 0 }}>PayMongo checkout is being prepared</h2><p className="manual-muted">Hyperion is still saving the secure checkout session. Wait a moment and refresh before switching to manual payment, so you don't accidentally pay twice.</p><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void refreshData()} style={{ width: '100%' }}>REFRESH CHECKOUT STATUS</button></section>
           : pendingPayMongoOrder || failedPayMongoOrder ? <section style={{ ...card, borderColor: '#d6a33a' }}><h2 style={{ marginTop: 0 }}>{failedPayMongoOrder ? 'Unresolved PayMongo checkout' : 'PayMongo checkout already open'}</h2><p className="manual-muted">{failedPayMongoOrder ? 'A previous attempt was marked failed, but its provider session is still recorded. Hyperion must verify and close that session before allowing a manual payment.' : 'You have an existing PayMongo checkout for this track. Close it safely before switching to manual payment.'}</p><button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancelPayMongo(failedPayMongoOrder || pendingPayMongoOrder!)} style={{ width: '100%', color: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}>VERIFY &amp; CANCEL PAYMONGO CHECKOUT</button></section>
          : <div className="manual-grid">
            <section style={card}>
              <div className="manual-section-title"><div><h2 style={{ fontSize: '1.1rem', margin: 0 }}>{product.label}</h2><p className="manual-muted" style={{ margin: '.25rem 0 0' }}>{licenseTerm === 'week' ? '7-day' : licenseTerm === 'month' ? '1-month' : '12-month'} reviewer license</p></div><strong style={{ fontSize: '1.25rem' }}>₱{licensePrice}</strong></div>
              <div className="manual-qr" style={{ marginTop: '1rem' }}>
                <h3 style={{ margin: '0 0 .3rem', fontSize: '1rem' }}>QR Ph · MariBank / InstaPay</h3>
                <p style={{ margin: '0 0 .75rem', color: '#4b5563', fontSize: '.85rem' }}>Scan this QR code using your bank or e-wallet app.</p>
                <img src={qrPhImage} alt="MariBank InstaPay QR Ph payment code" style={{ display: 'block', width: 'min(100%, 320px)', height: 'auto', margin: '0 auto', imageRendering: 'pixelated' }} />
                <p style={{ margin: '.75rem 0 0', color: '#4b5563', fontSize: '.82rem' }}>Confirm the recipient and amount in your payment app before sending.</p>
              </div>
              <p className="manual-muted" style={{ marginBottom: 0, marginTop: '.8rem' }}>After sending, keep your transaction reference and payment screenshot. Manual payments require admin review before the license is activated.</p>
            </section>
            <aside className="manual-summary" style={card}>
              <h2 style={{ margin: 0, fontSize: '1.05rem' }}>Submit payment details</h2>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: '.75rem', borderBottom: '1px solid var(--border)', padding: '.8rem 0' }}><span className="manual-muted">{product.label}</span><strong>₱{licensePrice}</strong></div>
              <form onSubmit={submitPayment}>
                <label style={label}>Full name<input required maxLength={160} value={fullName} onChange={e => setFullName(e.target.value)} style={field} /></label>
                <label style={label}>Company (optional)<input maxLength={160} value={company} onChange={e => setCompany(e.target.value)} style={field} /></label>
                <label style={label}>School (optional)<input maxLength={160} value={school} onChange={e => setSchool(e.target.value)} style={field} /></label>
                <label style={label}>Transaction/reference number<input required maxLength={160} value={reference} onChange={e => setReference(e.target.value)} style={field} /></label>
                <label style={label}>Additional notes (optional)<textarea maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} style={field} /></label>
                <a href={facebookPage} target="_blank" rel="noopener noreferrer" className="btn btn-outline" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '.8rem' }}>SEND PAYMENT SCREENSHOT VIA FACEBOOK</a>
                <button type="submit" className="btn btn-primary" disabled={busy || !supabaseConfigured || !reference.trim() || !fullName.trim()} style={{ width: '100%', marginTop: '.8rem' }}>{busy ? 'Submitting…' : 'SUBMIT FOR MANUAL REVIEW'}</button>
              </form>
            </aside>
          </div>}
      </>}
  </div>
}
