import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { LICENSE_TERMS, PAID_PRODUCTS, paidProductCodeForTrackId, priceForTerm, supabase, supabaseConfigured } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'
import './TrackPurchaseDialog.css'

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

  useEffect(() => {
    const syncBasket = () => setBasketItems(savedBasket())
    window.addEventListener('storage', syncBasket)
    window.addEventListener('focus', syncBasket)
    return () => {
      window.removeEventListener('storage', syncBasket)
      window.removeEventListener('focus', syncBasket)
    }
  }, [])

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
  const isInBasket = basketItems.some(item => item.code === product.code)
  const selectedTermDetails = LICENSE_TERMS.find(option => option.code === term)
  const handleBuyNow = () => {
    if (!session?.user) {
      void signIn()
      return
    }
    void proceedToCheckout()
  }

  return (
    <div className="track-purchase-modal" role="presentation" onClick={() => { if (!busy) close() }}>
      <section
        className="track-purchase-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="track-purchase-title"
        onClick={event => event.stopPropagation()}
      >
        <div className="track-purchase-header">
          <div className="track-purchase-eyebrow">HYPERION BOND STORE</div>
          <button type="button" className="track-purchase-close" aria-label="Close purchase dialog" disabled={busy} onClick={close}>×</button>
        </div>

        <article className="track-purchase-card">
          <div className="track-purchase-art">
            <div aria-hidden="true">{product.code === 'gmdss' ? '📡' : product.code === 'engine_ew' || product.code === 'engine_mgt' ? '⚙️' : '⚓'}</div>
            <span className="track-purchase-art-label">HYPERION REVIEWER</span>
          </div>

          <div className="track-purchase-label">CHOOSE ACCESS DURATION</div>
          <h2 id="track-purchase-title" className="track-purchase-title">{product.label}</h2>
          <div className="track-purchase-price">₱{selectedPrice}<small> / {term}</small></div>
          <div className="track-purchase-term-note">{selectedTermDetails?.durationLabel ?? 'Full track'} of full track access</div>

          <div className="track-purchase-plans" role="group" aria-label="Choose license duration">
            {LICENSE_TERMS.map(option => {
              const price = priceForTerm(product, option.code)
              const selected = term === option.code
              return (
                <button
                  key={option.code}
                  type="button"
                  className="track-purchase-plan"
                  aria-pressed={selected}
                  aria-label={option.label + ', ' + option.durationLabel + ', ₱' + price + (selected ? ', selected' : '')}
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
                >
                  {selected && <span className="track-purchase-plan-check" aria-hidden="true">✓</span>}
                  <span>{option.label}</span>
                  <span className="track-purchase-plan-price">₱{price}</span>
                </button>
              )
            })}
          </div>

          <div className="track-purchase-description">{description}</div>
          <span className={'track-purchase-status' + (isInBasket ? ' is-in-basket' : '')} aria-live="polite">
            {isInBasket ? '✓ IN YOUR BASKET' : 'AVAILABLE'}
          </span>
          <button
            type="button"
            className="btn btn-primary track-purchase-buy"
            disabled={!sessionChecked || !supabaseConfigured || busy}
            onClick={handleBuyNow}
          >
            {!sessionChecked ? 'PLEASE WAIT…' : busy ? 'CHECKING LICENSE…' : isInBasket ? 'CONTINUE TO CHECKOUT' : 'BUY NOW'}
          </button>
        </article>

        {message && <div className="track-purchase-message" role="status" aria-live="polite">{message}</div>}
        {!session?.user && <p className="track-purchase-footnote">Sign in with Google when you press BUY NOW. Your selected track and duration will be kept, then you will go directly to Checkout.</p>}
        <p className="track-purchase-footnote">Secure payment is completed in Hyperion Checkout. Your license activates only after payment is verified.</p>
      </section>
    </div>
  )
}
