import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
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
const proofOpenedPrefix = 'hyperion-payment-proof-opened:'
const proofOpenedKey = (claimId: string) => proofOpenedPrefix + claimId

function proofAlreadyOpened(claimId: string): boolean {
  try { return localStorage.getItem(proofOpenedKey(claimId)) === 'yes' } catch { return false }
}

async function readBlockingPurchaseReason(client: NonNullable<typeof supabase>, userId: string, selectedCodes: string[]): Promise<string | undefined> {
  const [pendingOrders, failedProviderSessions, pendingLifetimeOrders, lifetimeOwned, playAccess, websiteAccess] = await Promise.all([
    client.from('orders').select('id').eq('user_id', userId)
      .in('product_code', selectedCodes).in('status', ['pending', 'submitted']).limit(1),
    client.from('orders').select('id').eq('user_id', userId)
      .in('product_code', selectedCodes).eq('status', 'failed')
      .eq('payment_method', 'PayMongo Checkout')
      .not('paymongo_checkout_session_id', 'is', null).limit(1),
    client.from('lifetime_orders').select('id').eq('user_id', userId)
      .in('product_code', selectedCodes).eq('status', 'pending').limit(1),
    client.from('lifetime_entitlements').select('id').eq('user_id', userId)
      .in('product_code', selectedCodes).eq('status', 'active').limit(1),
    client.from('google_play_entitlements').select('product_code,expires_at').eq('user_id', userId)
      .in('product_code', selectedCodes).eq('status', 'active').gt('expires_at', new Date().toISOString()),
    client.from('entitlements').select('product_code,expires_at').eq('user_id', userId)
      .in('product_code', selectedCodes).eq('status', 'active').gt('expires_at', new Date().toISOString()),
  ])
  if (pendingOrders.error || failedProviderSessions.error || pendingLifetimeOrders.error ||
    lifetimeOwned.error || playAccess.error || websiteAccess.error) {
    throw new Error('Could not verify other purchases. Do not transfer money; check payment history.')
  }
  const websiteExpiry = new Map((websiteAccess.data || []).map(row => [row.product_code, Date.parse(row.expires_at)]))
  const overlappingPlay = (playAccess.data || []).some(row => Date.parse(row.expires_at) > (websiteExpiry.get(row.product_code) || Date.now()))
  return lifetimeOwned.data?.length ? 'This reviewer track already has Lifetime Access. Do not pay again.'
    : overlappingPlay ? 'Your Google Play license already covers this period. Do not make an overlapping website transfer.'
    : pendingOrders.data?.length || failedProviderSessions.data?.length || pendingLifetimeOrders.data?.length
      ? 'Resolve the earlier unresolved payment for this track before making another transfer.' : undefined
}

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
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [userId, setUserId] = useState<string>()
  const [email, setEmail] = useState('')
  const [authChecked, setAuthChecked] = useState(false)
  const [checkoutChecked, setCheckoutChecked] = useState(false)
  const [previewCode, setPreviewCode] = useState('')
  const [previewTerm, setPreviewTerm] = useState<ManualCheckoutTerm>('month')
  const [proofOpenedId, setProofOpenedId] = useState('')
  const [recheckingClaimId, setRecheckingClaimId] = useState('')
  const [confirmPaymentOpen, setConfirmPaymentOpen] = useState(false)
  const [bankCopyStatus, setBankCopyStatus] = useState('')
  const [signingIn, setSigningIn] = useState(false)
  const [signInError, setSignInError] = useState('')
  const [readiness, setReadiness] = useState<{ userId: string; selection: string | null; status: 'ready' | 'pending' | 'blocked' | 'error'; reason?: string; pendingClaim?: { id: string; selectionKey: string; status: ManualClaimStatus; expiresAt: string; items: { label: string; term: ManualCheckoutTerm }[] } }>()
  const [checkRevision, setCheckRevision] = useState(0)
  const openingProofRef = useRef('')
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

  const confirmedCheckout = params.has('items')
  const itemQuery = confirmedCheckout ? params.get('items') : previewCode ? `${previewCode}:${previewTerm}` : null
  checkoutIdentityRef.current = `${userId || ''}|${itemQuery || ''}|${confirmedCheckout}`
  const items = parseManualCheckoutItems(itemQuery, PAID_PRODUCTS)
  const totalPhp = items.reduce((sum, item) => sum + item.amountPhp, 0)
  const selectionKey = items.map(item => `${item.code}:${item.term}`).sort().join(',')
  const paymentStatus = readiness && readiness.userId === userId && readiness.selection === itemQuery ? readiness.status : 'checking'
  const pendingClaim = paymentStatus === 'pending' ? readiness?.pendingClaim : undefined
  const hasOpenedProof = Boolean(pendingClaim && (proofOpenedId === pendingClaim.id || proofAlreadyOpened(pendingClaim.id)))
  const canSubmitProof = paymentStatus === 'pending' && pendingClaim?.selectionKey === selectionKey &&
    pendingClaim.status === 'awaiting_proof' && Date.parse(pendingClaim.expiresAt) > Date.now() &&
    !hasOpenedProof && recheckingClaimId !== pendingClaim.id

  useEffect(() => {
    if (!pendingClaim || pendingClaim.status !== 'awaiting_proof') return
    const remaining = Date.parse(pendingClaim.expiresAt) - Date.now()
    const expire = () => setReadiness(current => current?.pendingClaim?.id === pendingClaim.id
      ? { ...current, status: 'blocked', reason: 'This payment request has expired. Do not transfer money; check payment history.' } : current)
    if (!Number.isFinite(remaining) || remaining <= 0) { expire(); return }
    const timer = window.setTimeout(expire, remaining)
    return () => window.clearTimeout(timer)
  }, [pendingClaim?.id, pendingClaim?.expiresAt, pendingClaim?.status])

  useEffect(() => {
    if (!pendingClaim || !userId || !supabase || paymentStatus !== 'pending' || hasOpenedProof) return
    const client = supabase
    const requestId = pendingClaim.id
    const checkoutIdentity = checkoutIdentityRef.current
    let active = true
    let checking = false
    const recheck = async () => {
      if (checking) return
      checking = true
      setRecheckingClaimId(requestId)
      try {
        const [{ data, error }, blockingReason] = await Promise.all([
          client.from('manual_checkout_claims').select('selection_key,status,expires_at,total_amount_php')
            .eq('user_id', userId).eq('id', requestId).maybeSingle(),
          readBlockingPurchaseReason(client, userId, items.map(item => item.code)),
        ])
        if (!active || checkoutIdentityRef.current !== checkoutIdentity) return
        if (blockingReason || error || !data || data.selection_key !== selectionKey || data.total_amount_php !== totalPhp ||
          data.status !== 'awaiting_proof' || !(Date.parse(data.expires_at) > Date.now())) {
          setReadiness(current => current?.pendingClaim?.id === requestId
            ? { ...current, status: 'blocked', reason: blockingReason || 'This payment request is no longer valid. Do not transfer money; check payment history.' } : current)
        }
      } catch {
        if (active && checkoutIdentityRef.current === checkoutIdentity) {
          setReadiness(current => current?.pendingClaim?.id === requestId
            ? { ...current, status: 'error', reason: 'Could not verify this payment request. Check payment history before transferring money.' } : current)
        }
      } finally {
        checking = false
        if (active) setRecheckingClaimId('')
      }
    }
    const onVisible = () => { if (document.visibilityState === 'visible') void recheck() }
    window.addEventListener('focus', recheck)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      active = false
      window.removeEventListener('focus', recheck)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [pendingClaim?.id, userId, paymentStatus, hasOpenedProof])

  useEffect(() => {
    const syncProof = (event: StorageEvent) => {
      if (event.key?.startsWith(proofOpenedPrefix) && event.newValue === 'yes') {
        setProofOpenedId(event.key.slice(proofOpenedPrefix.length))
      }
    }
    window.addEventListener('storage', syncProof)
    return () => window.removeEventListener('storage', syncProof)
  }, [])

  useEffect(() => {
    setConfirmPaymentOpen(false)
  }, [userId, itemQuery, confirmedCheckout])

  useEffect(() => {
    if (!userId || (!checkoutAvailability.enabled && !access.allowed) || !supabase || !items.length) return
    const client = supabase
    const selectedCodes = items.map(item => item.code)
    let active = true
    setReadiness(undefined)
    void (async () => {
      try {
        const [blockingReason, openClaims] = await Promise.all([
          readBlockingPurchaseReason(client, userId, selectedCodes),
          client.from('manual_checkout_claims').select('id,selection_key,items,status,expires_at,total_amount_php').eq('user_id',userId)
            .in('status',['awaiting_proof','pending_verification']),
        ])
        if (!active) return
        const failed = openClaims.error
        const existingClaims = (openClaims.data || []).filter(row=>isOpenManualClaim(row))
        const overlappingClaim = existingClaims.find(row => (row.items as {code: string}[]).some(item => selectedCodes.includes(item.code)))
        const amountMismatch = overlappingClaim?.selection_key === selectionKey && overlappingClaim.total_amount_php !== totalPhp
        const full = existingClaims.length >= 3 && !existingClaims.some(row=>row.selection_key===selectionKey)
        const reason = blockingReason || (amountMismatch ? 'The saved request amount differs from this checkout. Do not transfer money; check payment history.'
          : full ? 'You already have three open payment submissions. Contact Hyperion on Messenger to resolve one before paying again.'
          : undefined)
        if (failed || overlappingClaim || reason || !confirmedCheckout) {
          setReadiness({ userId, selection: itemQuery, status: failed ? 'error' : reason ? 'blocked' : overlappingClaim ? 'pending' : 'ready', reason,
            pendingClaim: overlappingClaim ? { id: overlappingClaim.id, selectionKey: overlappingClaim.selection_key, status: overlappingClaim.status as ManualClaimStatus, expiresAt: overlappingClaim.expires_at, items: overlappingClaim.items as {label: string; term: ManualCheckoutTerm}[] } : undefined })
          return
        }
        // Entering a selected checkout reserves its request immediately. The
        // database reuses the same open cart and rejects overlapping tracks.
        try {
          const { data, error } = await client.functions.invoke('create-manual-checkout-claim', {
            body: { selection: items.map(item => `${item.code}:${item.term}`).join(',') },
          })
          if (!active) return
          if (error || data?.error || typeof data?.id !== 'string') throw new Error(data?.error || 'Request creation failed')
          if (data.totalAmountPhp !== totalPhp) throw new Error('Price verification failed. Do not transfer funds; refresh checkout.')
          const { data: savedClaim, error: savedError } = await client.from('manual_checkout_claims')
            .select('selection_key,status,expires_at,total_amount_php')
            .eq('user_id', userId).eq('id', data.id).maybeSingle()
          if (!active) return
          if (savedError || !savedClaim || savedClaim.selection_key !== selectionKey ||
            savedClaim.total_amount_php !== totalPhp || savedClaim.status !== 'awaiting_proof' ||
            !(Date.parse(savedClaim.expires_at) > Date.now())) {
            throw new Error('Cannot verify the saved payment request. Do not transfer money; check payment history.')
          }
          setReadiness({ userId, selection: itemQuery, status: 'pending',
            pendingClaim: { id: data.id, selectionKey, status: savedClaim.status, expiresAt: savedClaim.expires_at, items } })
        } catch (error) {
          if (!active) return
          if (error instanceof Error && /^(Price verification failed|Cannot verify the saved payment request)/.test(error.message)) {
            setReadiness({ userId, selection: itemQuery, status: 'error', reason: error.message })
            return
          }
          // An interrupted response can still leave a saved request. Re-read
          // it before ever allowing a second checkout attempt.
          const { data: saved, error: lookupError } = await client.from('manual_checkout_claims')
            .select('id,selection_key,items,status,expires_at,total_amount_php').eq('user_id', userId)
            .in('status', ['awaiting_proof', 'pending_verification'])
          if (!active) return
          const matching = !lookupError && (saved || []).filter(row => isOpenManualClaim(row))
            .find(row => (row.items as {code: string}[]).some(item => selectedCodes.includes(item.code)))
          setReadiness(matching && matching.selection_key === selectionKey && matching.total_amount_php !== totalPhp
            ? { userId, selection: itemQuery, status: 'error', reason: 'The saved request amount differs from this checkout. Do not transfer money; check payment history.' }
            : matching ? { userId, selection: itemQuery, status: 'pending',
              pendingClaim: { id: matching.id, selectionKey: matching.selection_key, status: matching.status as ManualClaimStatus, expiresAt: matching.expires_at,
                items: matching.items as {label: string; term: ManualCheckoutTerm}[] } }
            : { userId, selection: itemQuery, status: 'error', reason: 'Could not record your payment request. Check payment history before retrying.' })
        }
      } catch {
        if (active) setReadiness({ userId, selection: itemQuery, status: 'error' })
      }
    })()
    return () => { active = false }
  }, [userId, access.allowed, checkoutAvailability.enabled, itemQuery, confirmedCheckout, checkRevision])

  const submitToMessenger = async () => {
    if (!supabase || !userId || !canSubmitProof || !pendingClaim || !checkoutAvailability.enabled ||
      openingProofRef.current === pendingClaim.id || proofAlreadyOpened(pendingClaim.id)) return
    const requestId = pendingClaim.id
    const checkoutIdentity = checkoutIdentityRef.current
    openingProofRef.current = requestId
    let messengerTab: Window | null = null
    let opened = false
    try {
      // Reserve the tab during the user gesture so a post-check redirect is not blocked.
      messengerTab = window.open('about:blank', '_blank')
      if (messengerTab) {
        messengerTab.opener = null
        messengerTab.document.title = 'Checking payment request'
        messengerTab.document.body.textContent = 'Checking your pending payment request…'
      }
    } catch { /* The pending-request view retains a direct Messenger link. */ }
    try {
      const [{ data, error }, blockingReason] = await Promise.all([
        supabase.from('manual_checkout_claims').select('selection_key,status,expires_at,total_amount_php')
          .eq('id', requestId).eq('user_id', userId).maybeSingle(),
        readBlockingPurchaseReason(supabase, userId, items.map(item => item.code)),
      ])
      if (checkoutIdentityRef.current !== checkoutIdentity) return
      if (blockingReason) throw new Error(blockingReason)
      if (error || !data) throw new Error('Could not confirm this payment request. Check payment history before retrying.')
      if (data.selection_key !== selectionKey || data.total_amount_php !== totalPhp) {
        throw new Error('The saved payment amount or reviewer selection has changed. Do not transfer money; check payment history.')
      }
      if (data.status !== 'awaiting_proof' || !(Date.parse(data.expires_at) > Date.now())) {
        throw new Error('This payment request is no longer active. Do not transfer money; check payment history.')
      }
      // The request already exists; only now consume the one-time proof action.
      setProofOpenedId(requestId)
      try { localStorage.setItem(proofOpenedKey(requestId), 'yes') } catch { /* This visit still blocks repeat taps. */ }
      if (messengerTab && !messengerTab.closed) {
        try {
          messengerTab.location.replace(messengerUrl)
          opened = true
        } catch { /* The pending-request view retains the OPEN MESSENGER link. */ }
      }
    } catch (error) {
      if (checkoutIdentityRef.current === checkoutIdentity) {
        setReadiness({ userId, selection: itemQuery, status: 'error',
          reason: error instanceof Error ? error.message : 'Could not confirm this payment request. Check payment history before retrying.' })
      }
    } finally {
      if (!opened) messengerTab?.close()
      if (openingProofRef.current === requestId) openingProofRef.current = ''
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
    </section> : paymentStatus !== 'ready' && !canSubmitProof ? <section className="qr-checkout-panel" role={paymentStatus === 'checking' || paymentStatus === 'pending' ? 'status' : 'alert'}>
      <h2>{paymentStatus === 'pending' ? 'Payment request pending verification' : paymentStatus === 'blocked' ? 'Existing unresolved checkout' : paymentStatus === 'error' ? 'Unable to verify payment status' : 'Checking existing payments…'}</h2>
      <p>{paymentStatus === 'pending'
        ? 'Your payment request has already been recorded. If you sent your receipt, allow 24–48 hours for verification and activation. Do not pay again.'
        : paymentStatus === 'blocked'
        ? readiness?.reason || 'Resolve or safely cancel the existing payment for this track before making another QR transfer. Do not pay twice.'
        : paymentStatus === 'error'
          ? readiness?.reason || 'Hyperion could not check previous payments. No QR code is available until this check succeeds.'
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
        {pendingClaim && <p role="status" className="qr-checkout-note">Your payment request is already pending verification (Request ID: {pendingClaim.id}). If you have paid, do not transfer again. Send your receipt through Messenger.</p>}
        <p>After paying, tap <strong>SUBMIT PAYMENT PROOF</strong> to open Messenger. Send a screenshot or photo of your receipt and tell us the Google email linked to your Hyperion account so we can match your payment.</p>
        <p className="qr-checkout-account-email"><strong>Your account email:</strong> {email}</p>
        {!checkoutAvailability.enabled && <p role="status" className="qr-checkout-transfer-notice">Website checkout is disabled. Do not transfer money while purchases are paused.</p>}
        {confirmedCheckout ? <button type="button" className="btn btn-primary qr-checkout-messenger" disabled={!canSubmitProof || !checkoutAvailability.enabled} onClick={() => setConfirmPaymentOpen(true)}>SUBMIT PAYMENT PROOF</button>
          : <button type="button" className="btn btn-primary qr-checkout-messenger" disabled={!checkoutAvailability.enabled} onClick={() => navigate('/checkout/qr?items=' + encodeURIComponent(items.map(item => `${item.code}:${item.term}`).join(',')))}>CONTINUE TO CHECKOUT</button>}
        {confirmPaymentOpen && <ConfirmPaymentSent onCancel={() => setConfirmPaymentOpen(false)}
          onConfirm={() => { setConfirmPaymentOpen(false); void submitToMessenger() }} />}
        <p className="qr-checkout-activation-notice"><strong>Activation notice:</strong> Please allow 24–48 hours after submitting your payment receipt for verification and license activation. If still inactive after 48 hours, message our <a href={facebookPageUrl} target="_blank" rel="noopener noreferrer">Hyperion Facebook page</a> to follow up.</p>
        <p className="qr-checkout-note">Never send your password, OTP or full bank account credentials.</p>
      </section>
    </div>}
  </div>
}
