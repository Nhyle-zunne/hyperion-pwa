import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, paidProductCodeForTrackId, supabase, supabaseConfigured } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'
import { buyNowCheckoutPath, clearPendingBuyNow, rememberPendingBuyNow } from '../lib/pendingBuyNow'
import BondStoreCardContent from './BondStoreCardContent'
import './TrackPurchaseDialog.css'

function isPaidTrack(value: string | null): value is PaidTrack {
  return Boolean(value && PAID_PRODUCTS.some(item => item.code === value))
}

function validTerm(value: string | null): LicenseTerm {
  return value === 'week' || value === 'month' || value === 'year' ? value : 'year'
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

  useEffect(() => {
    if (isOpen) setBasketItems(savedBasket())
  }, [isOpen, productCode])

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
    const requestedTerm = params.get('purchase_term')
    if (requestedTerm === 'week' || requestedTerm === 'month' || requestedTerm === 'year') {
      setTerm(requestedTerm)
      return
    }
    const savedPlan = productCode
      ? savedBasket().find(item => item.code === productCode)
      : undefined
    setTerm(savedPlan?.term ?? 'year')
  }, [params, productCode])

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

      // BUY NOW is a single-track purchase, not an implicit purchase of older basket items.
      const nextBasket = [{ code: product.code, term }]
      try {
        localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(nextBasket))
        setBasketItems(nextBasket)
      } catch {
        setMessage('Your purchase could not be saved on this device. Please enable browser storage and try again.')
        return
      }
      setMessage('')
      navigate(buyNowCheckoutPath(product.code, term))
    } catch {
      setMessage('Checkout could not be opened. Please reconnect and try again.')
    } finally {
      setBusy(false)
    }
  }, [product, session?.user.id, refreshCloudEntitlements, term, navigate])

  const signIn = async () => {
    if (!supabase || !supabaseConfigured || !product) {
      setMessage('Sign-in is temporarily unavailable. Please try again later.')
      return
    }
    // Stage the exact track and term before leaving for Google. The callback
    // returns directly to Checkout, rather than reopening the paywall and hoping
    // that a second effect resumes the purchase.
    const selection = [{ code: product.code, term }]
    try {
      rememberPendingBuyNow(product.code, term)
    } catch {
      setMessage('Your purchase selection could not be saved. Please enable browser storage and try again.')
      return
    }
    setBasketItems(selection)
    try {
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
      clearPendingBuyNow()
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

  const isInBasket = basketItems.some(item => item.code === product.code)
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

        <article className="track-purchase-card bond-store-card">
          <div className="track-purchase-details-scroll" role="region" aria-label="Plan details and premium features" tabIndex={0}>
            <BondStoreCardContent
              product={product}
              term={term}
              headingLevel="h2"
              headingId="track-purchase-title"
              benefitsId={`store-benefits-popup-${product.code}`}
              disabled={busy}
              showAllBenefits
              onTermChange={nextTerm => {
                setTerm(nextTerm)
                setParams(current => {
                  const next = new URLSearchParams(current)
                  next.set('purchase', '1')
                  next.set('purchase_product', product.code)
                  next.set('purchase_term', nextTerm)
                  return next
                }, { replace: true })
              }}
            />
          </div>
          <div className="track-purchase-actions">
            <span className={`product-status${isInBasket ? ' is-in-basket' : ''}`} aria-live="polite">
              {isInBasket ? '✓ IN YOUR BASKET' : 'AVAILABLE'}
            </span>
            <button
              type="button"
              className="btn btn-primary store-buy-button track-purchase-buy"
              disabled={!sessionChecked || !supabaseConfigured || busy}
              onClick={handleBuyNow}
            >
              {!sessionChecked ? 'PLEASE WAIT…' : busy ? 'CHECKING LICENSE…' : isInBasket ? 'CONTINUE TO CHECKOUT' : 'BUY NOW'}
            </button>
          </div>
        </article>

        {message && <div className="track-purchase-message" role="status" aria-live="polite">{message}</div>}
        <p className="track-purchase-footnote">
          {!session?.user
            ? 'BUY NOW signs you in with Google and keeps your selected plan for Checkout. Access activates after verified payment.'
            : 'Secure Hyperion Checkout · Access activates after verified payment.'}
        </p>
      </section>
    </div>
  )
}
