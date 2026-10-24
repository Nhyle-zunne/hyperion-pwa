import { useState } from 'react'
import { useInstallPrompt } from '../hooks/useInstallPrompt'

/**
 * Install / Add to Home Screen card.
 * - Android Chrome: uses beforeinstallprompt when available
 * - iOS Safari: step-by-step Share → Add to Home Screen (no browser install API)
 */
export default function InstallPrompt({ force = false }: { force?: boolean }) {
  const {
    canNativePrompt,
    installed,
    isIos,
    isAndroid,
    dismissed,
    promptInstall,
    dismiss,
    showInstallUi
  } = useInstallPrompt()
  const [busy, setBusy] = useState(false)
  const [showIosSteps, setShowIosSteps] = useState(false)

  if (installed) return null
  if (!force && dismissed) return null
  if (!showInstallUi) return null

  const onInstallClick = async () => {
    if (canNativePrompt) {
      setBusy(true)
      await promptInstall()
      setBusy(false)
      return
    }
    if (isIos) {
      setShowIosSteps(true)
      return
    }
    // Desktop or browsers without BIP: show generic instructions
    setShowIosSteps(true)
  }

  return (
    <div
      className="card"
      style={{
        marginBottom: '1.25rem',
        borderColor: 'var(--accent)',
        background: 'var(--bg-card)'
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start' }}>
        <div>
          <div style={{ fontWeight: 700, marginBottom: 4 }}>Install Hyperion</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)', lineHeight: 1.45 }}>
            {isIos
              ? 'Add to your Home Screen for a full-screen app experience on iPhone/iPad.'
              : isAndroid
                ? 'Install the app on your phone for offline access and a home-screen icon.'
                : 'Install this app on your device for quick access and offline use.'}
          </div>
        </div>
        {!force && (
          <button
            type="button"
            onClick={dismiss}
            aria-label="Dismiss"
            style={{
              color: 'var(--text-muted)',
              fontSize: '1.1rem',
              lineHeight: 1,
              padding: 4
            }}
          >
            ×
          </button>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1, minWidth: 140 }}
          disabled={busy}
          onClick={onInstallClick}
        >
          {busy ? 'Opening…' : canNativePrompt ? 'Install app' : isIos ? 'How to install' : 'Install / Add to Home'}
        </button>
      </div>

      {(showIosSteps || (!canNativePrompt && !isAndroid && showIosSteps)) && (
        <div
          style={{
            marginTop: 12,
            padding: '0.75rem',
            borderRadius: 8,
            background: 'var(--bg-elevated)',
            fontSize: '0.85rem',
            color: 'var(--text)',
            lineHeight: 1.55
          }}
        >
          {isIos ? (
            <ol style={{ marginLeft: '1.1rem' }}>
              <li>
                Tap the <strong>Share</strong> button (square with ↑) in Safari
              </li>
              <li>
                Scroll and tap <strong>Add to Home Screen</strong>
              </li>
              <li>
                Tap <strong>Add</strong>
              </li>
            </ol>
          ) : isAndroid && !canNativePrompt ? (
            <ol style={{ marginLeft: '1.1rem' }}>
              <li>Open this site in <strong>Chrome</strong></li>
              <li>
                Tap the menu (⋮) → <strong>Install app</strong> or <strong>Add to Home screen</strong>
              </li>
              <li>
                If you don’t see it yet, browse a bit and try again (Chrome requires a short visit first)
              </li>
            </ol>
          ) : (
            <ol style={{ marginLeft: '1.1rem' }}>
              <li>
                In Chrome/Edge: address bar → install icon, or menu → <strong>Install Hyperion</strong>
              </li>
              <li>
                On iPhone: Safari → Share → <strong>Add to Home Screen</strong>
              </li>
            </ol>
          )}
          <p style={{ marginTop: 8, color: 'var(--text-muted)', fontSize: '0.8rem' }}>
            Requires HTTPS (Cloudflare provides this). Must open in the browser, not inside Facebook/Instagram in-app browser.
          </p>
        </div>
      )}
    </div>
  )
}
