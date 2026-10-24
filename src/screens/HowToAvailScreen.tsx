import { useNavigate } from 'react-router-dom'
import { getDeviceToken } from '../lib/deviceId'

export default function HowToAvailScreen() {
  const navigate = useNavigate()

  return (
    <div className="screen">
      <button
        onClick={() => navigate(-1)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 className="page-title">How to Avail a License</h1>
      <p className="subtitle">Offline signed activation keys</p>

      <div className="card" style={{ marginBottom: '1rem' }}>
        <ol style={{ paddingLeft: '1.2rem', lineHeight: 1.7, fontSize: '0.95rem' }}>
          <li style={{ marginBottom: '0.75rem' }}>
            Copy your <strong>Device ID</strong> shown below.
          </li>
          <li style={{ marginBottom: '0.75rem' }}>
            Contact us on Facebook and send your Device ID together with the track / plan you need.
          </li>
          <li style={{ marginBottom: '0.75rem' }}>
            You will receive a signed key (starts with <code>HYPE2-</code>).
          </li>
          <li>
            Open <strong>Activate Key</strong> in the app, paste the key, and activate.
          </li>
        </ol>
      </div>

      <div className="card" style={{ marginBottom: '1.25rem', textAlign: 'center' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          Your Device ID
        </div>
        <div style={{ fontFamily: 'monospace', fontSize: '1.15rem', letterSpacing: 1.5 }}>
          {getDeviceToken()}
        </div>
      </div>

      <a
        href="https://www.facebook.com/hyperionbynhyle/"
        target="_blank"
        rel="noopener noreferrer"
        className="btn btn-primary"
        style={{ width: '100%', textAlign: 'center', marginBottom: '0.75rem' }}
      >
        Contact us on Facebook
      </a>

      <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/activation')}>
        Go to Activate Key
      </button>
    </div>
  )
}
