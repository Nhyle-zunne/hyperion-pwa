import { useNavigate } from 'react-router-dom'

export default function AboutScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen">
      <button
        onClick={() => navigate(-1)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 className="page-title">About Hyperion</h1>
      <p className="subtitle">Maritime Licensure Reviewer</p>

      <div className="card" style={{ marginBottom: '1rem', lineHeight: 1.6, fontSize: '0.95rem' }}>
        <p style={{ marginBottom: '0.75rem' }}>
          Hyperion is an offline-first reviewer for maritime licensure examinations covering:
        </p>
        <ul style={{ paddingLeft: '1.2rem', marginBottom: '0.75rem' }}>
          <li>OIC-NW Deck (Operational Level)</li>
          <li>GMDSS GOC (Radio Operator)</li>
          <li>OIC-EW Engine (Operational Level)</li>
          <li>Deck Management Level</li>
          <li>Engine Management Level</li>
        </ul>
        <p>
          This Progressive Web App uses account-based subscriptions. Purchase requests are reviewed manually, and approved subscriptions are linked to your Hyperion account.
        </p>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontWeight: 600, marginBottom: 6 }}>Support</div>
        <a
          href="https://www.facebook.com/hyperionbynhyle/"
          target="_blank"
          rel="noopener noreferrer"
          style={{ color: 'var(--accent)' }}
        >
          facebook.com/hyperionbynhyle
        </a>
      </div>

      <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/terms')}>
        Terms of Use
      </button>
    </div>
  )
}
