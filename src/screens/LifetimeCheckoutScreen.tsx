import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import AccountSectionTabs from '../components/AccountSectionTabs'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import { canPerformPwaPaymentAction, PWA_PURCHASE_PAUSE_NOTICE } from '../lib/pwaPurchaseAvailability'
import { useAdminCheckoutAccess } from '../hooks/useAdminCheckoutAccess'
import { refreshWebsiteCheckoutAvailability, useWebsiteCheckoutAvailability } from '../hooks/useWebsiteCheckoutAvailability'
import './LifetimeCheckoutScreen.css'

async function checkoutError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const body = await context.clone().json() as { error?: unknown }
        if (typeof body.error === 'string' && body.error.trim()) return body.error
      } catch { /* Show the safe fallback below. */ }
    }
  }
  return 'Unable to prepare Lifetime checkout. Please try again.'
}

export default function LifetimeCheckoutScreen() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const product = PAID_PRODUCTS.find(item => item.code === params.get('lifetime_product'))
  const [session, setSession] = useState<Session | null>(null)
  const adminCheckout = useAdminCheckoutAccess(session?.user.id)
  const checkoutAvailability = useWebsiteCheckoutAvailability()
  const canCheckout = adminCheckout.allowed || (checkoutAvailability.checked && canPerformPwaPaymentAction('checkout', checkoutAvailability.enabled))
  const [sessionChecked, setSessionChecked] = useState(!supabaseConfigured)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (active) { setSession(data.session); setSessionChecked(true) }
    }).catch(() => { if (active) setSessionChecked(true) })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (active) { setSession(nextSession); setSessionChecked(true) }
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user.id || !product) {
      setPendingOrderId(null)
      return
    }
    const client = supabase
    const ownerId = session.user.id
    let active = true
    const refresh = async () => {
      try {
        const pending = await client.from('lifetime_orders').select('id')
          .eq('user_id', ownerId).eq('product_code', product.code).eq('status', 'pending').limit(1)
        if (!active) return
        setPendingOrderId(pending.error ? null : pending.data?.[0]?.id ?? null)
      } catch {
        if (active) setPendingOrderId(null)
      }
    }
    void refresh()
    window.addEventListener('focus', refresh)
    return () => { active = false; window.removeEventListener('focus', refresh) }
  }, [session?.user.id, product?.code, refreshRevision])

  const signInWithGoogle = async () => {
    if (!supabase || !product) return
    const path = '/checkout?lifetime_product=' + encodeURIComponent(product.code)
    try {
      localStorage.setItem('hyperion-oauth-return-to', JSON.stringify({
        path, startedAt: Date.now(), mode: 'redirect'
      }))
    } catch { /* The selected Lifetime track remains in the URL. */ }
    setBusy(true)
    setMessage('')
    try {
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://hyperionmaritime.org/auth/callback',
          queryParams: { prompt: 'select_account' }
        }
      })
      if (error) throw error
    } catch {
      setMessage('Google sign-in could not be completed. Please try again.')
      setBusy(false)
    }
  }

  const cancelPending = async () => {
    if (!supabase || !pendingOrderId || busy) return
    setBusy(true)
    setMessage('')
    try {
      const { data, error } = await supabase.functions.invoke('create-lifetime-checkout', {
        body: { action: 'cancel', orderId: pendingOrderId }
      })
      if (error) throw new Error(await checkoutError(error))
      if (data?.status !== 'cancelled') {
        throw new Error(data?.error || 'The earlier checkout provider could not confirm cancellation. Please retry.')
      }
      setPendingOrderId(null)
      setRefreshRevision(value => value + 1)
      setMessage('The earlier pending checkout was cancelled. No license was added.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel the pending checkout.')
    } finally {
      setBusy(false)
    }
  }

  const amount = product ? '₱' + product.lifetimePrice.toLocaleString('en-PH') : ''
  const payable = Boolean(canCheckout && product && !busy && (session || (sessionChecked && supabaseConfigured)))
  return <div className="screen basket-page lifetime-checkout">
    <button type="button" className="lifetime-checkout-back" onClick={() => navigate('/account?tab=payments')}>
      ← Back to Bond Store
    </button>
    <AccountSectionTabs active="checkout" />
    <header className="lifetime-checkout-heading">
      <div>
        <div className="lifetime-checkout-brand">HYPERION MARITIME</div>
        <h1 className="page-title">Checkout</h1>
        <p className="subtitle">{canCheckout ? 'Review this Lifetime plan before QR Ph or bank transfer.' : 'Review your selected access. New Lifetime payments are paused.'}</p>
      </div>
      {product && <span className="lifetime-checkout-item-count">1 item to purchase</span>}
    </header>
    {!canCheckout && checkoutAvailability.checked && <div className="lifetime-checkout-card" role="status">{PWA_PURCHASE_PAUSE_NOTICE}</div>}

    {!product ? <section className="lifetime-checkout-card" role="alert">
      <h2>Invalid Lifetime selection</h2>
      <p>Return to Bond Store and select a valid reviewer track.</p>
      <button type="button" className="btn btn-primary" onClick={() => navigate('/account?tab=payments')}>BROWSE TRACKS</button>
    </section> : <>
    {!session && <section className="lifetime-checkout-card lifetime-checkout-sign-in">
      <h2>Sign in to continue</h2>
      <p>{sessionChecked ? 'Sign in to complete your selected Lifetime Access purchase.' : 'Checking your saved account session…'}</p>
      <button type="button" className="btn btn-primary" disabled={!supabaseConfigured || busy || !sessionChecked}
        onClick={() => void signInWithGoogle()}>
        {busy ? 'OPENING GOOGLE…' : 'SIGN IN WITH GOOGLE'}
      </button>
    </section>}
      {message && <div role="status" className="lifetime-checkout-card lifetime-checkout-message">
        {message}
      </div>}
      <div className="lifetime-checkout-layout">
        <section className="lifetime-checkout-card">
          <h2>Selected track</h2>
          <p className="lifetime-checkout-muted">Only this Lifetime Access purchase will be included in this checkout.</p>
          <div className="lifetime-checkout-item">
            <div>
              <strong>{product.label}</strong>
              <div className="lifetime-checkout-muted">Lifetime Access · No expiration</div>
            </div>
            <strong>{amount}</strong>
          </div>
          {pendingOrderId && <div className="lifetime-checkout-pending">
            <strong>Existing checkout detected</strong>
            <p>Checkout resumes your pending payment. If it was started at an earlier price, cancel it first to use the updated price. Do not pay twice.</p>
            <button type="button" className="btn btn-outline" disabled={busy}
              onClick={() => void cancelPending()}>CANCEL PENDING CHECKOUT</button>
          </div>}
        </section>
        <aside className="lifetime-checkout-card lifetime-checkout-summary">
          <h2>Order summary</h2>
          <div className="lifetime-checkout-summary-line">
            <span>{product.label} (Lifetime)</span>
            <strong>{amount}</strong>
          </div>
          <div className={'lifetime-checkout-action' + (payable ? ' is-payable' : '')}>
            <div className="lifetime-checkout-total"><strong>Total due</strong><strong>{amount}</strong></div>
            {canCheckout
              ? <button type="button" className="btn btn-primary checkout-pay-button" disabled={!payable}
                  onClick={() => void (async () => {
                    if (!session) {
                      await signInWithGoogle()
                      return
                    }
                    if (!adminCheckout.allowed && !(await refreshWebsiteCheckoutAvailability(true))) {
                      setMessage(PWA_PURCHASE_PAUSE_NOTICE)
                      return
                    }
                    navigate(`/checkout/qr?items=${encodeURIComponent(`${product.code}:lifetime`)}`)
                  })()}>CHECKOUT</button>
              : <div className="lifetime-checkout-disabled" role="status">
                  {checkoutAvailability.checked ? PWA_PURCHASE_PAUSE_NOTICE : 'Checking checkout availability…'}
                </div>}
          </div>
          <div className="lifetime-checkout-payment-method">QR Ph or bank transfer</div>
          <p className="lifetime-checkout-muted lifetime-checkout-footer">
            QR Ph and bank transfers are reviewed manually. Access activates only after an administrator verifies payment.
          </p>
        </aside>
      </div>
    </>}
  </div>
}
