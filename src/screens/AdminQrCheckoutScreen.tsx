import { useEffect, useRef, useState } from 'react'
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
    </section> : <div className="qr-checkout-grid">
      <section className="qr-checkout-panel">
        <h2>1. Scan and pay</h2>
        <p>Open your preferred bank or e-wallet app, scan this QR Ph code and send the exact amount shown below.</p>
        <div className="qr-checkout-image-wrap">
          <img src="/qr-ph.png" alt="Hyperion's QR Ph payment code" width="320" height="320" />
        </div>
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
