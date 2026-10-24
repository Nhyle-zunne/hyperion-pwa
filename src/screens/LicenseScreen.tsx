import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { getDeviceCodeDisplay } from '../lib/deviceId'

export default function LicenseScreen() {
  const navigate = useNavigate()
  const {
    isAllAccessUnlocked,
    isOicNwUnlocked,
    isGmdssUnlocked,
    isEngineEwUnlocked,
    isDeckMgtUnlocked,
    isEngineMgtUnlocked,
    offlineLicense,
    getRemainingLabel,
    clearLicense
  } = useLicenseStore()

  const hasAny =
    isAllAccessUnlocked ||
    isOicNwUnlocked ||
    isGmdssUnlocked ||
    isEngineEwUnlocked ||
    isDeckMgtUnlocked ||
    isEngineMgtUnlocked

  const tracks = [
    { name: 'OIC-NW Deck (Operational)', unlocked: isOicNwUnlocked || isAllAccessUnlocked },
    { name: 'GMDSS GOC', unlocked: isGmdssUnlocked || isAllAccessUnlocked },
    { name: 'OIC-EW Engine (Operational)', unlocked: isEngineEwUnlocked || isAllAccessUnlocked },
    { name: 'Deck Management', unlocked: isDeckMgtUnlocked || isAllAccessUnlocked },
    { name: 'Engine Management', unlocked: isEngineMgtUnlocked || isAllAccessUnlocked }
  ]

  return (
    <div className="screen">
      <button
        onClick={() => navigate(-1)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back
      </button>

      <h1 className="page-title">License</h1>
      <p className="subtitle">Offline signed-key status for this device</p>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontWeight: 600, marginBottom: 4 }}>
          {hasAny ? 'Active License' : 'No Active License'}
        </div>
        {offlineLicense ? (
          <>
            <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
              Tier: {offlineLicense.tier} · Duration: {offlineLicense.duration}
            </div>
            <div style={{ fontSize: '0.9rem', color: 'var(--accent)', marginTop: 6 }}>
              {getRemainingLabel()}
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>
              Expires: {new Date(offlineLicense.expiryEpoch).toLocaleDateString(undefined, {
                year: 'numeric',
                month: 'short',
                day: 'numeric'
              })}
            </div>
          </>
        ) : (
          <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)' }}>
            Activate a signed key to unlock tracks.
          </div>
        )}
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontWeight: 600, marginBottom: '0.75rem' }}>Track Access</div>
        {tracks.map((t) => (
          <div
            key={t.name}
            style={{
              display: 'flex',
              justifyContent: 'space-between',
              padding: '0.4rem 0',
              borderBottom: '1px solid var(--border)',
              fontSize: '0.9rem'
            }}
          >
            <span>{t.name}</span>
            <span style={{ color: t.unlocked ? 'var(--success)' : 'var(--text-muted)' }}>
              {t.unlocked ? 'Unlocked' : 'Locked'}
            </span>
          </div>
        ))}
      </div>

      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 4 }}>Device ID</div>
        <div style={{ fontFamily: 'monospace', letterSpacing: 1 }}>{getDeviceCodeDisplay()}</div>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: '0.6rem' }}>
        <button className="btn btn-primary" onClick={() => navigate('/activation')}>
          {hasAny ? 'Activate Another Key' : 'ACTIVATE KEY'}
        </button>
        <button className="btn btn-outline" onClick={() => navigate('/howto')}>
          How to Avail
        </button>
        {hasAny && (
          <button
            className="btn btn-outline"
            style={{ color: 'var(--danger)' }}
            onClick={() => {
              if (confirm('Clear current license from this device?')) clearLicense()
            }}
          >
            Clear License
          </button>
        )}
      </div>
    </div>
  )
}
