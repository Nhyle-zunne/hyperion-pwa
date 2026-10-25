import { useNavigate, useLocation } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

const FB = 'https://www.facebook.com/hyperionbynhyle/'

export default function AppDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)

  if (!open) return null

  const go = (path: string) => {
    onClose()
    navigate(path)
  }

  const Item = ({
    label,
    path,
    icon,
    external
  }: {
    label: string
    path?: string
    icon: string
    external?: string
  }) => {
    const active = path ? location.pathname === path : false
    return (
      <button
        type="button"
        className={`drawer-item${active ? ' active' : ''}`}
        onClick={() => {
          if (external) {
            window.open(external, '_blank', 'noopener,noreferrer')
            onClose()
          } else if (path) {
            go(path)
          }
        }}
      >
        <span style={{ width: 22, textAlign: 'center' }}>{icon}</span>
        {label}
      </button>
    )
  }

  return (
    <>
      <div className="drawer-backdrop" onClick={onClose} />
      <aside className="drawer-panel">
        <div style={{ padding: '0.5rem 0.75rem 1rem', display: 'flex', alignItems: 'center', gap: 10 }}>
          <img src="/logo.png" alt="Hyperion" width={44} height={44} style={{ borderRadius: 8 }} />
          <div>
            <div style={{ fontWeight: 800, fontSize: '1.15rem', letterSpacing: 0.04 }}>HYPERION</div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', fontWeight: 600 }}>
              MARITIME LICENSURE REVIEWER
            </div>
          </div>
        </div>

        <Item label="Dashboard" path="/" icon="🏠" />

        <button type="button" className="drawer-item" onClick={toggleTheme}>
          <span style={{ width: 22, textAlign: 'center' }}>{theme === 'dark' ? '🌙' : '☀️'}</span>
          <span style={{ flex: 1 }}>Dark mode</span>
          <span
            style={{
              fontSize: '0.7rem',
              fontWeight: 700,
              padding: '0.2rem 0.5rem',
              borderRadius: 6,
              background: theme === 'dark' ? 'var(--accent)' : 'var(--bg-elevated)',
              color: theme === 'dark' ? 'var(--btn-primary-text)' : 'var(--text-muted)'
            }}
          >
            {theme === 'dark' ? 'ON' : 'OFF'}
          </span>
        </button>

        <Item label="Study streak" path="/studytime" icon="🏅" />
        <Item label="Study time" path="/studytime" icon="⏱" />
        <Item label="Contact us (Facebook)" external={FB} icon="💬" />

        <div className="drawer-section">Question bank & tools</div>
        <Item label="Search question bank" path="/search" icon="🔍" />
        <Item label="Bookmarked questions" path="/bookmarks" icon="🔖" />
        <Item label="Session log & history" path="/history" icon="📋" />
        <Item label="Mistakes notebook (vault)" path="/vault" icon="📓" />

        <div className="drawer-section">Account & support</div>
        <Item label="Account & subscriptions" path="/account" icon="👤" />
        <Item label="How to avail a key" path="/howto" icon="❓" />
        <Item label="About Hyperion" path="/about" icon="ℹ" />

        <div className="drawer-section">Legal & compliance</div>
        <Item label="Terms of use" path="/terms" icon="📄" />
      </aside>
    </>
  )
}
