import { useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

type Order = { id: string; product_code: string; amount_php: number; status: string; payment_reference: string | null; created_at: string; admin_note: string | null }
type OwnedTrack = { product_code: string; expires_at: string | null }
export default function AccountScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [session, setSession] = useState<Session | null>(null)
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [mode, setMode] = useState<'signin' | 'signup'>('signup')
  const [product, setProduct] = useState('oic_nw')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [reference, setReference] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [note, setNote] = useState('')
  const [instructions, setInstructions] = useState('Payment instructions are being configured. Please check back later.')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [owned, setOwned] = useState<OwnedTrack[]>([])
  const [orders, setOrders] = useState<Order[]>([])
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])
  useEffect(() => {
    if (!supabase) return
    void supabase.from('payment_settings').select('instructions').eq('id', 1).maybeSingle()
      .then(({ data }) => { if (data?.instructions) setInstructions(data.instructions) })
  }, [])
  const refreshAccount = async () => {
    if (!supabase || !session?.user.id) { setOwned([]); setOrders([]); return }
    const [entitlements, orderResult] = await Promise.all([
      supabase.from('entitlements').select('product_code,expires_at').eq('user_id', session.user.id).eq('status', 'active').gt('expires_at', new Date().toISOString()),
      supabase.from('orders').select('id,product_code,amount_php,status,payment_reference,created_at,admin_note').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50)
    ])
    if (entitlements.error) setMessage(entitlements.error.message)
    else setOwned((entitlements.data ?? []) as OwnedTrack[])
    if (orderResult.error) setMessage(orderResult.error.message)
    else setOrders((orderResult.data ?? []) as Order[])
    await refreshCloudEntitlements()
  }
  useEffect(() => { void refreshAccount() }, [session?.user.id])
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
  const submitPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session) return
    setBusy(true); setMessage('Submitting your payment for manual review…')
    try {
      const { data, error } = await supabase.functions.invoke('submit-manual-payment', { body: { productCode: product, paymentMethod, paymentReference: reference, proofUrl, customerNote: note } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage(`Payment details submitted. Your reference is ${data.order.id}. Access will be enabled after manual verification.`)
      setReference(''); setProofUrl(''); setNote('')
      await refreshAccount()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to submit payment. Please try again.') }
    finally { setBusy(false) }
  }
  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', marginBottom: '1rem', borderRadius: 10 }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }
  const label: React.CSSProperties = { display: 'block', marginTop: '.8rem' }
  const statusLabel: Record<string,string> = { submitted: 'Awaiting manual review', pending: 'Awaiting payment review', paid: 'Approved', failed: 'Rejected', refunded: 'Refunded' }

  return <div className="screen" style={{ paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Back</button>
    <h1 className="page-title">Hyperion Account</h1>
    <p className="subtitle">Create an account to subscribe to individual review tracks for 12 months.</p>
    {!supabaseConfigured && <div style={{ ...card, borderColor: 'var(--danger)' }}><strong>Supabase is not configured yet.</strong><p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Cloudflare Pages environment variables.</p></div>}
    {params.get('payment') === 'success' && <div style={card}>Payments are verified manually. A return to this page does not grant access.</div>}
    {message && <div role="status" style={{ ...card, lineHeight: 1.5 }}>{message}</div>}
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
    </section> : <>
      <section style={card}>
        <div style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>SIGNED IN AS</div><strong style={{ overflowWrap: 'anywhere' }}>{session.user.email}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '.8rem' }}>
          <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/payments')}>Admin dashboard</button>
          <button type="button" className="btn btn-outline" onClick={async () => { await supabase?.auth.signOut(); setMessage('Signed out.') }}>Sign out</button>
        </div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Your purchased access</h2>
        {owned.length ? owned.map(item => <div key={item.product_code} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code} · expires {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>) : <p style={{ color: 'var(--text-muted)' }}>No approved purchases are linked to this account yet.</p>}
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Manual payment instructions</h2>
        <div style={{ whiteSpace: 'pre-wrap', lineHeight: 1.6 }}>{instructions}</div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Submit payment details</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', lineHeight: 1.5 }}>Each payment covers one individual track for 12 months. After paying, submit your transaction/reference number. A screenshot link is optional. Access starts after admin approval.</p>
        <form onSubmit={submitPayment}>
          <label style={label}>Choose an individual track (12-month subscription)<select value={product} onChange={e => setProduct(e.target.value)} style={field}>{PAID_PRODUCTS.map(item => <option key={item.code} value={item.code}>{item.label} · ₱{item.annualPrice}/year</option>)}</select></label>
          <label style={label}>Payment method<input required maxLength={80} placeholder="Enter the payment method" value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} style={field} /></label>
          <label style={label}>Transaction/reference number<input required maxLength={160} value={reference} onChange={e => setReference(e.target.value)} style={field} /></label>
          <label style={label}>Proof of payment link (optional)<input type="url" placeholder="https://…" value={proofUrl} onChange={e => setProofUrl(e.target.value)} style={field} /></label>
          <label style={label}>Additional note (optional)<textarea maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} style={field} /></label>
          <button type="submit" className="btn btn-primary" disabled={busy || !supabaseConfigured} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Submitting…' : 'SUBMIT FOR REVIEW'}</button>
        </form>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Payment submissions</h2>
        <button type="button" className="btn btn-outline" onClick={() => void refreshAccount()}>Refresh status</button>
        {orders.length ? orders.map(order => <div key={order.id} style={{ padding: '.8rem 0', borderBottom: '1px solid var(--border)' }}>
          <strong>{PAID_PRODUCTS.find(p => p.code === order.product_code)?.label ?? order.product_code} · ₱{order.amount_php}</strong>
          <div style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginTop: 4 }}>{statusLabel[order.status] || order.status} · {new Date(order.created_at).toLocaleString()}</div>
          <div style={{ fontSize: '.8rem', overflowWrap: 'anywhere' }}>Reference: {order.payment_reference || 'Not provided'} · Order: {order.id}</div>
          {order.admin_note && <p style={{ marginBottom: 0 }}>Admin note: {order.admin_note}</p>}
        </div>) : <p style={{ color: 'var(--text-muted)' }}>No payment submissions yet.</p>}
      </section>
    </>}
  </div>
}
