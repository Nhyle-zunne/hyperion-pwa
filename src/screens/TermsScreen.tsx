import { useNavigate } from 'react-router-dom'

export default function TermsScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen">
      <button
        onClick={() => navigate(-1)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 className="page-title">Terms of Use</h1>

      <div className="card" style={{ lineHeight: 1.65, fontSize: '0.9rem', color: 'var(--text-muted)' }}>
        <p style={{ marginBottom: '1rem' }}>
          Hyperion is provided for educational and examination-preparation purposes. Users are responsible
          for verifying all content against official sources.
        </p>
        <p style={{ marginBottom: '1rem' }}>
          Paid review access is linked to your Hyperion account and is available only while the relevant subscription is active. Do not share account credentials or attempt to bypass access controls.
        </p>
        <p style={{ marginBottom: '1rem' }}>
          For license inquiries or support, contact us on Facebook:{' '}
          <a href="https://www.facebook.com/hyperionbynhyle/" target="_blank" rel="noopener noreferrer">
            facebook.com/hyperionbynhyle
          </a>
        </p>
        <p>
          By using this application you agree to these terms.
        </p>
      </div>
    </div>
  )
}
