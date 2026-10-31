import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { LICENSE_TERMS, PAID_PRODUCTS, paidProductCodeForTrackId, priceForTerm, supabase, supabaseConfigured } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

function isPaidTrack(value: string | null): value is PaidTrack {
  return Boolean(value && PAID_PRODUCTS.some(item => item.code === value))
}

function validTerm(value: string | null): LicenseTerm {
  return value === 'week' || value === 'month' || value === 'year' ? value : 'year'
}

function productDescription(code: PaidTrack) {
  switch (code) {
    case 'oic_nw': return 'Deck officer examination preparation and reviewer access.'
    case 'gmdss': return 'GMDSS GOC examination preparation and reviewer access.'
    case 'engine_ew': return 'Engine OIC-EW examination preparation and reviewer access.'
    case 'deck_mgt': return 'Deck management examination preparation and reviewer access.'
    case 'engine_mgt': return 'Engine management examination preparation and reviewer access.'
  }
}

function savedBasket(): { code: PaidTrack; term: LicenseTerm }[] {
  try {
    const raw = localStorage.getItem('hyperion-account-basket-v1')
    const saved: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(saved)) return []
    return saved.flatMap((entry: unknown) => {
      if (typeof entry === 'string' && isPaidTrack(entry)) return [{ code: entry, term: 'year' as const }]
      if (!entry || typeof entry !== 'object') return []
      const item = entry as { code?: unknown; term?: unknown }
      if (typeof item.code !== 'string' || !isPaidTrack(item.code)) return []
      return [{ code: item.code, term: validTerm(typeof item.term === 'string' ? item.term : null) }]
    })
  } catch {
    return []
  }
}

