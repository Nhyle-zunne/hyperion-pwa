import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { getDeviceToken } from '../lib/deviceId'

export default function ActivationScreen() {
  const navigate = useNavigate()
  const activateKey = useLicenseStore((s) => s.activateKey)
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)

  const handleActivate = async () => {
    setLoading(true)
    setStatus(null)
    const result = await activateKey(key)
    setLoading(false)
    if (result.success) {
      setStatus({ type: 'success', message: result.message })
      setTimeout(() => navigate('/license'), 1500)
    } else {
      setStatus({ type: 'error', message: result.message })
    }
  }

  return (
    <div className="screen">
      <button
        onClick={() => navigate(-1)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 className="page-title">Activate Key</h1>
      <p className="subtitle">
        Enter your offline signed activation key (HYPE2-…). Keys are bound to this device.
      </p>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          Device ID (share this when requesting a key)
        </label>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: '1.1rem',
            letterSpacing: 1,
            padding: '0.6rem',
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            textAlign: 'center'
          }}
        >
          {getDeviceToken()}
        </div>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          Activation Key
        </label>
        <input
          className="input"
          placeholder="HYPE2-XXXXXXXX..."
          value={key}
          onChange={(e) => setKey(e.target.value)}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
        />
      </div>

      {status && (
        <div
          style={{
            padding: '0.75rem',
            borderRadius: 8,
            marginBottom: '1rem',
            background: status.type === 'success' ? 'rgba(34,197,94,0.15)' : 'rgba(239,68,68,0.15)',
            color: status.type === 'success' ? 'var(--success)' : 'var(--danger)',
            fontSize: '0.9rem'
          }}
        >
          {status.message}
        </div>
      )}

      <button
        className="btn btn-primary"
        style={{ width: '100%' }}
        onClick={handleActivate}
        disabled={loading || !key.trim()}
      >
        {loading ? 'Verifying…' : 'ACTIVATE KEY'}
      </button>

      <p style={{ marginTop: '1.5rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        Need a key?{' '}
        <a href="https://www.facebook.com/hyperionbynhyle/" target="_blank" rel="noopener noreferrer">
          Contact us on Facebook
        </a>
      </p>
    </div>
  )
}
