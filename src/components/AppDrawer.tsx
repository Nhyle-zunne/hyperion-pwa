import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'

const FB = 'https://www.facebook.com/hyperionbynhyle/'

export default function AppDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [accountExpanded, setAccountExpanded] = useState(location.pathname === '/account' || location.pathname.startsWith('/account/') || ['/checkout', '/basket', '/orders', '/manual-payment'].includes(location.pathname))

  useEffect(() => {
    if (location.pathname === '/account' || location.pathname.startsWith('/account/') || ['/checkout', '/basket', '/orders', '/manual-payment'].includes(location.pathname)) {
      setAccountExpanded(true)
    }
  }, [location.pathname])

  useEffect(() => {
    if (open) {
      setMounted(true)
      setClosing(false)
      return
    }
    if (mounted) setClosing(true)
  }, [open])

  const finishClose = () => {
    if (closing && !open) {
      setMounted(false)
      setClosing(false)
    }
  }

  if (!mounted) return null

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
    const targetPath = path?.split('?')[0]
    const targetSearch = path?.includes('?') ? path.slice(path.indexOf('?')) : ''
    const active = Boolean(targetPath && location.pathname === targetPath && (!targetSearch || location.search === targetSearch))
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
      <div className={`drawer-backdrop${closing ? ' closing' : ''}`} onClick={onClose} onAnimationEnd={finishClose} />
      <aside className={`drawer-panel${closing ? ' closing' : ''}`} onAnimationEnd={finishClose}>
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

        <Item label="Study time" path="/studytime" icon="⏱" />
        <Item label="Contact us" external={FB} icon="💬" />

        <div className="drawer-section">Question bank & tools</div>
        <Item label="Search question bank" path="/search" icon="🔍" />
        <Item label="Bookmarked questions" path="/bookmarks" icon="🔖" />
        <Item label="Session log & history" path="/history" icon="📋" />

        <div className="drawer-section">Account & support</div>
        <button type="button" className={`drawer-item${location.pathname === '/account' || location.pathname.startsWith('/account/') || ['/checkout', '/basket', '/orders', '/manual-payment'].includes(location.pathname) ? ' active' : ''}`} onClick={() => setAccountExpanded(value => !value)} aria-expanded={accountExpanded} aria-controls="account-submenu">
          <span style={{ width: 22, textAlign: 'center' }}>👤</span>
          <span style={{ flex: 1, textAlign: 'left' }}>Account & subscriptions</span>
          <span aria-hidden="true" style={{ display: 'inline-block', transform: accountExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms ease' }}>›</span>
        </button>
        <div id="account-submenu" aria-hidden={!accountExpanded} style={{ display: 'grid', gridTemplateRows: accountExpanded ? '1fr' : '0fr', opacity: accountExpanded ? 1 : 0, transform: accountExpanded ? 'translateY(0)' : 'translateY(-5px)', visibility: accountExpanded ? 'visible' : 'hidden', pointerEvents: accountExpanded ? 'auto' : 'none', transition: 'grid-template-rows 260ms cubic-bezier(.2,.7,.2,1), opacity 180ms ease, transform 220ms ease, visibility 260ms', paddingLeft: '1rem' }}>
          <div style={{ overflow: 'hidden', minHeight: 0 }}>
            <Item label="Bond Store" path="/account?tab=payments" icon="🛍️" />
            <Item label="My licenses" path="/account?tab=licenses" icon="🎫" />
            <Item label="Orders & payment history" path="/orders" icon="🧾" />
          </div>
        </div>
        <Item label="Checkout" path="/checkout" icon="🛒" />
        <Item label="About Hyperion" path="/about" icon="ℹ" />

        <div className="drawer-section">Legal & compliance</div>
        <Item label="Terms of use" path="/terms" icon="📄" />
        <Item label="Privacy policy" path="/privacy-policy" icon="🔒" />
      </aside>
    </>
  )
}
