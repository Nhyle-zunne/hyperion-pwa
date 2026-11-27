import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useSearchParams } from 'react-router-dom'
import { PAID_PRODUCTS, supabase } from '../lib/supabase'
import { BANK_TRANSFER, parseManualCheckoutItems } from '../lib/manualQrCheckout'
import type { ManualCheckoutTerm } from '../lib/manualQrCheckout'
import { isOpenManualClaim } from '../lib/manualCheckoutClaims'
import type { ManualClaimStatus } from '../lib/manualCheckoutClaims'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import { refreshWebsiteCheckoutAvailability, useWebsiteCheckoutAvailability } from '../hooks/useWebsiteCheckoutAvailability'
import { PWA_PURCHASE_PAUSE_NOTICE } from '../lib/pwaPurchaseAvailability'
import './AdminQrCheckoutScreen.css'
import '../components/ManualCheckoutStatus.css'

const messengerUrl = 'https://m.me/HyperionMaritime'
const facebookPageUrl = 'https://www.facebook.com/HyperionMaritime/'

function ConfirmPaymentSent({ onConfirm, onCancel }: { onConfirm: () => void; onCancel: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    const previousFocus = document.activeElement
    dialog.showModal()
    return () => {
      dialog.close()
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus()
    }
  }, [])

  return createPortal(<dialog ref={dialogRef} className="qr-checkout-confirm" aria-labelledby="qr-confirm-title"
    aria-describedby="qr-confirm-description" onCancel={event => { event.preventDefault(); onCancel() }}>
    <h2 id="qr-confirm-title">Have you already sent the payment?</h2>
    <p id="qr-confirm-description">Select YES only if you have completed the bank transfer or QR payment. Messenger will open so you can send your receipt for verification.</p>
    <div className="qr-checkout-confirm-actions">
      <button type="button" className="btn btn-outline" autoFocus onClick={onCancel}>NO</button>
      <button type="button" className="btn btn-primary" onClick={onConfirm}>YES</button>
    </div>
  </dialog>, document.body)
}

