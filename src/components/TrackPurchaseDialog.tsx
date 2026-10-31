import { useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { LICENSE_TERMS, PAID_PRODUCTS, priceForTerm, supabase, supabaseConfigured } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

const TRACK_TO_PRODUCT: Record<string, PaidTrack> = {
  oic_nw: 'oic_nw',
  gmdss: 'gmdss',
  engine_ew: 'engine_ew',
  deck_mgt: 'deck_mgt',
  engine_mgt: 'engine_mgt',
}

function validTerm(value: string | null): LicenseTerm {
  return value === 'week' || value === 'month' || value === 'year' ? value : 'year'
}

function safeError(error: unknown): string {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      // Edge-function errors are intentionally summarized without exposing backend internals.
      return 'Checkout could not be prepared. Please retry or use the manual payment option.'
    }
  }
  return error instanceof Error && error.message && !/supabase|functions|jwt|fetch failed/i.test(error.message)
    ? error.message
    : 'The request could not be completed. Please try again.'
}

export default function TrackPurchaseDialog() {
  const location = useLocation()
  const [params, setParams] = useSearchParams()
  const refreshCloudEntitlements = useLicenseStore(state => state.refreshCloudEntitlements)
  const [session, setSession] = useState<Session | null>(null)
  const [term, setTerm] = useState<LicenseTerm>(() => validTerm(params.get('purchase_term')))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [messageIsError, setMessageIsError] = useState(false)
  const [checkoutEnabled, setCheckoutEnabled] = useState<boolean | null>(null)
  const [paymentVerified, setPaymentVerified] = useState(false)
  const handledOrder = useRef<string | null>(null)

  const productCode = TRACK_TO_PRODUCT[params.get('track') || 'oic_nw']
  const product = useMemo(() => PAID_PRODUCTS.find(item => item.code === productCode), [productCode])
  const isOpen = location.pathname === '/practice' && params.get('purchase') === '1' && Boolean(product)

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      return
    }
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    setTerm(validTerm(params.get('purchase_term')))
  }, [params])

  useEffect(() => {
    let active = true
    if (!isOpen || !session?.user.id || !supabase) {
      setCheckoutEnabled(null)
      return
    }
    void supabase.functions.invoke('create-checkout', { body: { action: 'status' } }).then(({ data, error }) => {
      if (!active) return
      setCheckoutEnabled(!error && data?.action === 'status' && data?.enabled === true)
    }).catch(() => {
      if (active) setCheckoutEnabled(false)
    })
    return () => { active = false }
  }, [isOpen, session?.user.id])

  useEffect(() => {
    const orderId = params.get('order_id')
    const payment = params.get('payment')
    if (!isOpen || !session?.user.id || !supabase || !orderId || !payment || handledOrder.current === orderId) return
    handledOrder.current = orderId
    let active = true
    setBusy(true)
    setMessage(payment === 'success' ? 'Verifying your payment securely with PayMongo…' : 'You returned from PayMongo. No payment has been confirmed.')
    setMessageIsError(false)
    if (payment === 'cancelled') {
      setBusy(false)
      return
    }
    void supabase.functions.invoke('verify-checkout', { body: { orderId } }).then(async ({ data, error }) => {
      if (!active) return
      if (!error && data?.status === 'paid') {
        await refreshCloudEntitlements()
        if (!active) return
        setPaymentVerified(true)
        setMessage('Payment confirmed. Your track license has been activated.')
        setMessageIsError(false)
      } else {
        setMessage(typeof data?.message === 'string' ? data.message : 'PayMongo has not confirmed this payment yet. Do not pay again; check your Orders & Payment History.')
        setMessageIsError(Boolean(error))
      }
    }).catch(() => {
      if (active) {
        setMessage('Payment verification is temporarily unavailable. Do not pay again; retry verification from Orders & Payment History.')
        setMessageIsError(true)
      }
    }).finally(() => {
      if (active) setBusy(false)
    })
    return () => { active = false }
  }, [isOpen, session?.user.id, params.get('order_id'), params.get('payment')])

  const updateTerm = (nextTerm: LicenseTerm) => {
    setTerm(nextTerm)
    setParams(current => {
      const next = new URLSearchParams(current)
      next.set('purchase_term', nextTerm)
      return next
    }, { replace: true })
  }

  const close = () => {
    setParams(current => {
      const next = new URLSearchParams(current)
      ;['purchase', 'purchase_term', 'payment', 'order_id', 'product_code'].forEach(key => next.delete(key))
      return next
    }, { replace: true })
    setMessage('')
    setPaymentVerified(false)
    handledOrder.current = null
  }

  const signIn = async () => {
    if (!supabase) {
      setMessage('Sign-in is temporarily unavailable. Please try again later.')
      setMessageIsError(true)
      return
    }
    const returnParams = new URLSearchParams(params)
    returnParams.set('purchase', '1')
    returnParams.set('purchase_term', term)
    const returnTo = `${location.pathname}?${returnParams.toString()}`
    try {
      localStorage.setItem('hyperion-oauth-return-to', JSON.stringify({
        path: returnTo,
        startedAt: Date.now(),
        mode: 'redirect',
      }))
      setBusy(true)
      const { error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://hyperionmaritime.org/auth/callback',
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) throw error
    } catch {
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* Ignore storage cleanup errors. */ }
      setBusy(false)
      setMessage('Google sign-in could not be started. Please try again.')
      setMessageIsError(true)
    }
  }

  const buyNow = async () => {
    if (!supabase || !session || !product) return
    setBusy(true)
    setMessage('Preparing your secure checkout…')
    setMessageIsError(false)
    try {
      const status = await supabase.functions.invoke('create-checkout', { body: { action: 'status' } })
      if (status.error || status.data?.action !== 'status' || status.data?.enabled !== true) {
        setCheckoutEnabled(false)
        throw new Error('PayMongo checkout is currently unavailable. You can use the track-specific manual payment option.')
      }
      const returnParams = new URLSearchParams(params)
      returnParams.set('purchase', '1')
      returnParams.set('purchase_term', term)
      returnParams.delete('payment')
      returnParams.delete('order_id')
      returnParams.delete('product_code')
      const returnTo = `${location.pathname}?${returnParams.toString()}`
      const { data, error } = await supabase.functions.invoke('create-checkout', {
        body: { items: [{ productCode: product.code, term }], returnTo },
      })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      if (data?.alreadyProcessing === true) {
        setMessage('A payment for this track is already processing. Please check Orders & Payment History before starting another payment.')
        return
      }
      const url = typeof data?.checkoutUrl === 'string' ? new URL(data.checkoutUrl) : null
      if (!url || url.protocol !== 'https:' || url.hostname !== 'checkout.paymongo.com') {
        throw new Error('PayMongo did not return a valid secure checkout link.')
      }
      window.location.assign(url.toString())
    } catch (error) {
      setMessage(safeError(error))
      setMessageIsError(true)
    } finally {
      setBusy(false)
    }
  }

  if (!isOpen || !product) return null

  const selectedPrice = priceForTerm(product, term)
  const manualPaymentUrl = `/manual-payment?product=${encodeURIComponent(product.code)}&term=${term}`

  return (
    <div
      role="presentation"
      onClick={() => { if (!busy) close() }}
      style={{ position: 'fixed', inset: 0, zIndex: 12000, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(0,0,0,.76)', overflowY: 'auto' }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-purchase-title"
        onClick={event => event.stopPropagation()}
        style={{ width: 'min(100%, 480px)', maxHeight: 'min(90vh, 760px)', overflowY: 'auto', boxSizing: 'border-box', padding: '1.2rem', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: '0 24px 70px rgba(0,0,0,.45)' }}
      >
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: '.8rem' }}>
          <div>
            <div style={{ color: 'var(--accent)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.14em' }}>HYPERION BOND STORE</div>
            <h2 id="track-purchase-title" style={{ margin: '.35rem 0 .2rem', fontSize: '1.25rem' }}>Unlock {product.label}</h2>
            <p style={{ margin: 0, color: 'var(--text-muted)', fontSize: '.88rem', lineHeight: 1.5 }}>Choose a license for this track to access all Practice All Questions content and offline downloads.</p>
          </div>
          <button type="button" aria-label="Close purchase dialog" disabled={busy} onClick={close} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', fontSize: '1.5rem', lineHeight: 1, padding: '.1rem .25rem' }}>×</button>
        </div>

        {paymentVerified ? (
          <div style={{ marginTop: '1.2rem', padding: '1rem', border: '1px solid var(--border)', background: 'var(--bg-elevated)', textAlign: 'center' }}>
            <div aria-hidden="true" style={{ width: 54, height: 54, margin: '0 auto .7rem', display: 'grid', placeItems: 'center', borderRadius: '50%', background: 'rgba(20,125,67,.14)', color: '#16834a', fontSize: '2rem', fontWeight: 900 }}>✓</div>
            <h3 style={{ margin: '0 0 .45rem' }}>License activated</h3>
            <p style={{ margin: '0 0 1rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>Your {product.label} access is ready. Return to Practice All Questions and start your session.</p>
            <button type="button" className="btn btn-primary" onClick={close} style={{ width: '100%', minHeight: 46 }}>CONTINUE TO PRACTICE</button>
          </div>
        ) : (
          <>
            <div style={{ display: 'grid', gap: '.55rem', marginTop: '1.1rem' }}>
              {LICENSE_TERMS.map(option => {
                const price = priceForTerm(product, option.code)
                const selected = term === option.code
                return (
                  <button
                    key={option.code}
                    type="button"
                    aria-pressed={selected}
                    onClick={() => updateTerm(option.code)}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.8rem', width: '100%', padding: '.85rem', textAlign: 'left', border: selected ? '2px solid var(--accent)' : '1px solid var(--border)', background: selected ? 'var(--accent-soft)' : 'var(--bg-elevated)', color: 'var(--text)', cursor: 'pointer' }}
                  >
                    <span style={{ display: 'flex', alignItems: 'center', gap: '.65rem' }}>
                      <span aria-hidden="true" style={{ width: 17, height: 17, borderRadius: '50%', border: selected ? '5px solid var(--accent)' : '1px solid var(--text-muted)', boxSizing: 'border-box', flexShrink: 0 }} />
                      <span><strong style={{ display: 'block' }}>{option.label}</strong><small style={{ color: 'var(--text-muted)' }}>{option.durationLabel} access</small></span>
                    </span>
                    <strong style={{ fontSize: '1.05rem' }}>₱{price}</strong>
                  </button>
                )
              })}
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.8rem', marginTop: '1rem', paddingTop: '.85rem', borderTop: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--text-muted)', fontWeight: 750 }}>Total due</span>
              <strong style={{ fontSize: '1.5rem' }}>₱{selectedPrice}</strong>
            </div>
            {message && <div role="status" aria-live="polite" style={{ marginTop: '.8rem', padding: '.7rem', border: '1px solid var(--border)', color: messageIsError ? 'var(--danger, #dc2626)' : 'var(--text)', fontSize: '.85rem', lineHeight: 1.5 }}>{message}</div>}
            {!session ? (
              <div style={{ marginTop: '1rem' }}>
                <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', lineHeight: 1.5 }}>Sign in with Google to attach this purchase to your Hyperion account. You will return to this same purchase popup after signing in.</p>
                <button type="button" className="btn btn-primary" disabled={!supabaseConfigured || busy} onClick={() => void signIn()} style={{ width: '100%', minHeight: 48 }}>{busy ? 'PLEASE WAIT…' : 'SIGN IN WITH GOOGLE TO BUY'}</button>
              </div>
            ) : (
              <div style={{ marginTop: '1rem' }}>
                <button type="button" className="btn btn-primary" disabled={busy || checkoutEnabled === false} onClick={() => void buyNow()} style={{ width: '100%', minHeight: 48, background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--btn-primary-text)' }}>{busy ? 'PREPARING CHECKOUT…' : 'BUY NOW · ₱' + selectedPrice}</button>
                {checkoutEnabled === null && <p style={{ margin: '.55rem 0 0', color: 'var(--text-muted)', fontSize: '.76rem', textAlign: 'center' }}>Checking secure checkout availability…</p>}
                {checkoutEnabled === false && <p style={{ margin: '.55rem 0 0', color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.45 }}>Online checkout is temporarily unavailable. <a href={manualPaymentUrl} style={{ color: 'var(--accent)', fontWeight: 850 }}>Continue with manual payment for {product.label}</a>.</p>}
              </div>
            )}
          </>
        )}
        <p style={{ margin: '1rem 0 0', color: 'var(--text-muted)', fontSize: '.72rem', lineHeight: 1.45, textAlign: 'center' }}>Secure payment is completed on PayMongo. Your license activates only after payment is verified.</p>
      </section>
    </div>
  )
}
