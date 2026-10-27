import { useEffect, useState } from 'react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'

const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nhyle.hyperionmaritime'
type InstallPromptProps = { force?: boolean; variant?: 'card' | 'modal' }

export default function InstallPrompt({ force = false, variant = 'card' }: InstallPromptProps) {
  const { canNativePrompt, installed, isIos, isAndroid, dismissed, promptInstall, dismiss, showInstallUi } = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  const [showSteps, setShowSteps] = useState(false)

  useEffect(() => {
    if (variant !== 'modal') return
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && (!dismissed || force)) dismiss()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [variant, dismissed, force, dismiss])

  if (installed || !showInstallUi || (!force && dismissed)) return null

  const startInstall = async () => {
    if (!canNativePrompt) {
      setShowSteps(value => !value)
      return
    }
    setBusy(true)
    try {
      const accepted = await promptInstall()
      if (!accepted) setShowSteps(true)
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
          <button type="button" className="btn btn-primary" style={{ flex: '1 1 160px' }} disabled={busy} onClick={() => void startInstall()}>
            {busy ? 'Opening…' : canNativePrompt ? 'Install app' : isIos ? 'How to install' : 'Install / Add to Home'}
          </button>
        </div>
        {(showSteps || isIos) && <InstallSteps isIos={isIos} isAndroid={isAndroid} />}
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
            <a className="btn btn-primary" href={PLAY_STORE_URL} target="_blank" rel="noopener noreferrer" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', textAlign: 'center', textDecoration: 'none', minHeight: 46 }}>
              INSTALL ANDROID APP · GOOGLE PLAY
            </a>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void startInstall()} style={{ minHeight: 46 }}>
              {busy ? 'Opening install prompt…' : canNativePrompt ? 'ADD HYPERION TO HOME SCREEN' : showSteps ? 'HIDE HOME SCREEN STEPS' : 'INSTALL WEBSITE / ADD TO HOME SCREEN'}
            </button>
          </div>
        ) : isIos ? (
          <div style={{ display: 'grid', gap: 9 }}>
            <div style={guidePanelStyle}>
              <strong>Install on iPhone or iPad</strong>
              <InstallSteps isIos isAndroid={false} />
            </div>
            <button type="button" className="btn btn-primary" onClick={dismiss}>GOT IT</button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 9 }}>
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void startInstall()} style={{ minHeight: 46 }}>
              {busy ? 'Opening install prompt…' : canNativePrompt ? 'INSTALL HYPERION ON THIS COMPUTER' : showSteps ? 'HIDE DESKTOP INSTALL STEPS' : 'SHOW DESKTOP INSTALL STEPS'}
            </button>
          </div>
        )}

        {!isIos && showSteps && <InstallSteps isIos={false} isAndroid={isAndroid} />}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginTop: '1rem', paddingTop: '.8rem', borderTop: '1px solid var(--border)' }}>
          <span style={{ color: 'var(--text-muted)', fontSize: '.75rem' }}>You can find these steps later in the app drawer.</span>
          {!force && <button type="button" onClick={dismiss} style={{ color: 'var(--text-muted)', background: 'transparent', border: 0, cursor: 'pointer', padding: '.45rem' }}>Not now</button>}
        </div>
      </section>
    </div>
  )
}

const guidePanelStyle: React.CSSProperties = {
  background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 9,
  padding: '.85rem', fontSize: '.87rem', lineHeight: 1.55
}

function InstallSteps({ isIos, isAndroid }: { isIos: boolean; isAndroid: boolean }) {
  if (isIos) {
    return (
      <ol style={{ margin: '.55rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.6, fontSize: '.85rem' }}>
        <li>First, open the <strong>Safari app</strong> itself (the blue compass icon). If Hyperion opened inside Facebook, Instagram, Messenger, Gmail, or another app, open that page's menu and choose <strong>Open in Safari</strong> (or copy the link and paste it into Safari).</li>
        <li>In Safari, tap the address bar, enter <strong>https://hyperionmaritime.org</strong>, and tap <strong>Go</strong>. Wait until the Hyperion home page has fully loaded. The Share button appears in Safari's toolbar, not on the earlier screen inside another app.</li>
        <li>Tap Safari's <strong>Share</strong> icon (a square with an upward arrow). On iPhone it is usually in the bottom toolbar; on iPad it is usually near the top of the screen.</li>
        <li>In the Share sheet, scroll down through the actions and tap <strong>Add to Home Screen</strong>.</li>
        <li>If <strong>Add to Home Screen</strong> is not listed, scroll to the bottom of the Share sheet, tap <strong>Edit Actions</strong> (or <strong>Edit</strong>), and enable it, then return to the Share sheet.</li>
        <li>On the Add to Home Screen screen, leave the name as <strong>Hyperion Maritime</strong>. If <strong>Open as Web App</strong> is offered, turn it on, then tap <strong>Add</strong> in the top corner.</li>
        <li>Go to your Home Screen and look for the <strong>Hyperion Maritime</strong> icon. Tap it to launch the app-like version.</li>
      </ol>
    )
  }
  if (isAndroid) {
    return (
      <div style={guidePanelStyle}>
        <strong>Use the web app without Play Store</strong>
        <ol style={{ margin: '.55rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.6, fontSize: '.85rem' }}>
          <li>Open <strong>hyperionmaritime.org</strong> in Chrome, not inside Facebook/Instagram.</li>
          <li>Tap the browser menu <strong>⋮</strong>.</li>
          <li>Choose <strong>Install app</strong> or <strong>Add to Home screen</strong>, then confirm.</li>
          <li>If Chrome shows an install prompt on this page, use <strong>Add Hyperion to Home Screen</strong>.</li>
        </ol>
        <p style={{ margin: '.6rem 0 0', fontSize: '.8rem', color: 'var(--text-muted)' }}>Google Play installs the Android app. Add to Home Screen creates an icon for this PWA website; either option is available.</p>
      </div>
    )
  }
  return (
    <div style={guidePanelStyle}>
      <strong>Windows, macOS, or Linux</strong>
      <ol style={{ margin: '.55rem 0 0', paddingLeft: '1.25rem', lineHeight: 1.6, fontSize: '.85rem' }}>
        <li>Open <strong>hyperionmaritime.org</strong> in <strong>Google Chrome</strong> or <strong>Microsoft Edge</strong>.</li>
        <li>Click the install icon in the address bar, if shown. Otherwise open the browser menu <strong>⋮</strong> or <strong>…</strong>.</li>
        <li>Choose <strong>Install Hyperion</strong> or <strong>Install this site as an app</strong>, then confirm.</li>
        <li>Find Hyperion in the Start menu, Applications list, or app launcher.</li>
      </ol>
      <p style={{ margin: '.6rem 0 0', fontSize: '.8rem', color: 'var(--text-muted)' }}>On supported macOS Safari versions, use <strong>File → Add to Dock</strong>. Menu wording varies by browser.</p>
    </div>
  )
}
