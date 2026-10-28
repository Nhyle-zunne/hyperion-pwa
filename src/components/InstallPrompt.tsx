const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nhyle.hyperionmaritime'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useInstallPrompt } from '../hooks/useInstallPrompt'
import GooglePlayBadge from './GooglePlayBadge'
import DesktopInstallBadge from './DesktopInstallBadge'

type InstallPromptProps = { force?: boolean; variant?: 'card' | 'modal'; iosOnly?: boolean }

export default function InstallPrompt({ force = false, variant = 'card', iosOnly = false }: InstallPromptProps) {
  const { canNativePrompt, installed, isIos, isAndroid, dismissed, promptInstall, dismiss, showInstallUi } = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  const [installMessage, setInstallMessage] = useState('')

  useEffect(() => {
    if (variant !== 'modal') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (!dismissed || force)) dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [variant, dismissed, force, dismiss])

  if (installed || !showInstallUi || (!force && dismissed) || (iosOnly && !isIos)) return null

  const startInstall = async () => {
    setInstallMessage('')
    setBusy(true)
    try {
      const accepted = await promptInstall()
      if (!accepted) {
        setInstallMessage(canNativePrompt
          ? 'The install prompt was dismissed. Tap the button to try again.'
          : 'Your browser has not made its direct install prompt available.')
      }
    } finally {
      setBusy(false)
    }
  }

  const title = isAndroid
    ? 'Install Hyperion on Android'
    : isIos
      ? 'Add Hyperion to your iPhone or iPad'
      : 'Install Hyperion on your computer'
  const description = isAndroid
    ? 'Choose the Android app from Google Play or add the Hyperion website to your Home Screen.'
    : isIos
      ? 'Add Hyperion to your Home Screen for app-like access. Safari requires a few manual steps.'
      : 'Install Hyperion as an app for quick access from your desktop or Start menu.'

  if (variant === 'card') {
    return (
      <div className="card" style={{ marginBottom: '1.25rem', borderColor: 'var(--accent)', background: 'var(--bg-card)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
          <div>
            <div style={{ fontWeight: 800, marginBottom: 4 }}>Install Hyperion</div>
            <div style={{ fontSize: '.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>{description}</div>
          </div>
          {!force && <button type="button" onClick={dismiss} aria-label="Dismiss install prompt" style={{ color: 'var(--text-muted)', fontSize: '1.1rem', padding: 4 }}>×</button>}
        </div>
        <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
          {isAndroid && <a className="btn btn-outline" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ flex: '1 1 160px', textAlign: 'center' }}>Install from Google Play</a>}
          {isIos ? (
            <AppleAppStoreBadge onClick={dismiss} />
          ) : (
            <button type="button" className="btn btn-primary" style={{ flex: '1 1 160px' }} disabled={busy} onClick={() => void startInstall()}>
              {busy ? 'Opening install prompt…' : canNativePrompt ? 'Install app' : 'Install / Add to Home'}
            </button>
          )}
        </div>
      </div>
    )
  }

  return (
    <div
      role="presentation"
      onClick={event => { if (event.target === event.currentTarget) dismiss() }}
      style={{
        position: 'fixed', inset: 0, zIndex: 5000, display: 'grid', placeItems: 'center',
        padding: '1rem', paddingTop: 'calc(1rem + env(safe-area-inset-top))',
        paddingBottom: 'calc(1rem + env(safe-area-inset-bottom))',
        background: 'rgba(2, 9, 25, .72)', backdropFilter: 'blur(4px)', boxSizing: 'border-box'
      }}
    >
      <section
        role="dialog"
        aria-modal="true"
        aria-labelledby="hyperion-install-title"
        aria-describedby="hyperion-install-description"
        onClick={event => event.stopPropagation()}
        style={{
          width: 'min(100%, 520px)', maxHeight: 'min(88dvh, 760px)', overflowY: 'auto',
          background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
          borderTop: '4px solid var(--accent)', borderRadius: 16,
          boxShadow: '0 24px 80px rgba(0,0,0,.36)', padding: 'clamp(1rem, 4vw, 1.5rem)',
          boxSizing: 'border-box'
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ color: 'var(--accent)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.12em', marginBottom: 6 }}>HYPERION MARITIME</div>
            <h2 id="hyperion-install-title" style={{ margin: 0, fontSize: 'clamp(1.25rem, 4vw, 1.65rem)', lineHeight: 1.2 }}>{title}</h2>
          </div>
          {!force && <button type="button" onClick={dismiss} aria-label="Close install prompt" style={{ fontSize: '1.5rem', lineHeight: 1, color: 'var(--text-muted)', background: 'transparent', border: 0, padding: 2, cursor: 'pointer' }}>×</button>}
        </div>
        <p id="hyperion-install-description" style={{ color: 'var(--text-muted)', lineHeight: 1.55, fontSize: '.92rem', margin: '.75rem 0 1rem' }}>{description}</p>

        {isAndroid ? (
          <div style={{ display: 'grid', gap: 9 }}>
            <GooglePlayBadge />
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void startInstall()} style={{ minHeight: 46 }}>
              {busy ? 'Opening install prompt…' : 'ADD HYPERION TO HOME SCREEN'}
            </button>
          </div>
        ) : isIos ? (
          <div style={{ display: 'grid', gap: 10 }}>
            <AppleAppStoreBadge onClick={dismiss} />
            <p style={{ color: 'var(--text-muted)', fontSize: '.82rem', lineHeight: 1.45, margin: 0 }}>
              Opens the iPhone installation guide, with step-by-step instructions for adding Hyperion to your Home Screen.
            </p>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            <DesktopInstallBadge busy={busy} onClick={() => void startInstall()} disabled={busy} />
          </div>
        )}

        {installMessage && <p role="status" aria-live="polite" style={{ margin: '.6rem 0 0', color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.4 }}>{installMessage}</p>}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: '1rem', paddingTop: '.8rem', borderTop: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '.75rem' }}>You can find these steps later in the app drawer.</span>
          {!force && <button type="button" onClick={dismiss} style={{ color: 'var(--text-muted)', background: 'transparent', border: 0, cursor: 'pointer', padding: '.45rem' }}>Not now</button>}
        </div>
      </section>
    </div>
  )
}

