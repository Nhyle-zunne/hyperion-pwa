import { useNavigate } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import ThemeToggle from '../components/ThemeToggle'
import InstallPrompt from '../components/InstallPrompt'

export default function HomeScreen() {
  const navigate = useNavigate()
  const { cloudTrackIds, getRemainingLabel } = useLicenseStore()
  const openPaywall = useUIStore((s) => s.openPaywall)

  const hasAnyLicense = cloudTrackIds.length > 0

  const requireLicense = (feature: string, action: () => void) => {
    if (hasAnyLicense) {
      action()
    } else {
      openPaywall(feature)
    }
  }

  return (
    <div className="screen">
      <header
        style={{
          marginBottom: '1.5rem',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12
        }}
      >
        <div>
          <h1 className="page-title" style={{ fontSize: '1.6rem', marginBottom: 4 }}>
            Hyperion
          </h1>
          <p className="subtitle" style={{ marginBottom: 0 }}>
            Maritime Licensure Reviewer
          </p>
        </div>
        <ThemeToggle />
      </header>

      <InstallPrompt />

      {/* License status card */}
      <div className="card" style={{ marginBottom: '1.25rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div>
            <div style={{ fontWeight: 600, marginBottom: 4 }}>
              {hasAnyLicense ? 'License Active' : 'Free Tier'}
            </div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
              {hasAnyLicense ? getRemainingLabel() : 'Sign in and subscribe to unlock a review track'}
            </div>
          </div>
          <button
            className="btn btn-outline"
            style={{ padding: '0.5rem 0.85rem', fontSize: '0.85rem' }}
            onClick={() => navigate('/account')}
          >
            {hasAnyLicense ? 'View account' : 'View plans'}
          </button>
        </div>
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
          title="Flashcards"
          desc="Flip cards · Knew / Still learning"
          onClick={() => requireLicense('Flashcards', () => navigate('/flashcards'))}
        />
        <ActionCard
          title="Search"
          desc="Find questions by keyword"
          onClick={() => requireLicense('Search', () => navigate('/search'))}
        />
        <ActionCard
          title="Mistakes Vault"
          desc="Review and drill wrong answers"
          onClick={() => navigate('/vault')}
        />
        <ActionCard
          title="History & Progress"
          desc="Sessions, scores, averages"
          onClick={() => navigate('/history')}
        />
        <ActionCard
          title="Study Time"
          desc="Today · week · 14-day chart"
          onClick={() => navigate('/studytime')}
        />
        <ActionCard
          title="Bookmarks"
          desc="Saved questions · practice later"
          onClick={() => navigate('/bookmarks')}
        />
      </div>

      <footer style={{ marginTop: '2rem', paddingTop: '1rem', borderTop: '1px solid var(--border)', fontSize: '0.8rem', color: 'var(--text-muted)', textAlign: 'center', display: 'flex', justifyContent: 'center', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
        <button style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }} onClick={() => navigate('/about')}>About</button>
        <button type="button" onClick={() => navigate('/privacy-policy')} style={{ color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer' }}>Privacy Policy</button>
      </footer>
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
