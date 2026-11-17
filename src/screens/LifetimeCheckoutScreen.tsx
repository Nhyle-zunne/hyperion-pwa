import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import AccountSectionTabs from '../components/AccountSectionTabs'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
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
  const [sessionChecked, setSessionChecked] = useState(!supabaseConfigured)
  const [checkoutEnabled, setCheckoutEnabled] = useState<boolean | null>(null)
  const [pendingOrderId, setPendingOrderId] = useState<string | null>(null)
  const [refreshRevision, setRefreshRevision] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [checkoutUrlFallback, setCheckoutUrlFallback] = useState<string | null>(null)

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
      setCheckoutEnabled(null)
      setPendingOrderId(null)
      return
    }
    const client = supabase
    const ownerId = session.user.id
    let active = true
    const refresh = async () => {
      try {
        const [availability, pending] = await Promise.all([
          client.functions.invoke('create-lifetime-checkout', { body: { action: 'status' } }),
          client.from('lifetime_orders').select('id')
            .eq('user_id', ownerId).eq('product_code', product.code).eq('status', 'pending').limit(1)
        ])
        if (!active) return
        setCheckoutEnabled(!availability.error && availability.data?.enabled === true)
        setPendingOrderId(pending.error ? null : pending.data?.[0]?.id ?? null)
      } catch {
        if (active) { setCheckoutEnabled(false); setPendingOrderId(null) }
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

  const checkout = async () => {
    if (!supabase || !session || !product || checkoutEnabled !== true || busy) return
    setBusy(true)
    setMessage('Preparing secure Lifetime checkout…')
    setCheckoutUrlFallback(null)
    try {
      // The client price is only a consistency check. The Edge Function owns
      // the product catalogue, price, purchase identity and payment verification.
      const { data, error } = await supabase.functions.invoke('create-lifetime-checkout', {
        body: {
          action: 'create', productCode: product.code,
          expectedTotalPhp: product.lifetimePrice
        }
      })
      if (error) throw new Error(await checkoutError(error))
      if (typeof data?.error === 'string') throw new Error(data.error)
      if (data?.status === 'paid') {
        navigate('/account?tab=licenses', { replace: true })
        return
      }
      if (data?.status !== 'pending') {
        throw new Error('PayMongo checkout requires verification. Do not pay again; contact Hyperion support.')
      }
      const target = typeof data?.checkoutUrl === 'string' ? new URL(data.checkoutUrl) : null
      if (!target || target.protocol !== 'https:' || target.hostname !== 'checkout.paymongo.com') {
        throw new Error('PayMongo did not return a trusted checkout link.')
      }
      setCheckoutUrlFallback(target.toString())
      setMessage('Opening PayMongo secure checkout…')
      window.location.assign(target.toString())
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Lifetime checkout could not be opened. Try again.')
    } finally {
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
        throw new Error(data?.error || 'PayMongo could not confirm cancellation. Please retry.')
      }
      setPendingOrderId(null)
      setRefreshRevision(value => value + 1)
      setMessage('PayMongo confirmed the pending checkout was cancelled. No license was added.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Could not cancel the pending checkout.')
    } finally {
      setBusy(false)
    }
  }

  const amount = product ? '₱' + product.lifetimePrice.toLocaleString('en-PH') : ''
  const payable = Boolean(product && session && checkoutEnabled === true && !busy)
  return <div className="screen basket-page lifetime-checkout">
    <button type="button" className="lifetime-checkout-back" onClick={() => navigate('/account?tab=payments')}>
      ← Back to Bond Store
    </button>
    <AccountSectionTabs active="checkout" />
    <header className="lifetime-checkout-heading">
      <div>
        <div className="lifetime-checkout-brand">HYPERION MARITIME</div>
        <h1 className="page-title">Checkout</h1>
        <p className="subtitle">Review your selected access before proceeding to payment.</p>
      </div>
      {product && <span className="lifetime-checkout-item-count">1 item to purchase</span>}
    </header>

    {!product ? <section className="lifetime-checkout-card" role="alert">
      <h2>Invalid Lifetime selection</h2>
      <p>Return to Bond Store and select a valid reviewer track.</p>
      <button type="button" className="btn btn-primary" onClick={() => navigate('/account?tab=payments')}>BROWSE TRACKS</button>
    </section> : !session ? <section className="lifetime-checkout-card lifetime-checkout-sign-in">
      <h2>Sign in to continue</h2>
      <p>{sessionChecked ? 'Sign in to complete your selected Lifetime Access purchase.' : 'Checking your saved account session…'}</p>
      <button type="button" className="btn btn-primary" disabled={!supabaseConfigured || busy || !sessionChecked}
        onClick={() => void signInWithGoogle()}>
        {busy ? 'OPENING GOOGLE…' : 'SIGN IN WITH GOOGLE'}
      </button>
    </section> : <>
      {message && <div role="status" className="lifetime-checkout-card lifetime-checkout-message">
        {message}
        {checkoutUrlFallback && <a className="btn btn-primary" href={checkoutUrlFallback}>
          CONTINUE TO PAYMONGO SECURE CHECKOUT
        </a>}
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
          <div className={'lifetime-checkout-action' + (checkoutEnabled === true ? ' is-payable' : '')}>
            <div className="lifetime-checkout-total"><strong>Total due</strong><strong>{amount}</strong></div>
            {checkoutEnabled === true
              ? <button type="button" className="btn btn-primary checkout-pay-button" disabled={!payable}
                  onClick={() => void checkout()}>{busy ? 'PROCESSING…' : 'Checkout'}</button>
              : <div className="lifetime-checkout-disabled" role="status">
                  {checkoutEnabled === null ? 'Checking PayMongo checkout availability…' : 'Lifetime checkout is temporarily unavailable.'}
                </div>}
          </div>
          <div className="lifetime-checkout-payment-method">QR Ph</div>
          <p className="lifetime-checkout-muted lifetime-checkout-footer">
            Access activates after PayMongo confirms this purchase.
          </p>
        </aside>
      </div>
    </>}
  </div>
}
