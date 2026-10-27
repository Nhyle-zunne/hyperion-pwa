import { useEffect, useState } from 'react'
import { useNavigate, useLocation } from 'react-router-dom'
import { useUIStore } from '../stores/uiStore'
import GooglePlayBadge from './GooglePlayBadge'
import DesktopInstallBadge from './DesktopInstallBadge'
import { useInstallPrompt } from '../hooks/useInstallPrompt'

const FB = 'https://www.facebook.com/hyperionbynhyle/'

export default function AppDrawer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const location = useLocation()
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const [mounted, setMounted] = useState(open)
  const [closing, setClosing] = useState(false)
  const [accountExpanded, setAccountExpanded] = useState(location.pathname === '/account' || location.pathname.startsWith('/account/') || ['/checkout', '/basket', '/orders', '/manual-payment'].includes(location.pathname))
  const [installExpanded, setInstallExpanded] = useState(false)
  const [installPlatform, setInstallPlatform] = useState<'android' | 'ios' | 'desktop' | null>(null)
  const [showAndroidInstallHelp, setShowAndroidInstallHelp] = useState(false)
  const [showDesktopInstallHelp, setShowDesktopInstallHelp] = useState(false)
  const [desktopInstallBusy, setDesktopInstallBusy] = useState(false)
  const [showDesktopInstallDialog, setShowDesktopInstallDialog] = useState(false)
  const { canNativePrompt, promptInstall } = useInstallPrompt()

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

  const openDesktopInstall = async () => {
    if (!canNativePrompt) {
      setShowDesktopInstallDialog(true)
      return
    }
    setDesktopInstallBusy(true)
    try {
      const accepted = await promptInstall()
      if (!accepted) setShowDesktopInstallDialog(true)
    } finally {
      setDesktopInstallBusy(false)
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
      <aside className={`drawer-panel${closing ? ' closing' : ''}`} onAnimationEnd={finishClose} style={{ overflowY: 'auto', maxHeight: '100dvh' }}>
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
        <div className="drawer-section">Install Hyperion</div>
        <button type="button" className="drawer-item" onClick={() => setInstallExpanded(value => !value)} aria-expanded={installExpanded} aria-controls="install-guide-submenu">
          <span style={{ width: 22, textAlign: 'center' }}>⬇️</span>
          <span style={{ flex: 1, textAlign: 'left' }}>How to install</span>
          <span aria-hidden="true" style={{ display: 'inline-block', transform: installExpanded ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms ease' }}>›</span>
        </button>
        <div id="install-guide-submenu" aria-hidden={!installExpanded} style={{ display: 'grid', gridTemplateRows: installExpanded ? '1fr' : '0fr', opacity: installExpanded ? 1 : 0, transform: installExpanded ? 'translateY(0)' : 'translateY(-5px)', visibility: installExpanded ? 'visible' : 'hidden', pointerEvents: installExpanded ? 'auto' : 'none', transition: 'grid-template-rows 260ms cubic-bezier(.2,.7,.2,1), opacity 180ms ease, transform 220ms ease, visibility 260ms', paddingLeft: '1rem' }}>
          <div style={{ overflow: 'hidden', minHeight: 0, paddingBottom: installExpanded ? '.25rem' : 0 }}>
            {([
              ['android', 'Android', '🤖'],
              ['ios', 'iOS / Apple', '🍎'],
              ['desktop', 'PC / Desktop', '💻']
            ] as const).map(([key, label, icon]) => (
              <div key={key}>
                <button type="button" className="drawer-item" onClick={() => setInstallPlatform(current => current === key ? null : key)} aria-expanded={installPlatform === key} aria-controls={'install-guide-' + key} style={{ fontSize: '.88rem' }}>
                  <span style={{ width: 22, textAlign: 'center' }}>{icon}</span>
                  <span style={{ flex: 1, textAlign: 'left' }}>{label}</span>
                  <span aria-hidden="true" style={{ display: 'inline-block', transform: installPlatform === key ? 'rotate(90deg)' : 'rotate(0deg)', transition: 'transform 220ms ease' }}>›</span>
                </button>
                {installPlatform === key && <div id={'install-guide-' + key} style={{ margin: '0 .35rem .55rem .6rem', padding: '.7rem', border: '1px solid var(--border)', borderRadius: 8, background: 'var(--bg-elevated)', color: 'var(--text)', fontSize: '.78rem', lineHeight: 1.55 }}>
                  {key === 'android' ? (
                    <>
                      <strong>Option 1: Android app</strong>
                      <div style={{ margin: '.45rem 0 .8rem' }}><GooglePlayBadge /></div>
                      <strong>Option 2: Add website to Home Screen</strong>
                      <button
                        type="button"
                        className="btn btn-primary"
                        style={{ display: 'block', width: '100%', marginTop: '.45rem' }}
                        onClick={async () => {
                          if (canNativePrompt) {
                            const accepted = await promptInstall()
                            if (!accepted) setShowAndroidInstallHelp(true)
                          } else {
                            setShowAndroidInstallHelp(true)
                          }
                        }}
                      >
                        Add Hyperion to Home Screen
                      </button>
                      {showAndroidInstallHelp && (
                        <p style={{ margin: '.5rem 0 0', color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.5 }}>
                          If no install prompt appeared, open this page in Chrome, tap <strong>⋮</strong>, choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm. Some browsers do not allow websites to open the install prompt directly.
                        </p>
                      )}
                    </>
                  ) : key === 'ios' ? (
                    <>
                      <strong>iPhone and iPad</strong>
                      <ol style={{ paddingLeft: '1.15rem', margin: '.35rem 0 0' }}>
                        <li>Open <strong>https://hyperionmaritime.org</strong> in Safari and wait for the page to load. If it opened inside another app, open the link in Safari first.</li>
                        <li>Tap the <strong>page menu</strong> beside the address bar. It may look like <strong>three horizontal lines</strong> or a small page icon, depending on your iOS version.</li>
                        <li>Tap <strong>Share</strong>.</li>
                        <li>In the Share menu, tap <strong>View More</strong> or <strong>More</strong> if shown, then choose <strong>Add to Home Screen</strong>. If you don't see it, scroll down the list.</li>
                        <li>Leave the name as <strong>Hyperion Maritime</strong>, turn on <strong>Open as Web App</strong> if that option appears, then tap <strong>Add</strong>.</li>
                      </ol>
                    </>
                  ) : (
                    <>
                      <strong>Windows, Mac, or Linux</strong>
                      <div style={{ margin: '.45rem 0 .65rem' }}>
                        <DesktopInstallBadge
                          busy={desktopInstallBusy}
                          onClick={() => void openDesktopInstall()}
                          disabled={desktopInstallBusy}
                        />
                      </div>
                      {showDesktopInstallHelp && (
                        <>
                          <ol style={{ paddingLeft: '1.15rem', margin: '.35rem 0 0' }}>
                            <li>Open this site in <strong>Chrome</strong> or <strong>Edge</strong>.</li>
                            <li>Click the install icon in the address bar, or open the browser menu (<strong>⋮</strong> / <strong>…</strong>).</li>
                            <li>Choose <strong>Install Hyperion</strong> or <strong>Install this site as an app</strong>, then confirm.</li>
                            <li>Launch it from your Start menu or app launcher.</li>
                          </ol>
                          <p style={{ margin: '.45rem 0 0' }}>On MacBook using Safari, select <strong>File → Add to Dock</strong>. The button opens these steps when Safari cannot show a native install prompt.</p>
                        </>
                      )}
                    </>
                  )}
                </div>}
              </div>
            ))}
          </div>
        </div>



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
      {showDesktopInstallDialog && (
        <div
          role="presentation"
          onClick={event => { if (event.target === event.currentTarget) setShowDesktopInstallDialog(false) }}
          style={{
            position: 'fixed', inset: 0, zIndex: 10000, display: 'grid', placeItems: 'center',
            padding: '1rem', background: 'rgba(2, 9, 25, .72)', backdropFilter: 'blur(4px)',
            boxSizing: 'border-box'
          }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="desktop-install-dialog-title"
            onClick={event => event.stopPropagation()}
            style={{
              width: 'min(100%, 510px)', maxHeight: 'min(88dvh, 760px)', overflowY: 'auto',
              background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
              borderTop: '4px solid var(--accent)', borderRadius: 16, padding: '1.2rem',
              boxShadow: '0 24px 80px rgba(0,0,0,.36)', boxSizing: 'border-box'
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
              <div>
                <div style={{ color: 'var(--accent)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.12em' }}>HYPERION MARITIME</div>
                <h2 id="desktop-install-dialog-title" style={{ fontSize: '1.35rem', lineHeight: 1.2, margin: '.35rem 0 0' }}>Install Hyperion on your computer</h2>
              </div>
              <button type="button" onClick={() => setShowDesktopInstallDialog(false)} aria-label="Close install instructions" style={{ fontSize: '1.5rem', color: 'var(--text-muted)', border: 0, background: 'transparent', cursor: 'pointer', lineHeight: 1 }}>×</button>
            </div>
            <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', lineHeight: 1.5, margin: '.75rem 0 1rem' }}>
              Your browser has not provided a direct install prompt. You can still install Hyperion from its browser menu:
            </p>
            <div style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 9, padding: '.8rem', marginBottom: '.65rem' }}>
              <strong>Brave (Windows)</strong>
              <ol style={{ paddingLeft: '1.2rem', margin: '.4rem 0 0', fontSize: '.85rem', lineHeight: 1.55 }}>
                <li>Click the <strong>☰ menu</strong> in the top-right corner of Brave.</li>
                <li>Choose <strong>Save and share</strong>.</li>
                <li>Click <strong>Install Hyperion Maritime…</strong> (or the install option shown for this site).</li>
                <li>Confirm by clicking <strong>Install</strong>.</li>
              </ol>
            </div>
            <div style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 9, padding: '.8rem', marginBottom: '.65rem' }}>
              <strong>Google Chrome</strong>
              <p style={{ margin: '.35rem 0 0', fontSize: '.85rem', lineHeight: 1.5 }}>Click <strong>⋮ → Cast, save, and share → Install page as app</strong>, then confirm.</p>
            </div>
            <div style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 9, padding: '.8rem', marginBottom: '.65rem' }}>
              <strong>Microsoft Edge</strong>
              <p style={{ margin: '.35rem 0 0', fontSize: '.85rem', lineHeight: 1.5 }}>Click <strong>… → More tools → Apps → Install this site as an app</strong>, then confirm.</p>
            </div>
            <div style={{ border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 9, padding: '.8rem' }}>
              <strong>MacBook using Safari</strong>
              <p style={{ margin: '.35rem 0 0', fontSize: '.85rem', lineHeight: 1.5 }}>Choose <strong>File → Add to Dock</strong> from Safari's menu bar.</p>
            </div>
            {canNativePrompt && <button type="button" className="btn btn-primary" disabled={desktopInstallBusy} onClick={() => void openDesktopInstall()} style={{ marginTop: '1rem', width: '100%' }}>{desktopInstallBusy ? 'Opening install prompt…' : 'OPEN INSTALL PROMPT'}</button>}
            <button type="button" className={canNativePrompt ? 'btn btn-outline' : 'btn btn-primary'} onClick={() => setShowDesktopInstallDialog(false)} style={{ marginTop: '1rem', width: '100%' }}>GOT IT</button>
          </section>
        </div>
      )}
    </>
  )
}
