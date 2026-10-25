import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'

export default function AccountScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [product, setProduct] = useState('oic_nw')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [owned, setOwned] = useState<string[]>([])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!supabase || !session?.user.id) { setOwned([]); return }
    let cancelled = false
    void supabase.from('entitlements').select('product_code').eq('user_id', session.user.id).eq('status', 'active')
      .then(({ data, error }) => { if (!cancelled) { if (error) setMessage(error.message); else setOwned((data ?? []).map(row => row.product_code)) } })
    return () => { cancelled = true }
  }, [session?.user.id])

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setMessage('')
    const result = mode === 'signup'
      ? await supabase.auth.signUp({ email: email.trim(), password })
      : await supabase.auth.signInWithPassword({ email: email.trim(), password })
    setBusy(false)
    if (result.error) setMessage(result.error.message)
    else if (mode === 'signup' && !result.data.session) setMessage('Account created. Check your email to confirm your address, then sign in.')
    else setMessage(mode === 'signup' ? 'Account created.' : 'Signed in successfully.')
  }

  const buy = async () => {
    if (!supabase || !session) return
    setBusy(true); setMessage('Creating secure checkout…')
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', { body: { productCode: product } })
      if (error) throw error
      if (!data?.checkoutUrl) throw new Error(data?.error || 'Checkout URL was not returned.')
      window.location.assign(data.checkoutUrl)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to start checkout. Please try again.')
      setBusy(false)
    }
  }

  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', marginBottom: '1rem' }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }

  return <div className="screen" style={{ paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Back</button>
    <h1 className="page-title">Hyperion Account</h1>
    <p className="subtitle">Sign in to connect your purchased review tracks to your account.</p>
    {!supabaseConfigured && <div style={{ ...card, borderColor: 'var(--danger)' }}><strong>Supabase is not configured yet.</strong><p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>Create a Supabase project and set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in your Cloudflare Pages environment variables.</p></div>}
    {params.get('payment') === 'success' && <div style={{ ...card, borderColor: 'var(--accent)' }}><strong>Checkout completed or returned.</strong><p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>Your access appears only after PayMongo confirms the payment to the server. Refresh this page in a moment to check your purchases.</p></div>}
    {message && <div role="status" style={{ ...card, color: 'var(--text)', lineHeight: 1.5 }}>{message}</div>}
    {!session ? <section style={card}>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <button type="button" className={mode === 'signup' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMode('signup')} style={{ flex: 1 }}>Create account</button>
        <button type="button" className={mode === 'signin' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMode('signin')} style={{ flex: 1 }}>Sign in</button>
      </div>
      <form onSubmit={submitAuth}>
        <label>Email address<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={field} /></label>
        <label style={{ display: 'block', marginTop: '1rem' }}>Password<input type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} style={field} /></label>
        <button type="submit" className="btn btn-primary" disabled={!supabaseConfigured || busy} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Please wait…' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}</button>
      </form>
      <p style={{ color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.5, marginBottom: 0 }}>Use an email you can access. Never reuse your activation key or payment PIN as your password.</p>
    </section> : <>
      <section style={card}>
        <div style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>SIGNED IN AS</div>
        <strong style={{ overflowWrap: 'anywhere' }}>{session.user.email}</strong>
        <button type="button" className="btn btn-outline" style={{ display: 'block', marginTop: '.8rem' }} onClick={async () => { await supabase?.auth.signOut(); setMessage('Signed out.') }}>Sign out</button>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Your purchased access</h2>
        {owned.length ? owned.map(code => <div key={code} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>✓ {PAID_PRODUCTS.find(p => p.code === code)?.label ?? code}</div>) : <p style={{ color: 'var(--text-muted)' }}>No verified purchases are linked to this account yet.</p>}
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Purchase review access</h2>
        <label>Choose a track or bundle<select value={product} onChange={e => setProduct(e.target.value)} style={field}>{PAID_PRODUCTS.map(item => <option key={item.code} value={item.code}>{item.label}</option>)}</select></label>
        <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', lineHeight: 1.5 }}>Prices are configured securely in Supabase, not in the browser. Checkout stays disabled until the backend and price settings are configured.</p>
        <button type="button" className="btn btn-primary" style={{ width: '100%' }} disabled={busy || !supabaseConfigured} onClick={buy}>{busy ? 'Opening checkout…' : 'CONTINUE TO SECURE CHECKOUT'}</button>
      </section>
    </>}
  </div>
}
