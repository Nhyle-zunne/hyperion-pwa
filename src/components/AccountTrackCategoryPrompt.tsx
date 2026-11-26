import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import type { User } from '@supabase/supabase-js'
import { supabase } from '../lib/supabase'
import { hasTrackCategory, parseTrackCategory, toggleTrackCategory, TRACK_CATEGORIES, type TrackCategory } from '../lib/accountTrackCategory'

/** One-time profile setup for any signed-in user missing a category (including existing accounts). */
export default function AccountTrackCategoryPrompt() {
  const [user, setUser] = useState<User | null>(null)
  const [ready, setReady] = useState(false)
  const [online, setOnline] = useState(() => typeof navigator === 'undefined' || navigator.onLine)
  const [choice, setChoice] = useState<TrackCategory | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [saveSlow, setSaveSlow] = useState(false)
  const [deferred, setDeferred] = useState(false)
  const dialogRef = useRef<HTMLElement | null>(null)
  const priorFocusRef = useRef<HTMLElement | null>(null)

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    let revision = 0
    const { data: { subscription } } = client.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      revision++
      if (session?.user && !parseTrackCategory(session.user.user_metadata?.track_category)
          && !dialogRef.current?.contains(document.activeElement)) {
        priorFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
      }
      setUser(session?.user ?? null)
      setReady(true)
    })
    const initialRevision = revision
    void client.auth.getSession().then(({ data, error: authError }) => {
      if (!active || revision !== initialRevision || authError) return
      setUser(data.session?.user ?? null)
    }).catch(() => { /* Offline Auth lookup must not interrupt saved reviewer access. */ })
      .finally(() => { if (active) setReady(true) })
    const reconnect = () => setOnline(true)
    const disconnect = () => setOnline(false)
    window.addEventListener('online', reconnect)
    window.addEventListener('offline', disconnect)
    return () => {
      active = false
      subscription.unsubscribe()
      window.removeEventListener('online', reconnect)
      window.removeEventListener('offline', disconnect)
    }
  }, [])

  const userId = user?.id
  useEffect(() => { setChoice(null); setBusy(false); setError(''); setDeferred(false) }, [userId])
  useEffect(() => {
    if (!busy) { setSaveSlow(false); return }
    const timer = window.setTimeout(() => setSaveSlow(true), 8000)
    return () => window.clearTimeout(timer)
  }, [busy])

  const save = async () => {
    if (!supabase || !user || !choice || busy) return
    setBusy(true)
    setError('')
    // Keep a focus target in the dialog while the save button is disabled.
    dialogRef.current?.querySelector<HTMLButtonElement>('button')?.focus()
    try {
      const { data, error: saveError } = await supabase.auth.updateUser({ data: { track_category: choice } })
      if (saveError || !data.user || data.user.id !== user.id) throw new Error('Category update failed')
      setUser(data.user)
    } catch {
      setError('Could not save your track category. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const trapFocus = (event: React.KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = Array.from(dialogRef.current.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'))
    if (!focusable.length) return
    const first = focusable[0], last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
    else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
  }
  const deferUntilNextVisit = () => {
    setDeferred(true)
    const previous = priorFocusRef.current
    window.requestAnimationFrame(() => { if (previous?.isConnected) previous.focus() })
  }

  // Only online, authenticated profiles are prompted. Offline saved licenses and
  // anonymous Free Reviewer access stay available regardless of this display tag.
  if (!ready || !online || !user || deferred || parseTrackCategory(user.user_metadata?.track_category)) return null

  return createPortal(<div role="presentation" style={{
    position: 'fixed', inset: 0, zIndex: 30000, display: 'grid', placeItems: 'center',
    background: 'rgba(3,8,18,.8)', padding: '1rem', overflowY: 'auto', boxSizing: 'border-box',
  }}>
    <section ref={dialogRef} role="dialog" aria-modal="true" aria-labelledby="track-category-title" aria-describedby="track-category-description"
      onKeyDown={trapFocus} style={{
        width: 'min(100%, 460px)', padding: 'clamp(1rem,4vw,1.5rem)', boxSizing: 'border-box',
        background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
        borderTop: '4px solid var(--accent)', borderRadius: 0, boxShadow: '0 24px 80px rgba(0,0,0,.4)',
      }}>
      <h2 id="track-category-title" style={{ margin: '0 0 .65rem', fontSize: '1.35rem' }}>Choose your track category</h2>
      <p id="track-category-description" style={{ margin: '0 0 1rem', lineHeight: 1.55, color: 'var(--text-muted)' }}>
        Help Hyperion identify which reviewer you may need when you send a payment. You can select DECK, GMDSS, or both.
        ENGINE is a separate category and cannot be combined with the others.
      </p>
      <div role="group" aria-label="Select your account track category" style={{ display: 'grid', gap: '.55rem' }}>
        {TRACK_CATEGORIES.map(category => <button key={category} type="button" autoFocus={category === 'DECK'}
          aria-pressed={hasTrackCategory(choice, category)} aria-disabled={busy} onClick={() => { if (!busy) setChoice(current => toggleTrackCategory(current, category)) }}
          style={{ minHeight: 48, textAlign: 'left', padding: '.8rem 1rem', cursor: busy ? 'wait' : 'pointer',
            border: hasTrackCategory(choice, category) ? '2px solid var(--accent)' : '1px solid var(--border)',
            background: hasTrackCategory(choice, category) ? 'var(--accent-soft)' : 'var(--bg-elevated)',
            color: 'var(--text)', borderRadius: 0, fontWeight: 850,
          }}>
          {hasTrackCategory(choice, category) ? '✓  ' : '○  '}{category}
        </button>)}
      </div>
      <p style={{ margin: '.9rem 0', fontSize: '.82rem', lineHeight: 1.5, color: 'var(--text-muted)' }}>
        This is only an account label; it does not activate a license or change your reviewer access. You can edit it later in Account.
      </p>
      {error && <p role="alert" style={{ color: 'var(--danger, #b91c1c)' }}>{error}</p>}
      <button type="button" className="btn btn-primary" disabled={!choice || busy} onClick={() => void save()}
        style={{ minHeight: 48, width: '100%' }}>{busy ? 'SAVING…' : 'SAVE TRACK CATEGORY'}</button>
      {(Boolean(error) || saveSlow) && <button type="button" className="btn btn-outline" onClick={deferUntilNextVisit}
        style={{ minHeight: 44, width: '100%', marginTop: '.65rem' }}>CONTINUE TO REVIEWER FOR NOW</button>}
      {(Boolean(error) || saveSlow) && <p style={{ margin: '.55rem 0 0', fontSize: '.75rem', color: 'var(--text-muted)', lineHeight: 1.4 }}>
        Your reviewer stays available if the connection fails. We will ask for your category again on your next visit.
      </p>}
    </section>
  </div>, document.body)
}
