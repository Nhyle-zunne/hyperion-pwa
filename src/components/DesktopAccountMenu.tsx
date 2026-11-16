import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'
import { useLicenseStore } from '../stores/licenseStore'

const accountLinks = [
  { to: '/account?tab=payments', label: 'Bond Store', icon: '🛍️' },
  { to: '/account?tab=licenses', label: 'My Licenses', icon: '🎫' },
  { to: '/orders', label: 'Orders', icon: '🧾' },
]

/** Desktop-only Account navigation; mobile keeps its existing bottom tab and drawer. */
export default function DesktopAccountMenu() {
  const navigate = useNavigate()
  const location = useLocation()
  const containerRef = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const [signedIn, setSignedIn] = useState(false)
  const [authChecked, setAuthChecked] = useState(!supabase)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const hasVerifiedOfflineLicense = useLicenseStore(state =>
    Boolean(state.entitlementUserId) && state.entitlementsVerified &&
    (state.isAllAccessUnlocked || state.cloudTrackIds.length > 0))
  const offlineAccount = !signedIn && hasVerifiedOfflineLicense
  const [signingOut, setSigningOut] = useState(false)
  const [signingIn, setSigningIn] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    let revision = 0
    let pending: Promise<void> | null = null
    const { data } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      revision++
      setSignedIn(Boolean(session?.user))
      setAuthChecked(true)
    })
    const checkSavedSession = () => {
      if (pending) return
      const lookupRevision = revision
      const job = client.auth.getSession().then(({ data: response, error }) => {
        // A slow offline lookup cannot override a newer auth event, or turn
        // a previously confirmed account into a guest after a network error.
        if (active && revision === lookupRevision && !error) {
          setSignedIn(Boolean(response.session?.user))
        }
      }).catch(() => {
        // Failed refresh is not an intentional sign-out. The owner-bound,
        // verified offline lease remains usable across desktop and PWA tabs.
      }).finally(() => {
        if (active) setAuthChecked(true)
      })
      pending = job
      void job.finally(() => { if (pending === job) pending = null })
    }
    void checkSavedSession()
    const onReconnect = () => { setOnline(true); checkSavedSession() }
    const onDisconnect = () => setOnline(false)
    window.addEventListener('online', onReconnect)
    window.addEventListener('offline', onDisconnect)
    return () => {
      active = false
      data.subscription.unsubscribe()
      window.removeEventListener('online', onReconnect)
      window.removeEventListener('offline', onDisconnect)
    }
  }, [])

  useEffect(() => {
    setOpen(false)
    setErrorMessage('')
  }, [location.pathname, location.search])

  useEffect(() => {
    if (!open) return
    const handleOutsideClick = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setOpen(false)
        containerRef.current?.querySelector<HTMLButtonElement>('.desktop-account-trigger')?.focus()
      }
    }
    document.addEventListener('pointerdown', handleOutsideClick)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('pointerdown', handleOutsideClick)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [open])

  const signInWithGoogle = async () => {
    const client = supabase
    if (!client || signingIn) return
    setSigningIn(true)
    setErrorMessage('')

    // Use the existing redirect callback and preserve the page the visitor came from.
    // A normal header sign-in should not force visitors into the Bond Store.
    const requestedReturnTo = window.location.pathname + window.location.search + window.location.hash
    const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//')
      ? requestedReturnTo
      : '/'
    try {
      localStorage.setItem('hyperion-oauth-return-to', JSON.stringify({
        path: returnTo,
        startedAt: Date.now(),
        mode: 'redirect',
      }))
    } catch {
      // The OAuth callback will safely return to the dashboard without storage.
    }

    try {
      const { error } = await client.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://hyperionmaritime.org/auth/callback',
          queryParams: { prompt: 'select_account' },
        },
      })
      if (error) throw error
    } catch {
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      setErrorMessage('Unable to open Google sign-in. Please try again.')
      setSigningIn(false)
      setOpen(true)
    }
  }

  const signOut = async () => {
    const client = supabase
    if (!client || !signedIn || signingOut) return
    setSigningOut(true)
    setErrorMessage('')
    try {
      await withPageLoading('Signing out', async () => {
        const { error } = await client.auth.signOut({ scope: 'local' })
        if (error) throw error
        // Intentional sign-out clears cached account licenses just as AccountScreen does.
        useLicenseStore.getState().clearLicense()
      })
      setSignedIn(false)
      setOpen(false)
      navigate('/account', { replace: true })
    } catch {
      setErrorMessage('Unable to sign out. Check your connection and try again.')
      setOpen(true)
    } finally {
      setSigningOut(false)
    }
  }

  const accountPageActive = location.pathname === '/account' ||
    ['/checkout', '/basket', '/orders', '/manual-payment'].includes(location.pathname)

  return (
    <div
      ref={containerRef}
      className="desktop-account-menu"
      onMouseEnter={() => setOpen(true)}
      onMouseLeave={() => { if (!signingOut) setOpen(false) }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOpen(false)
      }}
    >
      <button
        type="button"
        className={'desktop-account-trigger' + (accountPageActive ? ' is-active' : '')}
        aria-haspopup="true"
        aria-expanded={open}
        aria-controls="desktop-account-dropdown"
        onClick={() => { setOpen(false); navigate('/account?tab=payments') }}
        onKeyDown={event => { if (event.key === 'ArrowDown') { event.preventDefault(); setOpen(true) } }}
      >
        <span aria-hidden="true">👤</span>
        Account
      </button>
      <div
        id="desktop-account-dropdown"
        className="desktop-account-popover"
        aria-label="Account options"
        hidden={!open}
      >
        {offlineAccount && <p className="desktop-account-option" role="status" style={{ margin: 0, fontSize: '.8rem', cursor: 'default' }}>✓ Licensed account · Offline access</p>}
        {accountLinks.filter(link => signedIn || link.to === '/account?tab=payments' || (offlineAccount && link.to === '/account?tab=licenses')).map(link => (
          <Link
            key={link.to}
            to={link.to}
            className="desktop-account-option"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">{link.icon}</span>
            {link.label}
          </Link>
        ))}
        {signedIn ? (
          <button
            type="button"
            className="desktop-account-option desktop-account-signout"
            disabled={signingOut}
            onClick={() => { void signOut() }}
          >
            <span aria-hidden="true">↪</span>
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
        ) : (
          <button
            type="button"
            className="desktop-account-option desktop-account-signout"
            disabled={!supabase || signingIn || !online || (!authChecked && !offlineAccount)}
            onClick={() => { void signInWithGoogle() }}
          >
            <span aria-hidden="true">↪</span>
            {signingIn ? 'Opening Google…' : !online ? 'Offline · Reconnect later' : !authChecked && !offlineAccount ? 'Checking session…' : offlineAccount ? 'Reconnect Google account' : 'Sign In'}
          </button>
        )}
        {errorMessage && <p className="desktop-account-error" role="alert">{errorMessage}</p>}
      </div>
    </div>
  )
}
