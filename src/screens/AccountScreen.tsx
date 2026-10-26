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
  const [accountTab, setAccountTab] = useState<'licenses' | 'payments'>('payments')
  const [product, setProduct] = useState('oic_nw')
  const paymentMethod = 'QR Ph (MariBank / InstaPay)'
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [school, setSchool] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const facebookPage = 'https://www.facebook.com/hyperionbynhyle'
  const qrPhImage = '/qr-ph.png'
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
    if (params.get('oauth_popup') !== '1' || !session || !window.opener) return
    // The popup has its own storage context, so pass the authenticated session
    // back to the canonical-origin opener before closing.
    window.opener.postMessage({
      type: 'hyperion-oauth-success',
      access_token: session.access_token,
      refresh_token: session.refresh_token,
    }, 'https://hyperionmaritime.org')
    window.close()
  }, [params, session?.access_token, session?.refresh_token])

  useEffect(() => {
    const metadata = session?.user.user_metadata ?? {}
    setFullName(typeof metadata.full_name === 'string' ? metadata.full_name : '')
    setCompany(typeof metadata.company === 'string' ? metadata.company : '')
    setSchool(typeof metadata.school === 'string' ? metadata.school : '')
  }, [session?.user.id])
  useEffect(() => {
    if (!supabase || !session) { setIsAdmin(false); return }
    let active = true
    void supabase.functions.invoke('admin-payment-review', { body: { action: 'check-admin' } })
      .then(({ data, error }) => { if (active) setIsAdmin(!error && data?.isAdmin === true) })
      .catch(() => { if (active) setIsAdmin(false) })
    return () => { active = false }
  }, [session?.user.id])
  const saveProfile = async () => {
    if (!supabase || !session) return
    if (!fullName.trim()) { setMessage('Please enter your full name.'); return }
    setBusy(true); setMessage('Saving your profile…')
    try {
      const { data, error } = await supabase.auth.updateUser({ data: { full_name: fullName.trim(), company: company.trim(), school: school.trim() } })
      if (error) throw error
      if (data.user) setSession(current => current ? { ...current, user: data.user! } : current)
      setMessage('Your Profile has been saved.')
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Could not save profile details.') }
    finally { setBusy(false) }
  }
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
  useEffect(() => {
    const handleOAuthMessage = (event: MessageEvent) => {
      if (event.origin !== 'https://hyperionmaritime.org') return
      if (event.data?.type !== 'hyperion-oauth-success' || !event.data.access_token || !event.data.refresh_token || !supabase) return
      void supabase.auth.setSession({
        access_token: event.data.access_token,
        refresh_token: event.data.refresh_token,
      }).then(({ error }) => {
        if (error) setMessage(error.message)
        setBusy(false)
      })
    }
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [])

  const openOAuthPopup = async (provider: 'google' | 'facebook') => {
    if (!supabase) return
    // Open synchronously from the click so browsers don't block the popup.
    const popup = window.open('about:blank', 'hyperion-oauth', 'popup=yes,width=520,height=700')
    if (!popup) {
      setMessage('Your browser blocked the sign-in popup. Allow pop-ups for hyperionmaritime.org and try again.')
      return
    }
    setBusy(true)
    setMessage('')
    // If the user closes the provider popup without signing in, release the form's busy state.
    const popupClosePoll = window.setInterval(() => {
      if (popup.closed) {
        window.clearInterval(popupClosePoll)
        setBusy(false)
      }
    }, 400)
    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: 'https://hyperionmaritime.org/account?oauth_popup=1',
          skipBrowserRedirect: true,
        },
      })
      if (error) throw error
      if (!data.url) throw new Error('The sign-in provider did not return a login URL.')
      popup.location.href = data.url
      popup.focus()
    } catch (error) {
      window.clearInterval(popupClosePoll)
      popup.close()
      setMessage(error instanceof Error ? error.message : `Unable to start ${provider} sign-in. Please try again.`)
      setBusy(false)
    }
  }

  const signInWithGoogle = async () => openOAuthPopup('google')
  const signInWithFacebook = async () => openOAuthPopup('facebook')

  const submitAuth = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase) return
    setBusy(true); setMessage('')
    try {
      const result = mode === 'signup'
        ? await supabase.auth.signUp({ email: email.trim(), password })
        : await supabase.auth.signInWithPassword({ email: email.trim(), password })
      if (result.error) {
        const authMessage = result.error.message
        if (mode === 'signup' && /already registered|already exists|user already/i.test(authMessage)) {
          setMessage('An account with this email already exists. Please select Sign in and use your existing password.')
        } else {
          setMessage(authMessage)
        }
      } else if (mode === 'signup' && (result.data.user?.identities?.length === 0)) {
        setMessage('An account with this email already exists. Please select Sign in and use your existing password.')
      } else if (mode === 'signup' && !result.data.session) {
        setMessage('Account created. Check your email to confirm your address, then sign in.')
      } else {
        setMessage(mode === 'signup' ? 'Account created.' : 'Signed in successfully.')
      }
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to process your account request. Please try again.')
    } finally {
      setBusy(false)
    }
  }
  const submitPayment = async (event: FormEvent) => {
    event.preventDefault()
    if (!supabase || !session) return
    setBusy(true); setMessage('Submitting your payment for manual review…')
    try {
      const { data, error } = await supabase.functions.invoke('submit-manual-payment', { body: { productCode: product, paymentMethod, paymentReference: reference, customerNote: note, customerProfile: { fullName: fullName.trim(), company: company.trim(), school: school.trim() } } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage(`Payment details submitted. Your reference is ${data.order.id}. Please send your payment screenshot to our Facebook page. Access will be enabled after manual verification.`)
      setReference(''); setNote('')
      await refreshAccount()
    } catch (error) { setMessage(error instanceof Error ? error.message : 'Unable to submit payment. Please try again.') }
    finally { setBusy(false) }
  }
  const card: React.CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', marginBottom: '1rem', borderRadius: 10 }
  const field: React.CSSProperties = { width: '100%', boxSizing: 'border-box', padding: '.8rem', marginTop: '.35rem', background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 6, font: 'inherit' }
  const label: React.CSSProperties = { display: 'block', marginTop: '.8rem' }
  const statusLabel: Record<string,string> = { submitted: 'Awaiting manual review', pending: 'Awaiting payment review', paid: 'Approved', failed: 'Rejected', refunded: 'Refunded', cancelled: 'Cancelled by you' }
  const pendingOrder = orders.find(order => order.product_code === product && ['submitted', 'pending'].includes(order.status))
  const cancelReview = async () => {
    if (!supabase || !pendingOrder) return
    setBusy(true); setMessage('Cancelling your review request…')
    try {
      const { data, error } = await supabase.functions.invoke('cancel-payment-review', { body: { orderId: pendingOrder.id } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      setMessage('Your payment review request has been cancelled. You can submit again if needed.')
      await refreshAccount()
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to cancel the review request. Please refresh and try again.')
    } finally { setBusy(false) }
  }

  return <div className="screen" style={{ width: 'min(calc(100% - 2rem), 760px)', margin: '0 auto', paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(-1)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Back</button>
    <h1 className="page-title" style={{ textAlign: 'center' }}>Hyperion Account</h1>
    <p className="subtitle" style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 1.25rem' }}>Create an account to subscribe to individual review tracks for 12 months.</p>
    {!session ? <section style={{ ...card, maxWidth: 460, margin: '1.5rem auto' }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: '1rem' }}>
        <button type="button" className={mode === 'signup' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMode('signup')} style={{ flex: 1 }}>Create account</button>
        <button type="button" className={mode === 'signin' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setMode('signin')} style={{ flex: 1 }}>Sign in</button>
      </div>
      <button
        type="button"
        className="btn btn-outline"
        disabled={!supabaseConfigured || busy}
        onClick={() => void signInWithGoogle()}
        style={{ width: '100%', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.65rem', minHeight: 46 }}
      >
        <svg aria-hidden="true" viewBox="0 0 48 48" width="20" height="20">
          <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.02 13.22l7.98 6.19C11.89 13.72 17.48 9.5 24 9.5Z"/>
          <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.72 7.18l7.62 5.91c4.45-4.11 7.14-10.16 7.14-17.56Z"/>
          <path fill="#FBBC05" d="M9.99 28.59A14.4 14.4 0 0 1 9.2 24c0-1.59.27-3.13.76-4.59l-7.98-6.19A23.9 23.9 0 0 0 0 24c0 3.87.93 7.52 2.57 10.78l7.42-6.19Z"/>
          <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.91-5.89l-7.62-5.91c-2.11 1.41-4.81 2.25-8.29 2.25-6.52 0-12.11-4.22-14-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48Z"/>
        </svg>
        Continue with Google
      </button>
      <button
        type="button"
        className="btn btn-outline"
        disabled={!supabaseConfigured || busy}
        onClick={() => void signInWithFacebook()}
        style={{ width: '100%', marginBottom: '1rem', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '.65rem', minHeight: 46 }}
      >
        <svg aria-hidden="true" viewBox="0 0 24 24" width="20" height="20">
          <path fill="#1877F2" d="M24 12a12 12 0 1 0-13.875 11.85v-8.38H7.08V12h3.045V9.35c0-3.005 1.79-4.665 4.53-4.665 1.312 0 2.686.234 2.686.234v2.953h-1.512c-1.49 0-1.954.925-1.954 1.874V12h3.324l-.531 3.47h-2.793v8.38A12.002 12.002 0 0 0 24 12Z"/>
        </svg>
        Continue with Facebook
      </button>
      <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', color: 'var(--text-muted)', fontSize: '.8rem', marginBottom: '1rem' }}>
        <span style={{ height: 1, background: 'var(--border)', flex: 1 }} />
        OR CONTINUE WITH EMAIL
        <span style={{ height: 1, background: 'var(--border)', flex: 1 }} />
      </div>
      <form onSubmit={submitAuth}>
        <label>Email address<input type="email" required autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} style={field} /></label>
        <label style={{ display: 'block', marginTop: '1rem' }}>Password<input type="password" required minLength={8} autoComplete={mode === 'signup' ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} style={field} /></label>
        <button type="submit" className="btn btn-primary" disabled={!supabaseConfigured || busy} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Please wait…' : mode === 'signup' ? 'CREATE ACCOUNT' : 'SIGN IN'}</button>
      </form>
      {message && <div role="status" style={{ ...card, lineHeight: 1.5, marginTop: '1rem', marginBottom: 0 }}>{message}</div>}
      {!supabaseConfigured && <div role="alert" style={{ ...card, borderColor: 'var(--danger)', marginTop: '1rem', marginBottom: 0 }}><strong>Supabase is not configured yet.</strong><p style={{ marginBottom: 0, color: 'var(--text-muted)' }}>Set VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY in Cloudflare Pages environment variables.</p></div>}
      {params.get('payment') === 'success' && <div role="status" style={{ ...card, marginTop: '1rem', marginBottom: 0 }}>Payments are verified manually. A return to this page does not grant access.</div>}
    </section> : <>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>{isAdmin && <span style={{ display: 'inline-block', border: '1px solid #16a34a', background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '0.35rem 0.8rem', fontWeight: 800, fontSize: '0.82rem', letterSpacing: '0.04em' }}>✓ VERIFIED ADMIN · ALL ACCESS</span>}</div>
      <div role="tablist" aria-label="Account sections" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: '1rem' }}>
        <button type="button" role="tab" aria-selected={accountTab === 'payments'} className={accountTab === 'payments' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setAccountTab('payments')}>Payments & profile</button>
        <button type="button" role="tab" aria-selected={accountTab === 'licenses'} className={accountTab === 'licenses' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setAccountTab('licenses')}>Active licenses</button>
      </div>
      {accountTab === 'licenses' ? <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Active licenses</h2>
        {owned.length ? owned.map(item => <div key={item.product_code} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code} · expires {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>) : <p style={{ color: 'var(--text-muted)' }}>No approved subscriptions are linked to this account yet.</p>}
      </section> : <>
      <section style={card}>
        <div style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>SIGNED IN AS</div><strong style={{ overflowWrap: 'anywhere' }}>{session.user.email}</strong>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: '.8rem' }}>
          {isAdmin && <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/payments')}>Admin dashboard</button>}
          <button type="button" className="btn btn-outline" onClick={async () => { await supabase?.auth.signOut(); setMessage('Signed out.') }}>Sign out</button>
        </div>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Your profile</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', lineHeight: 1.5 }}>Please provide your full name. Company and school are optional. These details may be displayed on our page when you pass the MARINA Licensure Examination.</p>
        <label style={label}>Full name<input required maxLength={160} value={fullName} onChange={e => setFullName(e.target.value)} style={field} /></label>
        <label style={label}>Company (optional)<input maxLength={160} value={company} onChange={e => setCompany(e.target.value)} style={field} /></label>
        <label style={label}>School (optional)<input maxLength={160} value={school} onChange={e => setSchool(e.target.value)} style={field} /></label>
        <button type="button" className="btn btn-primary" disabled={busy || !fullName.trim()} onClick={() => void saveProfile()} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Please wait…' : 'SAVE PROFILE'}</button>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Your purchased access</h2>
        {owned.length ? owned.map(item => <div key={item.product_code} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code} · expires {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>) : <p style={{ color: 'var(--text-muted)' }}>No approved purchases are linked to this account yet.</p>}
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Payment Instructions</h2>
        <ol style={{ paddingLeft: '1.3rem', lineHeight: 1.65, marginBottom: 0 }}>
          <li>Select the exam/reviewer track you want to purchase from the dropdown below.</li>
          <li>Scan the QR Ph code and send the exact amount for your selected track. Each payment covers one track for 12 months. Double-check the amount before confirming your transfer.<ul style={{ marginTop: '.5rem', paddingLeft: '1.25rem' }}>{PAID_PRODUCTS.map(item => <li key={item.code}>{item.label} - ₱{item.annualPrice}/year</li>)}</ul></li>
          <li>After paying, enter your transaction/reference number in the field below. Then tap <strong>Send Proof to Our Facebook Page</strong> and send a screenshot of your payment in Messenger.</li>
          <li>Use the Additional notes field if you need to explain anything about your payment or proof of purchase.</li>
          <li>Finally, click <strong>SUBMIT FOR REVIEW</strong>. Your payment will not be sent for review unless you click this button. Access is granted only after manual verification.</li>
        </ol>
      </section>
      <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Submit payment details</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.9rem', lineHeight: 1.5 }}>Each payment covers one individual track for 12 months. Send the exact amount shown for the reviewer track you selected. Incorrect or short payments may delay approval. Access starts only after manual verification.</p>
        <label style={label}>Choose an individual track (12-month subscription)<select value={product} onChange={e => setProduct(e.target.value)} style={field}>{PAID_PRODUCTS.map(item => <option key={item.code} value={item.code}>{item.label} · ₱{item.annualPrice}/year</option>)}</select></label>
        {pendingOrder ? <div style={{ ...card, marginTop: '.9rem', borderColor: 'var(--warning, #eab308)' }}>
          <strong>You already submitted this track for review.</strong>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>Your payment submission is awaiting manual review. You do not need to submit it again. If you submitted the wrong details or want to withdraw this request, cancel it below.</p>
          <div style={{ fontSize: '.85rem', overflowWrap: 'anywhere', marginBottom: '.8rem' }}>Order: {pendingOrder.id}</div>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancelReview()} style={{ width: '100%' }}>{busy ? 'Please wait…' : 'CANCEL REVIEW REQUEST'}</button>
        </div> : <form onSubmit={submitPayment}>
          <div style={{ ...card, textAlign: 'center', marginTop: '.9rem', background: '#fff', color: '#172033' }}>
            <div style={{ fontWeight: 800, fontSize: '1.05rem', marginBottom: '.25rem' }}>QR Ph · MariBank / InstaPay</div>
            <p style={{ margin: '0 0 .75rem', color: '#4b5563', fontSize: '.9rem' }}>Scan this QR code using your bank or e-wallet app.</p>
            <img src={qrPhImage} alt="MariBank InstaPay QR Ph payment code" style={{ display: 'block', width: 'min(100%, 340px)', height: 'auto', margin: '0 auto', imageRendering: 'pixelated' }} />
            <p style={{ margin: '.75rem 0 0', color: '#4b5563', fontSize: '.85rem' }}>Account name and bank details are shown on the QR code. Verify the recipient in your payment app before sending.</p>
          </div>
          <div style={{ padding: '.85rem', border: '1px solid var(--border)', borderRadius: 8, marginTop: '.75rem', lineHeight: 1.5 }}>
            <strong>Amount to send: ₱{PAID_PRODUCTS.find(item => item.code === product)?.annualPrice ?? 0}</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: '.9rem', marginTop: '.25rem' }}>Send the exact amount for {PAID_PRODUCTS.find(item => item.code === product)?.label ?? product} only. This payment covers one reviewer track for 12 months. Please double-check the selected track and amount before confirming your transfer.</div>
          </div>
          <label style={label}>Payment method<input value="QR Ph (MariBank / InstaPay)" readOnly style={field} /></label>
          <label style={label}>Transaction/reference number<input required maxLength={160} value={reference} onChange={e => setReference(e.target.value)} style={field} /></label>
          <div style={label}>
            <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', lineHeight: 1.5 }}>After sending the payment, use the button below to send your payment screenshot to our Facebook page. Your subscription can only be approved after the payment is verified.</p>
            <a href={facebookPage} target="_blank" rel="noopener noreferrer" className="btn btn-primary" style={{ display: 'block', textAlign: 'center', textDecoration: 'none', marginTop: '.5rem' }}>SEND PROOF TO OUR FACEBOOK PAGE</a>
          </div>
          <label style={label}>Additional notes (optional)<textarea maxLength={1000} rows={3} value={note} onChange={e => setNote(e.target.value)} style={field} /></label>
          <button type="submit" className="btn btn-primary" disabled={busy || !supabaseConfigured} style={{ width: '100%', marginTop: '1rem' }}>{busy ? 'Submitting…' : 'SUBMIT FOR REVIEW'}</button>
        </form>}
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
    </>}
  </div>
}
