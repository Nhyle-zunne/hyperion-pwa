type DesktopInstallBadgeProps = {
  onClick: () => void
  disabled?: boolean
  busy?: boolean
}

type DesktopPlatform = 'windows' | 'mac' | 'desktop'

function detectDesktopPlatform(): DesktopPlatform {
  if (typeof navigator === 'undefined') return 'desktop'
  const ua = navigator.userAgent
  if (/Windows/i.test(ua)) return 'windows'
  if (/Macintosh|Mac OS X/i.test(ua) && navigator.maxTouchPoints <= 1) return 'mac'
  return 'desktop'
}

export default function DesktopInstallBadge({ onClick, disabled = false, busy = false }: DesktopInstallBadgeProps) {
  const platform = detectDesktopPlatform()
  const smallLabel = platform === 'desktop' ? 'INSTALL ON' : 'GET IT ON'
  const mainLabel = platform === 'mac' ? 'Mac' : platform === 'windows' ? 'Windows' : 'Desktop'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={platform === 'mac' ? 'Install Hyperion on Mac' : platform === 'windows' ? 'Install Hyperion on Windows' : 'Install Hyperion on desktop'}
      className="hyperion-desktop-install-badge"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: '100%',
        minHeight: 58,
        padding: '8px 12px',
        border: '1.5px solid #777',
        borderRadius: 10,
        background: '#080808',
        color: '#fff',
        textAlign: 'left',
        cursor: disabled ? 'wait' : 'pointer',
        opacity: disabled ? .75 : 1,
        boxShadow: '0 2px 0 rgba(0,0,0,.12)'
      }}
    >
      {platform === 'windows' ? (
        <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block' }}>
          <path d="M2 6 18 3.5V18H2V6Z" fill="#F35325" />
          <path d="M21 3 38 0.5V18H21V3Z" fill="#81BC06" />
          <path d="M2 21H18V36.5L2 34V21Z" fill="#05A6F0" />
          <path d="M21 21H38V39L21 36.5V21Z" fill="#FFBA08" />
        </svg>
      ) : platform === 'mac' ? (
        <svg width="34" height="36" viewBox="0 0 36 40" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block' }}>
          <path d="M25.8 21.1c0-4 3.3-5.9 3.5-6-1.9-2.8-4.9-3.2-6-3.2-2.5-.3-4.9 1.5-6.2 1.5s-3.3-1.5-5.4-1.5c-2.8 0-5.3 1.6-6.7 4-2.9 5-.7 12.4 2.1 16.5 1.4 2 3 4.1 5.1 4 2-.1 2.8-1.3 5.3-1.3s3.2 1.3 5.4 1.2c2.2 0 3.6-2 4.9-4 1.6-2.3 2.3-4.6 2.3-4.7-.1 0-4.3-1.7-4.3-6.5ZM21.7 9.2c1.1-1.3 1.9-3.1 1.7-4.9-1.6.1-3.5 1.1-4.6 2.4-1 1.1-1.9 3-1.7 4.7 1.8.1 3.5-.9 4.6-2.2Z" fill="#fff" />
        </svg>
      ) : (
        <svg width="34" height="34" viewBox="0 0 40 40" aria-hidden="true" style={{ flex: '0 0 auto', display: 'block' }}>
          <rect x="4" y="6" width="32" height="23" rx="2.5" fill="none" stroke="#fff" strokeWidth="2.5" />
          <path d="M14 35h12M20 29v6" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
      )}
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 9, lineHeight: 1.1, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#e9e9e9' }}>
          {busy ? 'OPENING INSTALL' : smallLabel}
        </span>
        <span style={{ fontSize: 21, lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.35px', whiteSpace: 'nowrap' }}>
          {busy ? 'Please wait…' : mainLabel}
        </span>
      </span>
    </button>
  )
}
