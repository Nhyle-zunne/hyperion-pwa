import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

const RETURN_TO_KEY = 'hyperion-oauth-return-to'
const POPUP_ATTEMPT_TTL_MS = 10 * 60 * 1000

function safeReturnTo(value: unknown): string {
  return typeof value === 'string' && value.startsWith('/') && !value.startsWith('//') ? value : '/'
}

export default function OAuthCallbackScreen() {
  const navigate = useNavigate()
  const [status, setStatus] = useState('Completing secure sign-in…')

  useEffect(() => {
    let cancelled = false
    let returnTo = '/'
    let popupAttempt = false

    try {
      const stored = localStorage.getItem(RETURN_TO_KEY)
      if (stored) {
        const parsed = JSON.parse(stored) as { path?: unknown; startedAt?: unknown; mode?: unknown }
        returnTo = safeReturnTo(parsed.path)
        // Redirect-based sign-in returns in this same tab. Treat only older
        // popup attempts as popups while they remain within the compatibility window.
        popupAttempt =
          parsed.mode !== 'redirect' &&
          typeof parsed.startedAt === 'number' &&
          Date.now() - parsed.startedAt >= 0 &&
          Date.now() - parsed.startedAt < POPUP_ATTEMPT_TTL_MS
      }
    } catch {
      // Continue with a safe dashboard fallback if storage is unavailable.
    }

    const query = new URLSearchParams(window.location.search)
    const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''))
    const callbackError =
      query.get('error_description') ||
      query.get('error') ||
      hash.get('error_description') ||
      hash.get('error') ||
      hash.get('error_code')

    const notifyOpener = (type: 'hyperion-oauth-success' | 'hyperion-oauth-error', message?: string) => {
      try {
        if (window.opener && !window.opener.closed) {
          window.opener.postMessage({
            type,
            return_to: returnTo,
            ...(message ? { message } : {}),
          }, window.location.origin)
        }
      } catch {
        // Parent-tab recovery also checks Supabase's same-origin session after close.
      }
    }

    const clearAttempt = () => {
      try {
        localStorage.removeItem(RETURN_TO_KEY)
      } catch {
        // Ignore storage cleanup failures.
      }
    }

    const finish = async () => {
      try {
        if (callbackError) throw new Error(callbackError)
        if (!supabase) throw new Error('Sign-in is temporarily unavailable. Please try again later.')

        // The shared client has detectSessionInUrl enabled; getSession waits for
        // Supabase's callback processing, including PKCE code exchange.
        const { data, error } = await supabase.auth.getSession()
        if (error) throw error
        if (!data.session) {
          throw new Error('Sign-in could not be completed. Please try again.')
        }
        if (cancelled) return

        clearAttempt()
        notifyOpener('hyperion-oauth-success')
        setStatus('Signed in successfully. Returning to Hyperion…')

        if (popupAttempt || window.opener) {
          // OAuth was launched as a popup. The opener handles the session and
          // closes this window; do not navigate this popup to the dashboard if
          // the browser temporarily blocks window.close().
          window.close()
          if (window.closed) return
          setStatus('Sign-in complete. Return to the Hyperion window to continue.')
          return
        }
        navigate(returnTo, { replace: true })
      } catch {
        const message = 'Sign-in could not be completed. Please try again.'
        if (cancelled) return
        clearAttempt()
        notifyOpener('hyperion-oauth-error', message)
        setStatus(message)

        if (popupAttempt || window.opener) {
          window.close()
          if (window.closed) return
          setStatus('Sign-in could not be completed. Return to the Hyperion window for details.')
          return
        }
        navigate('/account', { replace: true, state: { oauthError: message } })
      }
    }

    void finish()
    return () => { cancelled = true }
  }, [navigate])

  return (
    <div className="screen" style={{ width: 'min(calc(100% - 2rem), 520px)', margin: '2rem auto', textAlign: 'center' }}>
      <h1 className="page-title">Hyperion Maritime</h1>
      <p className="subtitle" role="status" aria-live="polite">{status}</p>
    </div>
  )
}