export default function AdminQrCheckoutScreen() {
  const location = useLocation()
  const [params] = useSearchParams()
  const [userId, setUserId] = useState<string>()
  const [email, setEmail] = useState('')
  const [authChecked, setAuthChecked] = useState(false)
  const [checkoutChecked, setCheckoutChecked] = useState(false)
  const [previewCode, setPreviewCode] = useState('')
  const [previewTerm, setPreviewTerm] = useState<ManualCheckoutTerm>('month')
  const [submissionStatus, setSubmissionStatus] = useState('')
  const [submissionError, setSubmissionError] = useState(false)
  const [claimId, setClaimId] = useState('')
  const [claimBusy, setClaimBusy] = useState(false)
  const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false)
  const [bankCopyStatus, setBankCopyStatus] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState('')
  const [readiness, setReadiness] = useState<{ userId: string; selection: string | null; status: 'ready' | 'pending' | 'blocked' | 'error'; reason?: string; pendingClaim?: { id: string; status: ManualClaimStatus; items: { label: string; term: ManualCheckoutTerm }[] } }>()
  const [checkRevision, setCheckRevision] = useState(0)
  const checkoutIdentityRef = useRef('')
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
  checkoutIdentityRef.current = `${userId || ''}|${itemQuery || ''}`
  const items = parseManualCheckoutItems(itemQuery, PAID_PRODUCTS)
  const totalPhp = items.reduce((sum, item) => sum + item.amountPhp, 0)
  const paymentStatus = readiness && readiness.userId === userId && readiness.selection === itemQuery ? readiness.status : 'checking'

  useEffect(() => {
    setConfirmPaymentOpen(false)
    setClaimId('')
    setSubmissionStatus('')
    setSubmissionError(false)
    setClaimBusy(false)
  }, [userId, itemQuery])

  useEffect(() => {
    if (!userId || (!checkoutAvailability.enabled && !access.allowed) || !supabase || !items.length) return
    const client = supabase
    const selectedCodes = items.map(item => item.code)
    let active = true
    setReadiness(undefined)
    void (async () => {
      try {
        const [pendingOrders, failedProviderSessions, pendingLifetimeOrders, lifetimeOwned, playAccess, websiteAccess, openClaims] = await Promise.all([
          client.from('orders').select('id').eq('user_id', userId)
            .in('product_code', selectedCodes).in('status', ['pending', 'submitted']).limit(1),
          client.from('orders').select('id').eq('user_id', userId)
            .in('product_code', selectedCodes).eq('status', 'failed')
            .eq('payment_method', 'PayMongo Checkout')
            .not('paymongo_checkout_session_id', 'is', null).limit(1),
          client.from('lifetime_orders').select('id').eq('user_id', userId)
            .in('product_code', selectedCodes).eq('status', 'pending').limit(1),
          client.from('lifetime_entitlements').select('id').eq('user_id',userId)
            .in('product_code',selectedCodes).eq('status','active').limit(1),
          client.from('google_play_entitlements').select('product_code,expires_at').eq('user_id',userId)
            .in('product_code',selectedCodes).eq('status','active').gt('expires_at',new Date().toISOString()),
          client.from('entitlements').select('product_code,expires_at').eq('user_id',userId)
            .in('product_code',selectedCodes).eq('status','active').gt('expires_at',new Date().toISOString()),
          client.from('manual_checkout_claims').select('id,selection_key,items,status,expires_at').eq('user_id',userId)
            .in('status',['awaiting_proof','pending_verification']),
        ])
        if (!active) return
        const failed = pendingOrders.error || failedProviderSessions.error || pendingLifetimeOrders.error ||
          lifetimeOwned.error || playAccess.error || websiteAccess.error || openClaims.error
        const websiteExpiry = new Map((websiteAccess.data || []).map(row=>[row.product_code,Date.parse(row.expires_at)]))
        const overlappingPlay = (playAccess.data || []).some(row=>Date.parse(row.expires_at)> (websiteExpiry.get(row.product_code) || Date.now()))
        const selectionKey = items.map(item=>`${item.code}:${item.term}`).sort().join(',')
        const existingClaims = (openClaims.data || []).filter(row=>isOpenManualClaim(row))
        const overlappingClaim = existingClaims.find(row => (row.items as {code: string}[]).some(item => selectedCodes.includes(item.code)))
        const full = existingClaims.length >= 3 && !existingClaims.some(row=>row.selection_key===selectionKey)
        const reason = lifetimeOwned.data?.length ? 'This reviewer track already has Lifetime Access. Do not pay again.'
          : overlappingPlay ? 'Your Google Play license already covers this period. Do not make an overlapping website transfer.'
          : full ? 'You already have three open payment submissions. Contact Hyperion on Messenger to resolve one before paying again.'
          : pendingOrders.data?.length || failedProviderSessions.data?.length || pendingLifetimeOrders.data?.length
            ? 'Resolve the earlier unresolved payment for this track before making another transfer.' : undefined
        setReadiness({ userId, selection: itemQuery, status: failed ? 'error' : overlappingClaim ? 'pending' : reason ? 'blocked' : 'ready', reason,
          pendingClaim: overlappingClaim ? { id: overlappingClaim.id, status: overlappingClaim.status as ManualClaimStatus, items: overlappingClaim.items as {label: string; term: ManualCheckoutTerm}[] } : undefined })
      } catch {
        if (active) setReadiness({ userId, selection: itemQuery, status: 'error' })
      }
    })()
    return () => { active = false }
  }, [userId, access.allowed, checkoutAvailability.enabled, itemQuery, checkRevision])

  const submitToMessenger = async () => {
    if (!supabase || !userId || claimBusy || paymentStatus !== 'ready' || !checkoutAvailability.enabled) return
    const checkoutIdentity = checkoutIdentityRef.current
    // Reserve the new tab during the tap; browsers may block popups opened after an async request.
    let messengerTab: Window | null = null
    try {
      messengerTab = window.open('about:blank', '_blank')
      if (messengerTab) {
        messengerTab.opener = null
        messengerTab.document.title = 'Opening Messenger'
        messengerTab.document.body.textContent = 'Preparing your payment request. Messenger will open shortly…'
      }
    } catch { /* The link below is available if a new tab is blocked. */ }
    let messengerOpened = false
    setClaimBusy(true)
    setSubmissionError(false)
    setSubmissionStatus('Recording your request…')
    try {
      const selection = items.map(item => `${item.code}:${item.term}`).join(',')
      const { data, error } = await supabase.functions.invoke('create-manual-checkout-claim', { body: { selection } })
      if (checkoutIdentityRef.current !== checkoutIdentity) return
      if (error || data?.error || typeof data?.id !== 'string') {
        let reason = data?.error
        if (error && typeof error === 'object' && 'context' in error && error.context instanceof Response) {
          try { reason = (await error.context.clone().json() as {error?: unknown}).error } catch { /* Use generic warning. */ }
        }
        throw new Error(typeof reason === 'string' ? reason : 'Could not record your payment request. Please try again.')
      }
      if (data.totalAmountPhp !== totalPhp) throw new Error('Price verification failed. Do not transfer funds; refresh checkout.')
      setClaimId(data.id)
      setReadiness({ userId, selection: itemQuery, status: 'pending', pendingClaim: { id: data.id, status: data.status === 'pending_verification' ? 'pending_verification' : 'awaiting_proof', items } })
      if (messengerTab && !messengerTab.closed) {
        try {
          messengerTab.location.replace(messengerUrl)
          messengerOpened = true
        } catch { /* Keep a direct Messenger link available. */ }
      }
    } catch (error) {
      if (checkoutIdentityRef.current !== checkoutIdentity) return
      const message = error instanceof Error ? error.message : ''
      if (message.startsWith('You already have a pending request')) {
        setReadiness(undefined)
        setCheckRevision(value => value + 1)
        return
      }
      setSubmissionError(true)
      setSubmissionStatus(/^(You have three open submissions|Checkout is temporarily unavailable|Invalid checkout selection|Price verification failed)/.test(message)
        ? message : 'Could not record your request. Check Orders & payment history before retrying. No payment has been confirmed.')
      // The server may have saved a claim before the response was lost. Check
      // persisted status before making the QR and submit button available again.
      setReadiness(undefined)
      setCheckRevision(value => value + 1)
    } finally {
      if (!messengerOpened) messengerTab?.close()
      if (checkoutIdentityRef.current === checkoutIdentity) setClaimBusy(false)
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

  const signInWithGoogle = async () => {
    if (!supabase || signingIn) return
    const requestedReturnTo = `${location.pathname}${location.search}${location.hash}`
    const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/checkout'
    try {
      localStorage.setItem('hyperion-oauth-return-to', JSON.stringify({
        path: returnTo,
        startedAt: Date.now(),
        mode: 'redirect',
      }))
    } catch { /* OAuth callback falls back to the dashboard if storage is blocked. */ }
    setSigningIn(true)
    setSignInError('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://hyperionmaritime.org/auth/callback',
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) throw error
    } catch {
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      setSignInError('Google sign-in could not be started. Please try again.')
      setSigningIn(false)
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
  if (!userId) {
    return <section className="screen qr-checkout-gate" aria-labelledby="qr-checkout-sign-in-title">
      <h1 id="qr-checkout-sign-in-title">Sign in to checkout</h1>
      <p>Sign in with your Google account to view payment instructions and match your receipt to your Hyperion license.</p>
      <button type="button" className="btn btn-primary" disabled={!supabase || signingIn} onClick={() => void signInWithGoogle()}>
        {signingIn ? 'OPENING GOOGLE…' : 'SIGN IN WITH GOOGLE'}
      </button>
      {signInError && <p role="alert">{signInError}</p>}
    </section>
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

    {items.length === 0 ? <section className="qr-checkout-panel" role="status">
      <h2>No valid checkout selection</h2>
      <p>Choose a reviewer track and duration to prepare the payment instructions. No payment has been started.</p>
    </section> : paymentStatus !== 'ready' ? <section className="qr-checkout-panel" role={paymentStatus === 'checking' || paymentStatus === 'pending' ? 'status' : 'alert'}>
      <h2>{paymentStatus === 'pending' ? 'Payment request pending verification' : paymentStatus === 'blocked' ? 'Existing unresolved checkout' : paymentStatus === 'error' ? 'Unable to verify payment status' : 'Checking existing payments…'}</h2>
      <p>{paymentStatus === 'pending'
        ? 'You have already pressed SUBMIT PAYMENT PROOF for this track. If you sent your receipt, allow 24–48 hours for verification and activation. Do not pay again.'
        : paymentStatus === 'blocked'
        ? readiness?.reason || 'Resolve or safely cancel the existing payment for this track before making another QR transfer. Do not pay twice.'
        : paymentStatus === 'error'
          ? 'Hyperion could not check previous payments. No QR code is available until this check succeeds.'
          : 'Verifying there is no pending earlier checkout or manual payment for the selected tracks.'}</p>
      {paymentStatus === 'blocked' && <Link className="btn btn-outline" to="/orders">VIEW ORDERS &amp; PAYMENT HISTORY</Link>}
      {paymentStatus === 'pending' && <>
        <p>If you have not sent proof yet, send your receipt and the Google email shown below in Messenger. Include the request ID when you have more than one purchase so we can match the correct track.</p>
        {readiness?.pendingClaim && <div className="qr-checkout-pending-reference">
          <div><strong>Request ID:</strong> {readiness.pendingClaim.id}</div>
          <div><strong>Reviewer track:</strong> {readiness.pendingClaim.items.map(item => item.label).join(', ')}</div>
        </div>}
        <p className="qr-checkout-account-email"><strong>Your account email:</strong> {email}</p>
        <div className="manual-checkout-actions qr-checkout-pending-actions">
          <Link to="/orders">VIEW PAYMENT HISTORY</Link>
          <a href={messengerUrl} target="_blank" rel="noopener noreferrer">OPEN MESSENGER</a>
          {readiness?.pendingClaim?.status === 'awaiting_proof' && <Link to={`/account?tab=payments&switchClaim=${encodeURIComponent(readiness.pendingClaim.id)}`}>CHANGE REVIEWER DURATION</Link>}
        </div>
      </>}
      {paymentStatus === 'error' && <button type="button" className="btn btn-outline" onClick={() => setCheckRevision(value => value + 1)}>RETRY PAYMENT CHECK</button>}
    </section> : <div className="qr-checkout-grid">
      <section className="qr-checkout-panel">
        <h2>1. Pay by QR Ph or bank transfer</h2>
        <div className="qr-checkout-payment-options">
          <div className="qr-checkout-qr-content">
            <div className="qr-checkout-image-wrap">
              <img src="/qr-ph.png" alt="Hyperion Maritime QR Ph payment code" width="1024" height="1024" />
              <a className="qr-checkout-download" href="/qr-ph.png" download="hyperion-qr-ph.png" aria-label="Download QR Ph image" title="Download QR Ph image">
                <svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                  <path d="M12 3v12m-5-5 5 5 5-5M4 17v3h16v-3" />
                </svg>
              </a>
            </div>
            <p className="qr-checkout-note">Scan this QR Ph image or download it to pay in your bank app.</p>
          </div>
          <div className="qr-checkout-bank" aria-label="Bank transfer details">
            <p>Or transfer directly to this bank account:</p>
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
        <h2>2. Send your payment receipt</h2>
        <p>After paying, tap <strong>SUBMIT PAYMENT PROOF</strong> to open Messenger. Send a screenshot or photo of your receipt and tell us the Google email linked to your Hyperion account so we can match your payment.</p>
        <p className="qr-checkout-account-email"><strong>Your account email:</strong> {email}</p>
        {!checkoutAvailability.enabled && <p role="status" className="qr-checkout-transfer-notice">Website checkout is disabled. Do not transfer money while purchases are paused.</p>}
        <button type="button" className="btn btn-primary qr-checkout-messenger" disabled={claimBusy || Boolean(claimId) || !checkoutAvailability.enabled} onClick={() => setConfirmPaymentOpen(true)}>
          {claimBusy ? 'OPENING MESSENGER…' : 'SUBMIT PAYMENT PROOF'}
        </button>
        {confirmPaymentOpen && <ConfirmPaymentSent onCancel={() => setConfirmPaymentOpen(false)}
          onConfirm={() => { setConfirmPaymentOpen(false); void submitToMessenger() }} />}
        {submissionStatus && <p role={submissionError ? 'alert' : 'status'} aria-live="polite" className={`qr-checkout-copy-status${submissionError ? ' is-error' : ''}`}>{submissionStatus}</p>}
        {claimId && <p className="qr-checkout-note">Your request is pending verification. Pressing the button again is disabled. If you have not sent your receipt, use the Messenger link below.</p>}
        <p className="qr-checkout-activation-notice"><strong>Activation notice:</strong> Please allow 24–48 hours after submitting your payment receipt for verification and license activation. If still inactive after 48 hours, message our <a href={facebookPageUrl} target="_blank" rel="noopener noreferrer">Hyperion Facebook page</a> to follow up.</p>
        <p className="qr-checkout-note">Never send your password, OTP or full bank account credentials.</p>
      </section>
    </div>}
  </div>
}