function AppleAppStoreBadge({ onClick }: { onClick: () => void }) {
  return (
    <Link
      to="/install/ios"
      onClick={onClick}
      aria-label="Open the Hyperion iPhone installation guide"
      className="hyperion-apple-install-badge"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'clamp(12px, 3vw, 28px)',
        width: '100%',
        minHeight: 'clamp(96px, 24vw, 154px)',
        padding: 'clamp(10px, 2.8vw, 22px) clamp(12px, 3vw, 30px)',
        border: '2px solid #a5a5a5',
        borderRadius: 'clamp(12px, 2.5vw, 22px)',
        background: '#000',
        color: '#fff',
        textDecoration: 'none',
        boxShadow: '0 3px 0 rgba(0,0,0,.12)',
        transition: 'transform 160ms ease, box-shadow 160ms ease'
      }}
    >
      <svg
        width={86}
        height={92}
        viewBox="0 0 24 24"
        role="img"
        aria-label="Apple logo"
        style={{ width: 'clamp(42px, 13vw, 86px)', height: 'clamp(46px, 14vw, 92px)', flex: '0 0 auto', display: 'block', fill: '#fff' }}
      >
        <path d="M18.71 19.5c-.83 1.24-1.71 2.45-3.05 2.47-1.34.03-1.77-.79-3.29-.79s-2 .76-3.25.82c-1.3.05-2.29-1.34-3.13-2.57-1.72-2.5-3.04-7.07-1.27-10.16.87-1.23 2.42-2.01 4.1-2.04 1.28-.03 2.49.86 3.28.86s2.26-1.06 3.81-.91c.65.03 2.48.26 3.65 1.98-.1.06-2.18 1.27-2.15 3.78.03 3.01 2.64 4.01 2.67 4.02-.03.07-.42 1.44-1.37 2.54M13.7 3.63c.7-.8 1.86-1.41 2.84-1.46.13 1.14-.33 2.29-1 3.12-.67.82-1.77 1.46-2.85 1.38-.15-1.11.4-2.28 1.01-3.04Z" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', minWidth: 0, gap: 0 }}>
        <span style={{ fontSize: 'clamp(.78rem, 2.7vw, 1.35rem)', lineHeight: 1.2, fontWeight: 500, letterSpacing: '.01em' }}>
          Download on the
        </span>
        <span style={{ fontSize: 'clamp(1.75rem, 6.4vw, 3.15rem)', lineHeight: 1.02, fontWeight: 650, letterSpacing: '-.045em', whiteSpace: 'nowrap' }}>
          App Store
        </span>
      </span>
    </Link>
  )
}

