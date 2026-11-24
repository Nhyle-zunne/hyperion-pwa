import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAID_PRODUCTS, supabase } from '../lib/supabase'
import { formatMessengerPaymentDetails, parseManualCheckoutItems } from '../lib/manualQrCheckout'
import type { ManualCheckoutTerm } from '../lib/manualQrCheckout'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import './AdminQrCheckoutScreen.css'

const messengerUrl = 'https://m.me/HyperionMaritime'

export default function AdminQrCheckoutScreen() {
  const [params] = useSearchParams()
  const [userId, setUserId] = useState<string>()
  const [email, setEmail] = useState('')
  const [authChecked, setAuthChecked] = useState(false)
  const [previewCode, setPreviewCode] = useState('')
  const [previewTerm, setPreviewTerm] = useState<ManualCheckoutTerm>('month')
  const [copyStatus, setCopyStatus] = useState('')
  const [readiness, setReadiness] = useState<{ userId: string; selection: string | null; status: 'ready' | 'blocked' | 'error' }>()
  const [checkRevision, setCheckRevision] = useState(0)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const access = useAdminCheckoutAccess(userId)

  useEffect(() => {
    let active = true
    if (!supabase) { setAuthChecked(true); return }
    let authEventRevision = 0
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      authEventRevision++
      setUserId(session?.user.id)
      setEmail(session?.user.email ?? '')
      setAuthChecked(true)
    })
    const initialRevision = authEventRevision
    void supabase.auth.getUser().then(({ data, error }) => {
      if (!active || authEventRevision !== initialRevision) return
      setUserId(error ? undefined : data.user?.id)
      setEmail(error ? '' : data.user?.email ?? '')
      setAuthChecked(true)
    }).catch(() => { if (active) setAuthChecked(true) })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  const itemQuery = params.has('items') ? params.get('items') : previewCode ? `${previewCode}:${previewTerm}` : null
  const items = parseManualCheckoutItems(itemQuery, PAID_PRODUCTS)
  const totalPhp = items.reduce((sum, item) => sum + item.amountPhp, 0)
  const details = formatMessengerPaymentDetails(email, items)
  const paymentStatus = readiness && readiness.userId === userId && readiness.selection === itemQuery ? readiness.status : 'checking'

  useLayoutEffect(() => {
    if (paymentStatus !== 'ready' || !messageRef.current) return
    const field = messageRef.current
    const sizeToContent = () => {
      field.style.height = 'auto'
      field.style.height = `${field.scrollHeight + 2}px`
    }
    sizeToContent()
    let width = field.clientWidth
    const observer = new ResizeObserver(() => {
      if (field.clientWidth === width) return
      width = field.clientWidth
      sizeToContent()
    })
    observer.observe(field)
    return () => observer.disconnect()
  }, [details, paymentStatus])

  useEffect(() => {
    if (!userId || !access.allowed || !supabase || !items.length) return
    const client = supabase
    const selectedCodes = items.map(item => item.code)
    let active = true
    setReadiness(undefined)
    void (async () => {
      try {
        const [pendingOrders, failedProviderSessions, pendingLifetimeOrders] = await Promise.all([
          client.from('orders').select('id').eq('user_id', userId)
            .in('product_code', selectedCodes).in('status', ['pending', 'submitted']).limit(1),
          client.from('orders').select('id').eq('user_id', userId)
            .in('product_code', selectedCodes).eq('status', 'failed')
            .eq('payment_method', 'PayMongo Checkout')
            .not('paymongo_checkout_session_id', 'is', null).limit(1),
          client.from('lifetime_orders').select('id').eq('user_id', userId)
            .in('product_code', selectedCodes).eq('status', 'pending').limit(1),
        ])
        if (!active) return
        const failed = pendingOrders.error || failedProviderSessions.error || pendingLifetimeOrders.error
        const blocked = pendingOrders.data?.length || failedProviderSessions.data?.length || pendingLifetimeOrders.data?.length
        setReadiness({ userId, selection: itemQuery, status: failed ? 'error' : blocked ? 'blocked' : 'ready' })
      } catch {
        if (active) setReadiness({ userId, selection: itemQuery, status: 'error' })
      }
    })()
    return () => { active = false }
  }, [userId, access.allowed, itemQuery, checkRevision])

  const copyDetails = async () => {
    try {
      await navigator.clipboard.writeText(details)
      setCopyStatus('Payment details copied. Paste them into Messenger and attach your receipt.')
    } catch {
      messageRef.current?.focus()
      messageRef.current?.select()
      setCopyStatus('Select and copy the payment details below, then paste them into Messenger.')
    }
  }

  if (!authChecked || (userId && !access.checked)) {
    return <div className="screen qr-checkout-gate" role="status">Checking administrator access…</div>
  }
  if (!access.allowed) {
    return <div className="screen qr-checkout-gate" role="alert">
      <h1>Checkout preview unavailable</h1>
      <p>This QR checkout is currently restricted to Hyperion administrators. Website purchases remain paused.</p>
      <Link className="btn btn-outline" to="/account">BACK TO ACCOUNT</Link>
    </div>
  }

  return <div className="screen qr-checkout-page">
    <Link to="/checkout" className="qr-checkout-back">← Back to Checkout</Link>
    <header className="qr-checkout-header">
      <span className="qr-checkout-eyebrow">HYPERION MARITIME · ADMIN PREVIEW</span>
      <h1 className="page-title">QR Payment Checkout</h1>
      <p>Pay by QR Ph, then send proof of payment and your purchase details through Messenger.</p>
    </header>

    {!params.has('items') && <section className="qr-checkout-panel qr-checkout-plan-picker" aria-label="Select a product to preview">
      <label>Reviewer track
        <select value={previewCode} onChange={event => setPreviewCode(event.target.value)}>
          <option value="">Select a track</option>
          {PAID_PRODUCTS.map(product => <option key={product.code} value={product.code}>{product.label}</option>)}
        </select>
      </label>
      <label>Access duration
        <select value={previewTerm} onChange={event => setPreviewTerm(event.target.value as ManualCheckoutTerm)}>
          <option value="week">Weekly</option><option value="month">Monthly</option>
          <option value="year">Yearly</option><option value="lifetime">Lifetime</option>
        </select>
      </label>
    </section>}

    {items.length === 0 ? <section className="qr-checkout-panel" role="status">
      <h2>No valid checkout selection</h2>
      <p>Choose a reviewer track and duration to prepare the payment instructions. No payment has been started.</p>
    </section> : paymentStatus !== 'ready' ? <section className="qr-checkout-panel" role={paymentStatus === 'checking' ? 'status' : 'alert'}>
      <h2>{paymentStatus === 'blocked' ? 'Existing unresolved checkout' : paymentStatus === 'error' ? 'Unable to verify payment status' : 'Checking existing payments…'}</h2>
      <p>{paymentStatus === 'blocked'
        ? 'Resolve or safely cancel the existing payment for this track before making another QR transfer. Do not pay twice.'
        : paymentStatus === 'error'
          ? 'Hyperion could not check previous payments. No QR code is available until this check succeeds.'
          : 'Verifying there is no pending PayMongo or manual payment for the selected tracks.'}</p>
      {paymentStatus === 'blocked' && <Link className="btn btn-outline" to="/orders">VIEW ORDERS &amp; PAYMENT HISTORY</Link>}
      {paymentStatus === 'error' && <button type="button" className="btn btn-outline" onClick={() => setCheckRevision(value => value + 1)}>RETRY PAYMENT CHECK</button>}
    </section> : <div className="qr-checkout-grid">
      <section className="qr-checkout-panel">
        <h2>1. Scan and pay</h2>
        <p>Open your preferred bank or e-wallet app, scan this QR Ph code and send the exact amount shown below.</p>
        <div className="qr-checkout-image-wrap">
          <img src="/qr-ph.png" alt="Hyperion's QR Ph payment code" width="320" height="320" />
        </div>
        <p className="qr-checkout-note" role="status">Administrator preview: this is the previous MariBank/InstaPay QR image. Replace it with the intended receiving-account QR before accepting payment.</p>
        <div className="qr-checkout-total"><span>Amount to transfer</span><strong>₱{totalPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
        <p className="qr-checkout-note">Confirm the recipient in your banking app before paying. Save your receipt or screenshot. Sending money does not automatically activate a license.</p>
      </section>

      <section className="qr-checkout-panel">
        <h2>2. Send proof through Messenger</h2>
        <p>Attach your payment receipt and include the following copyable details. Your license is activated only after an administrator verifies the payment.</p>
        <label className="qr-checkout-copy-label" htmlFor="qr-checkout-details">Payment details</label>
        <textarea id="qr-checkout-details" ref={messageRef} readOnly value={details} rows={Math.max(9, items.length + 7)} onFocus={event => event.currentTarget.select()} />
        <button type="button" className="btn btn-outline qr-checkout-copy" onClick={() => void copyDetails()}>COPY PAYMENT DETAILS</button>
        {copyStatus && <p role="status" className="qr-checkout-copy-status">{copyStatus}</p>}
        <a className="btn btn-primary qr-checkout-messenger" href={messengerUrl} target="_blank" rel="noopener noreferrer">OPEN MESSENGER TO SEND PROOF</a>
        <p className="qr-checkout-note">Never send your password, OTP or full bank account credentials.</p>
      </section>
    </div>}
  </div>
}