export default function TrackPurchaseDialog() {
  const location = useLocation()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const refreshCloudEntitlements = useLicenseStore(state => state.refreshCloudEntitlements)
  const [session, setSession] = useState<Session | null>(null)
  const [sessionChecked, setSessionChecked] = useState(false)
  const [term, setTerm] = useState<LicenseTerm>(() => validTerm(params.get('purchase_term')))
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [basketItems, setBasketItems] = useState(() => savedBasket())
  const autoCheckoutRef = useRef<string | null>(null)

  const requestedProduct = params.get('purchase_product')
  const productCode = isPaidTrack(requestedProduct)
    ? requestedProduct
    : paidProductCodeForTrackId(params.get('track') || 'oic_nw')
  const product = useMemo(() => PAID_PRODUCTS.find(item => item.code === productCode), [productCode])
  const isOpen = Boolean(product && params.get('purchase') === '1')
  const selectedPrice = product ? priceForTerm(product, term) : 0

  useEffect(() => {
    if (isOpen) setBasketItems(savedBasket())
  }, [isOpen])

  useEffect(() => {
    const syncBasket = () => setBasketItems(savedBasket())
    window.addEventListener('storage', syncBasket)
    window.addEventListener('focus', syncBasket)
    return () => {
      window.removeEventListener('storage', syncBasket)
      window.removeEventListener('focus', syncBasket)
    }
  }, [])

  useEffect(() => {
    setTerm(validTerm(params.get('purchase_term')))
  }, [params])

  useEffect(() => {
    if (!supabase) {
      setSession(null)
      setSessionChecked(true)
      return
    }
    let active = true
    void supabase.auth.getSession().then(({ data }) => {
      if (!active) return
      setSession(data.session)
      setSessionChecked(true)
    }).catch(() => {
      if (active) setSessionChecked(true)
    })
    const { data } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      setSession(nextSession)
      setSessionChecked(true)
    })
    return () => {
      active = false
      data.subscription.unsubscribe()
    }
  }, [])

  const close = useCallback(() => {
    setParams(current => {
      const next = new URLSearchParams(current)
      ;['purchase', 'purchase_product', 'purchase_term', 'purchase_action'].forEach(key => next.delete(key))
      return next
    }, { replace: true })
    setMessage('')
    autoCheckoutRef.current = null
  }, [setParams])

  const proceedToCheckout = useCallback(async () => {
    if (!product || !session?.user || !supabase) return
    setBusy(true)
    setMessage('Checking your track access…')
    try {
      await refreshCloudEntitlements()
      const entitlement = useLicenseStore.getState()
      const alreadyLicensed = entitlement.entitlementsVerified && (
        entitlement.isAllAccessUnlocked ||
        entitlement.cloudTrackIds.includes('ALL') ||
        entitlement.cloudTrackIds.includes(product.trackLabel)
      )
      if (!entitlement.entitlementsVerified) {
        setMessage('We could not verify your current license. Please reconnect and try again before purchasing.')
        return
      }
      if (alreadyLicensed) {
        setMessage('Your license for this track is already active. You do not need to purchase it again.')
        return
      }

      const nextBasket = [...savedBasket().filter(item => item.code !== product.code), { code: product.code, term }]
      try {
        localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(nextBasket))
        setBasketItems(nextBasket)
      } catch {
        setMessage('Your purchase could not be saved on this device. Please enable browser storage and try again.')
        return
      }
      close()
      navigate('/checkout')
    } catch {
      setMessage('Checkout could not be opened. Please reconnect and try again.')
    } finally {
      setBusy(false)
    }
  }, [product, session?.user.id, refreshCloudEntitlements, term, close, navigate])

  const signIn = async () => {
    if (!supabase || !supabaseConfigured || !product) {
      setMessage('Sign-in is temporarily unavailable. Please try again later.')
      return
    }
    const returnParams = new URLSearchParams(params)
    returnParams.set('purchase', '1')
    returnParams.set('purchase_product', product.code)
    returnParams.set('purchase_term', term)
    returnParams.set('purchase_action', 'checkout')
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
    }
  }

  useEffect(() => {
    if (!isOpen || !product || !session?.user.id || params.get('purchase_action') !== 'checkout') return
    const key = `${session.user.id}:${product.code}:${term}`
    if (autoCheckoutRef.current === key) return
    autoCheckoutRef.current = key
    void proceedToCheckout()
  }, [isOpen, product, session?.user.id, params, term, proceedToCheckout])

  if (!isOpen || !product) return null

  const description = productDescription(product.code)
  const handleBuyNow = () => {
    if (!session?.user) {
      void signIn()
      return
    }
    void proceedToCheckout()
  }

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
        style={{ width: 'min(100%, 480px)', maxHeight: 'min(90vh, 760px)', overflowY: 'auto', boxSizing: 'border-box', padding: '1rem', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: '0 24px 70px rgba(0,0,0,.45)' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.6rem', marginBottom: '.65rem' }}>
          <div style={{ color: 'var(--text-muted)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.12em' }}>HYPERION BOND STORE</div>
          <button type="button" aria-label="Close purchase dialog" disabled={busy} onClick={close} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', fontSize: '1.5rem', lineHeight: 1, padding: '.1rem .25rem' }}>×</button>
        </div>
        <article className="account-product-card" style={{ width: '100%', boxSizing: 'border-box' }}>
          <div className="product-art">
            <div aria-hidden="true">{product.code === 'gmdss' ? '📡' : product.code === 'engine_ew' || product.code === 'engine_mgt' ? '⚙️' : '⚓'}</div>
            <span>HYPERION REVIEWER</span>
          </div>
          <div style={{ color: 'var(--text-muted)', fontSize: '.68rem', fontWeight: 900, letterSpacing: '.12em' }}>CHOOSE ACCESS DURATION</div>
          <h2 id="track-purchase-title" style={{ margin: '.35rem 0 0', fontSize: '1.03rem', minHeight: '2.4em', lineHeight: 1.2 }}>{product.label}</h2>
          <div className="product-price">₱{selectedPrice}<span style={{ fontSize: '.72rem', color: 'var(--text-muted)', fontWeight: 650 }}> / {term}</span></div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '.35rem', marginTop: '.6rem' }}>
            {LICENSE_TERMS.map(option => {
              const price = priceForTerm(product, option.code)
              const selected = term === option.code
              return (
                <button
                  key={option.code}
                  type="button"
                  aria-pressed={selected}
                  disabled={busy}
                  onClick={() => {
                    setTerm(option.code)
                    setParams(current => {
                      const next = new URLSearchParams(current)
                      next.set('purchase', '1')
                      next.set('purchase_product', product.code)
                      next.set('purchase_term', option.code)
                      return next
                    }, { replace: true })
                  }}
                  style={{ border: '1px solid ' + (selected ? 'var(--accent)' : 'var(--border)'), borderRadius: 7, padding: '.45rem .2rem', background: selected ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text)', fontSize: '.72rem', fontWeight: 800, cursor: busy ? 'not-allowed' : 'pointer' }}
                >
                  <span style={{ display: 'block' }}>{option.label}</span>
                  <span style={{ display: 'block', marginTop: '.15rem' }}>₱{price}</span>
                </button>
              )
            })}
          </div>
          <div className="product-meta">{description}</div>
          <div className="product-card-spacer" />
          <span className="product-status">AVAILABLE</span>
          <button type="button" className="btn btn-primary" disabled={!sessionChecked || !supabaseConfigured || busy} onClick={handleBuyNow} style={{ width: '100%', marginTop: '.8rem', minHeight: 46, background: '#3abfc0', borderColor: '#3abfc0', color: '#fff' }}>
            {!sessionChecked ? 'PLEASE WAIT…' : busy ? 'PLEASE WAIT…' : 'BUY NOW'}
          </button>
        </article>
        {message && <div role="status" aria-live="polite" style={{ marginTop: '.8rem', padding: '.7rem', border: '1px solid var(--border)', color: 'var(--text)', fontSize: '.85rem', lineHeight: 1.5 }}>{message}</div>}
        {!session?.user && <p style={{ margin: '.75rem .15rem 0', color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.5, textAlign: 'center' }}>Sign in with Google when you press BUY NOW. Your selected track and duration will be kept, then you will go directly to Checkout.</p>}
        <p style={{ margin: '.75rem .15rem 0', color: 'var(--text-muted)', fontSize: '.72rem', lineHeight: 1.45, textAlign: 'center' }}>Secure payment is completed in Hyperion Checkout. Your license activates only after payment is verified.</p>
      </section>
    </div>
  )
}
