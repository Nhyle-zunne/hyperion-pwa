import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { getDeviceToken } from '../lib/deviceId'

export default function HomeScreen() {
  const navigate = useNavigate()
  const {
    isAllAccessUnlocked,
    isOicNwUnlocked,
    isGmdssUnlocked,
    isEngineEwUnlocked,
    isDeckMgtUnlocked,
    isEngineMgtUnlocked,
    offlineLicense,
    getRemainingLabel
  } = useLicenseStore()
  const openPaywall = useUIStore((s) => s.openPaywall)

  const hasAnyLicense =
    isAllAccessUnlocked ||
    isOicNwUnlocked ||
    isGmdssUnlocked ||
    isEngineEwUnlocked ||
    isDeckMgtUnlocked ||
    isEngineMgtUnlocked

  const requireLicense = (feature: string, action: () => void) => {
    if (hasAnyLicense) {
      action()
    } else {
      openPaywall(feature)
    }
  }

  return (
    <div className="screen">
      <header style={{ marginBottom: '1.5rem' }}>
        <h1 className="page-title" style={{ fontSize: '1.6rem' }}>
          Hyperion
        </h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>
          Maritime Licensure Reviewer
        </p>
      </header>

      {/* License status card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {hasAnyLicense ? 'License Active' : 'Free Tier'}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {hasAnyLicense ? getRemainingLabel() : 'Activate a key to unlock full access'}
            </div>
          </div>
          <button
            className="btn btn-outline"
            style={{ padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
            onClick={() => navigate('/license')}
          >
            {hasAnyLicense ? 'Details' : 'Activate'}
          </button>
        </div>
        {offlineLicense && (
          <div style={{ marginTop: '0.75rem', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Tier: {offlineLicense.tier} · {offlineLicense.duration}
          </div>
        )}
      </div>

      {/* Main actions */}
      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <ActionCard
          title="Select Track"
          desc="OIC-NW, GMDSS, Engine, Management"
          onClick={() => navigate('/tracks')}
        />
        <ActionCard
          title="Practice / Quiz"
          desc="Timed practice and competence drills"
          onClick={() => requireLicense('Practice', () => navigate('/practice'))}
        />
        <ActionCard
          title="Mock Exams"
          desc="Full timed mock examinations"
          onClick={() => requireLicense('Mock Exams', () => navigate('/mock'))}
        />
        <ActionCard
          title="Drill"
          desc="Rapid-fire · streak tracking · forward-only"
          onClick={() => requireLicense('Drill', () => navigate('/drill'))}
        />
        <ActionCard
          title="History & Progress"
          desc="Sessions, scores, averages"
          onClick={() => navigate('/history')}
        />
        <ActionCard
          title="Bookmarks & Mistakes"
          desc="Saved questions and vault"
          onClick={() => requireLicense('Bookmarks', () => navigate('/bookmarks'))}
        />
      </div>

      <div style={{ marginTop: '2rem', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center' }}>
        Device ID: {getDeviceToken()}
        <br />
        <button
          style={{ color: 'var(--accent)', marginTop: 8, background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => navigate('/howto')}
        >
          How to avail a license
        </button>
        {' · '}
        <button
          style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}
          onClick={() => navigate('/about')}
        >
          About
        </button>
      </div>
    </div>
  )
}

function ActionCard({
  title,
  desc,
  onClick
}: {
  title: string
  desc: string
  onClick: () => void
}) {
  return (
    <button
      className="card"
      onClick={onClick}
      style={{
        textAlign: 'left',
        width: '100%',
        cursor: 'pointer',
        transition: 'background 0.15s'
      }}
    >
      <div style={{ fontWeight: 600, marginBottom: 2 }}>{title}</div>
      <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{desc}</div>
    </button>
  )
}
