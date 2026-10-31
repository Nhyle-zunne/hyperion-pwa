import { useEffect } from 'react'
import { useSearchParams } from 'react-router-dom'
import { paidProductCodeForTrackId } from '../lib/supabase'
import { useUIStore } from '../stores/uiStore'

export default function PaywallDialog() {
  const { showPaywall, paywallFeature, closePaywall } = useUIStore()
  const [params, setParams] = useSearchParams()
  const trackValue = params.get('purchase_product') || params.get('track') || ''
  const purchaseCode = paidProductCodeForTrackId(trackValue)

  // Any track-scoped paywall becomes the actual product card. The ordinary
  // warning remains only for cases where no specific paid track is known.
  useEffect(() => {
    if (!showPaywall || !purchaseCode) return
    setParams(current => {
      const next = new URLSearchParams(current)
      next.set('purchase', '1')
      next.set('purchase_product', purchaseCode)
      next.set('purchase_term', next.get('purchase_term') || 'year')
      return next
    }, { replace: true })
    closePaywall()
  }, [showPaywall, purchaseCode, setParams, closePaywall])

  if (!showPaywall || purchaseCode) return null

  const goActivate = () => {
    closePaywall()
    window.location.assign('/account')
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: '1rem' }}
      onClick={closePaywall}
    >
      <div className="card" style={{ maxWidth: 360, width: '100%' }} onClick={(event) => event.stopPropagation()}>
        <h2 style={{ fontSize: '1.2rem', marginBottom: '0.75rem' }}>Subscription Required</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
          An active account subscription is required to access {paywallFeature}. Sign in to your account or visit Account to purchase access.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <button className="btn btn-primary" onClick={goActivate}>GO TO ACCOUNT</button>
          <button className="btn btn-outline" onClick={closePaywall}>Cancel</button>
        </div>
      </div>
    </div>
  )
}
