import { useNavigate } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

export default function PaywallDialog() {
  const { paywallFeature, closePaywall } = useUIStore()
  const navigate = useNavigate()

  const goActivate = () => {
    closePaywall()
    navigate('/account')
  }

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.75)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 1000,
        padding: '1rem'
      }}
      onClick={closePaywall}
    >
      <div
        className="card"
        style={{ maxWidth: 360, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h2 style={{ fontSize: '1.2rem', marginBottom: '0.75rem' }}>Subscription Required</h2>
        <p style={{ color: 'var(--text-muted)', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
          An active account subscription is required to access {paywallFeature}. Sign in to your account or visit Account to purchase access.
        </p>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
          <button className="btn btn-primary" onClick={goActivate}>
            GO TO ACCOUNT
          </button>
          <button className="btn btn-outline" onClick={closePaywall}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}
