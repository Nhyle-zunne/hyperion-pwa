import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { getDeviceCodeDisplay, getDeviceToken, formatDeviceCode } from '../lib/deviceId'

export default function ActivationScreen() {
  const navigate = useNavigate()
  const activateKey = useLicenseStore((s) => s.activateKey)
  const [key, setKey] = useState('')
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null)
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const deviceCode = getDeviceCodeDisplay()
  const rawToken = getDeviceToken()

  const copyDeviceCode = async () => {
    try {
      await navigator.clipboard.writeText(deviceCode)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* ignore */
    }
  }

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
        type="button"
        onClick={() => navigate(-1)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 className="page-title">Activate Key</h1>
      <p className="subtitle">
        Paste your offline signed key (HYPE2-…). It only works on this browser/device.
      </p>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          1. Copy this device code → send to seller / paste into Key Tool
        </label>
        <div
          style={{
            fontFamily: 'monospace',
            fontSize: '0.95rem',
            letterSpacing: 0.5,
            padding: '0.75rem',
            background: 'var(--bg-elevated)',
            borderRadius: 8,
            textAlign: 'center',
            wordBreak: 'break-all',
            lineHeight: 1.4
          }}
        >
          {deviceCode}
        </div>
        <div
          style={{
            marginTop: 6,
            fontSize: '0.75rem',
            color: 'var(--text-muted)',
            textAlign: 'center',
            fontFamily: 'monospace'
          }}
        >
          Binding ID: {formatDeviceCode(rawToken)} · {rawToken}
        </div>
        <button
          type="button"
          className="btn btn-outline"
          style={{ width: '100%', marginTop: 8, fontSize: '0.85rem' }}
          onClick={copyDeviceCode}
        >
          {copied ? 'Copied' : 'Copy device code'}
        </button>
      </div>

      <div style={{ marginBottom: '1rem' }}>
        <label style={{ display: 'block', fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 6 }}>
          2. Paste activation key from Key Tool
        </label>
        <textarea
          className="input"
          placeholder="HYPE2-XXXXXXXX-XXXXXXXX-…"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          rows={3}
          autoCapitalize="characters"
          autoCorrect="off"
          spellCheck={false}
          style={{ resize: 'vertical', minHeight: 88, fontFamily: 'monospace', fontSize: '0.85rem' }}
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
            fontSize: '0.9rem',
            lineHeight: 1.45
          }}
        >
          {status.message}
        </div>
      )}

      <button
        type="button"
        className="btn btn-primary"
        style={{ width: '100%' }}
        onClick={handleActivate}
        disabled={loading || !key.trim()}
      >
        {loading ? 'Verifying…' : 'ACTIVATE KEY'}
      </button>

      <div className="card" style={{ marginTop: '1.25rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
        <div style={{ fontWeight: 600, color: 'var(--text)', marginBottom: 6 }}>Tips if activation fails</div>
        <ul style={{ marginLeft: '1.1rem', lineHeight: 1.55 }}>
          <li>Use the same browser where you copied the device code (don’t clear site data).</li>
          <li>In Key Tool, paste the full device code including HYPE-… (model).</li>
          <li>Paste the entire HYPE2- key with no missing characters.</li>
          <li>Key must be signed with the same hyperion_signing_key.hykey that matches this app.</li>
        </ul>
      </div>

      <p style={{ marginTop: '1.25rem', fontSize: '0.85rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        Need a key?{' '}
        <a href="https://www.facebook.com/hyperionbynhyle/" target="_blank" rel="noopener noreferrer">
          Contact us on Facebook
        </a>
      </p>
    </div>
  )
}
