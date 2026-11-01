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
  const [signingOut, setSigningOut] = useState(false)
  const [errorMessage, setErrorMessage] = useState('')

  useEffect(() => {
    if (!supabase) return
    let active = true
    void supabase.auth.getSession()
      .then(({ data }) => { if (active) setSignedIn(Boolean(data.session?.user)) })
      .catch(() => { if (active) setSignedIn(false) })
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (active) setSignedIn(Boolean(session?.user))
    })
    return () => { active = false; data.subscription.unsubscribe() }
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

  const signOut = async () => {
    const client = supabase
    if (!client || !signedIn || signingOut) return
    setSigningOut(true)
    setErrorMessage('')
    try {
      await withPageLoading('Signing out', async () => {
        const { error } = await client.auth.signOut()
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
        onClick={() => setOpen(current => !current)}
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
        {accountLinks.map(link => (
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
          <Link
            to="/account"
            className="desktop-account-option desktop-account-signout"
            onClick={() => setOpen(false)}
          >
            <span aria-hidden="true">↪</span>
            Sign In
          </Link>
        )}
        {errorMessage && <p className="desktop-account-error" role="alert">{errorMessage}</p>}
      </div>
    </div>
  )
}
