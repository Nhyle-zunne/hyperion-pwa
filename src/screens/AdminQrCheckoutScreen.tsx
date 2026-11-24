import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { PAID_PRODUCTS, supabase } from '../lib/supabase'
import { BANK_TRANSFER, formatMessengerPaymentDetails, parseManualCheckoutItems } from '../lib/manualQrCheckout'
import type { ManualCheckoutTerm } from '../lib/manualQrCheckout'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import { refreshWebsiteCheckoutAvailability, useWebsiteCheckoutAvailability } from '../hooks/useWebsiteCheckoutAvailability'
import { PWA_PURCHASE_PAUSE_NOTICE } from '../lib/pwaPurchaseAvailability'
import './AdminQrCheckoutScreen.css'

const messengerUrl = 'https://m.me/HyperionMaritime'
const facebookPageUrl = 'https://www.facebook.com/HyperionMaritime/'

export default function AdminQrCheckoutScreen() {
  const [params] = useSearchParams()
  const [userId, setUserId] = useState<string>()
  const [email, setEmail] = useState('')
  const [authChecked, setAuthChecked] = useState(false)
  const [checkoutChecked, setCheckoutChecked] = useState(false)
  const [previewCode, setPreviewCode] = useState('')
  const [previewTerm, setPreviewTerm] = useState<ManualCheckoutTerm>('month')
  const [copyStatus, setCopyStatus] = useState('')
  const [bankCopyStatus, setBankCopyStatus] = useState('')
  const [readiness, setReadiness] = useState<{ userId: string; selection: string | null; status: 'ready' | 'blocked' | 'error' }>()
  const [checkRevision, setCheckRevision] = useState(0)
  const messageRef = useRef<HTMLTextAreaElement>(null)
  const access = useAdminCheckoutAccess(userId)
  const checkoutAvailability = useWebsiteCheckoutAvailability()

  useEffect(() => {
    let active = true
    void refreshWebsiteCheckoutAvailability(true).finally(() => { if (active) setCheckoutChecked(true) })
    return () => { active = false }
  }, [])

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
    if (!userId || (!checkoutAvailability.enabled && !access.allowed) || !supabase || !items.length) return
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
  }, [userId, access.allowed, checkoutAvailability.enabled, itemQuery, checkRevision])

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

  const copyBank = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text)
      setBankCopyStatus(`${label} copied.`)
    } catch {
      setBankCopyStatus('Clipboard unavailable. Select and copy the bank details above.')
    }
  }

  if (!authChecked || !checkoutChecked || (userId && !checkoutAvailability.enabled && !access.checked)) {
    return <div className="screen qr-checkout-gate" role="status">Checking checkout availability…</div>
  }
  if (!checkoutAvailability.enabled && !access.allowed) {
    return <div className="screen qr-checkout-gate" role="alert">
      <h1>Checkout temporarily unavailable</h1>
      <p>{PWA_PURCHASE_PAUSE_NOTICE}</p>
      <Link className="btn btn-outline" to="/account">BACK TO ACCOUNT</Link>
    </div>
  }
  return <div className="screen qr-checkout-page">
    <div className="qr-checkout-topline">
      <Link to="/checkout" className="qr-checkout-back">← Back to Checkout</Link>
      <span className="qr-checkout-eyebrow">HYPERION MARITIME · MANUAL PAYMENT</span>
    </div>
    <header className="qr-checkout-header">
      <h1 className="page-title">QR Payment Checkout</h1>
      <p>Pay by QR Ph or bank transfer. Send your payment receipt through Messenger for verification.</p>
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

    {!userId ? <section className="qr-checkout-panel qr-checkout-gate">
      <h2>Sign in to checkout</h2>
      <p>Sign in with your Hyperion account before paying so your receipt can be matched to the correct license.</p>
      <Link className="btn btn-primary" to="/checkout">SIGN IN TO CONTINUE</Link>
    </section> : items.length === 0 ? <section className="qr-checkout-panel" role="status">
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
        <h2>1. Pay by QR Ph or bank transfer</h2>
        <div className="qr-checkout-payment-options">
          <div className="qr-checkout-qr-content">
            <div className="qr-checkout-image-wrap">
              <img src="/qr-ph.png" alt="Hyperion's official BPI QR Ph payment code" width="380" height="377" />
              <a className="qr-checkout-download" href="/qr-ph.png" download="hyperion-qr-ph.png" aria-label="Download QR Ph image" title="Download QR Ph image">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3" />
                </svg>
              </a>
            </div>
            <p className="qr-checkout-note">Scan this QR Ph image or download it to pay in your bank app.</p>
          </div>
          <div className="qr-checkout-bank" aria-label="Bank transfer details">
            <p>Or transfer directly to this BPI account:</p>
            <dl>
              <div><dt>Bank</dt><dd>{BANK_TRANSFER.bank}</dd><button type="button" className="qr-checkout-bank-copy" aria-label="Copy bank" onClick={() => void copyBank(BANK_TRANSFER.bank, 'Bank')}>Copy</button></div>
              <div><dt>Account name</dt><dd>{BANK_TRANSFER.accountName}</dd><button type="button" className="qr-checkout-bank-copy" aria-label="Copy account name" onClick={() => void copyBank(BANK_TRANSFER.accountName, 'Account name')}>Copy</button></div>
              <div><dt>Account number</dt><dd>{BANK_TRANSFER.accountNumber}</dd><button type="button" className="qr-checkout-bank-copy" aria-label="Copy account number" onClick={() => void copyBank(BANK_TRANSFER.accountNumber, 'Account number')}>Copy</button></div>
            </dl>
            {bankCopyStatus && <p role="status" className="qr-checkout-copy-status">{bankCopyStatus}</p>}
            <p className="qr-checkout-transfer-notice"><strong>Use InstaPay only. Never use PESONet.</strong> InstaPay transfers are typically credited in real time, helping us verify payments sooner. License activation still requires administrator approval.</p>
            <div className="qr-checkout-total"><span>Amount to transfer</span><strong>₱{totalPhp.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</strong></div>
            <p className="qr-checkout-note qr-checkout-caution">Check the recipient before paying and save your receipt. Payment does not automatically activate a license.</p>
          </div>
        </div>
      </section>

      <section className="qr-checkout-panel">
        <h2>2. Send proof through Messenger</h2>
        <p>Attach your receipt and paste the details below. An administrator must verify payment before activation.</p>
        <label className="qr-checkout-copy-label" htmlFor="qr-checkout-details">Payment details</label>
        <textarea id="qr-checkout-details" ref={messageRef} readOnly value={details} rows={Math.max(9, items.length + 7)} onFocus={event => event.currentTarget.select()} />
        <button type="button" className="btn btn-outline qr-checkout-copy" onClick={() => void copyDetails()}>COPY PAYMENT DETAILS</button>
        {copyStatus && <p role="status" className="qr-checkout-copy-status">{copyStatus}</p>}
        <a className="btn btn-primary qr-checkout-messenger" href={messengerUrl} target="_blank" rel="noopener noreferrer">OPEN MESSENGER TO SEND PROOF</a>
        <p className="qr-checkout-activation-notice"><strong>Activation notice:</strong> Please allow 24–48 hours after submitting your payment receipt for verification and license activation. If still inactive after 48 hours, message our <a href={facebookPageUrl} target="_blank" rel="noopener noreferrer">Hyperion Facebook page</a> to follow up.</p>
        <p className="qr-checkout-note">Never send your password, OTP or full bank account credentials.</p>
      </section>
    </div>}
  </div>
}
