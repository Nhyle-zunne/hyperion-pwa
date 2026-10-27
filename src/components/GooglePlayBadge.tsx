const PLAY_STORE_URL = 'https://play.google.com/store/apps/details?id=com.nhyle.hyperionmaritime'

export default function GooglePlayBadge() {
  return (
    <a
      className="hyperion-google-play-badge"
      href={PLAY_STORE_URL}
      target="_blank"
      rel="noopener noreferrer"
      aria-label="Get Hyperion Maritime on Google Play"
      style={{
        boxSizing: 'border-box',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 10,
        width: '100%',
        minHeight: 56,
        padding: '8px 12px',
        border: '1.5px solid #737373',
        borderRadius: 10,
        background: '#080808',
        color: '#ffffff',
        textDecoration: 'none',
        boxShadow: '0 2px 0 rgba(0,0,0,.12)'
      }}
    >
      <svg width="30" height="34" viewBox="0 0 36 38" role="img" aria-label="Google Play logo" style={{ flex: '0 0 auto', display: 'block' }}>
        <path d="M3.6 2.5C3.2 3 3 3.7 3 4.8v28.4c0 1.1.2 1.8.6 2.3L20 19 3.6 2.5Z" fill="#4285F4" />
        <path d="M3.6 2.5C4.6 1.3 6 1.1 7.7 2l20.4 11.2L20 19 3.6 2.5Z" fill="#34A853" />
        <path d="M20 19 28.1 24.7 8 36.1c-1.7.9-3.2.7-4.4-.6L20 19Z" fill="#EA4335" />
        <path d="M28.1 13.2 32.5 15.6c2 1.1 2 3.1 0 4.2l-4.4 2.5L20 19l8.1-5.8Z" fill="#FBBC04" />
      </svg>
      <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1, minWidth: 0 }}>
        <span style={{ fontSize: 9, lineHeight: 1.1, fontWeight: 700, letterSpacing: '1.5px', textTransform: 'uppercase', color: '#e9e9e9' }}>Get it on</span>
        <span style={{ fontSize: 20, lineHeight: 1.12, fontWeight: 650, letterSpacing: '-.35px', whiteSpace: 'nowrap' }}>Google Play</span>
      </span>
    </a>
  )
}
