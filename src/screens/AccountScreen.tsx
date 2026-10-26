import { useEffect, useRef, useState } from 'react'
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
  const oauthPopupRef = useRef<Window | null>(null)
  const oauthOutcomeRef = useRef<'success' | 'error' | null>(null)
  const [accountTab, setAccountTab] = useState<'licenses' | 'payments' | 'delete'>('payments')
  const [product, setProduct] = useState('oic_nw')
  const paymentMethod = 'QR Ph (MariBank / InstaPay)'
  const [reference, setReference] = useState('')
  const [note, setNote] = useState('')
  const [fullName, setFullName] = useState('')
  const [company, setCompany] = useState('')
  const [school, setSchool] = useState('')
  const [profileEditing, setProfileEditing] = useState(false)
  const [savedProfile, setSavedProfile] = useState({ fullName: '', company: '', school: '' })
  const [isAdmin, setIsAdmin] = useState(false)
  const facebookPage = 'https://www.facebook.com/hyperionbynhyle'
  const qrPhImage = '/qr-ph.png'
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
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
    const metadata = session?.user.user_metadata ?? {}
    setFullName(typeof metadata.full_name === 'string' ? metadata.full_name : '')
    setCompany(typeof metadata.company === 'string' ? metadata.company : '')
    setSchool(typeof metadata.school === 'string' ? metadata.school : '')
    setSavedProfile({
      fullName: typeof metadata.full_name === 'string' ? metadata.full_name : '',
      company: typeof metadata.company === 'string' ? metadata.company : '',
      school: typeof metadata.school === 'string' ? metadata.school : '',
    })
    setProfileEditing(false)
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
      setSavedProfile({ fullName: fullName.trim(), company: company.trim(), school: school.trim() })
      setProfileEditing(false)
      setMessage('Your profile has been saved.')
    } catch { setMessage('Unable to save profile details. Please try again.') }
    finally { setBusy(false) }
  }
  const refreshAccount = async () => {
    if (!supabase || !session?.user.id) { setOwned([]); setOrders([]); return }
    const [entitlements, orderResult] = await Promise.all([
      supabase.from('entitlements').select('product_code,expires_at').eq('user_id', session.user.id).eq('status', 'active').gt('expires_at', new Date().toISOString()),
      supabase.from('orders').select('id,product_code,amount_php,status,payment_reference,created_at,admin_note').eq('user_id', session.user.id).order('created_at', { ascending: false }).limit(50)
    ])
    if (entitlements.error) setMessage('Unable to refresh account details. Please try again.')
    else setOwned((entitlements.data ?? []) as OwnedTrack[])
    if (orderResult.error) setMessage('Unable to refresh payment history. Please try again.')
    else setOrders((orderResult.data ?? []) as Order[])
    await refreshCloudEntitlements()
  }
  useEffect(() => { void refreshAccount() }, [session?.user.id])
  useEffect(() => {
    const authClient = supabase
    const handleOAuthMessage = async (event: MessageEvent) => {
      if (event.origin !== 'https://hyperionmaritime.org') return
      if (oauthPopupRef.current && event.source !== oauthPopupRef.current) return
      if (event.data?.type === 'hyperion-oauth-error') {
        oauthOutcomeRef.current = 'error'
        setMessage('Sign-in could not be completed. Please try again.')
        setBusy(false)
        return
      }
      if (event.data?.type !== 'hyperion-oauth-success' || !authClient) return

      try {
        const { data, error } = await authClient.auth.getSession()
        if (error) throw error
        if (!data.session) {
          setMessage('Sign-in could not be completed. Please try again.')
          oauthOutcomeRef.current = 'error'
          return
        }
        oauthOutcomeRef.current = 'success'
        setSession(data.session)
        setMessage('Signed in successfully.')
        const requested = typeof event.data.return_to === 'string' ? event.data.return_to : '/'
        navigate(requested.startsWith('/') && !requested.startsWith('//') ? requested : '/', { replace: true })
        // Close the popup immediately after session confirmation. Do not wait for
        // entitlement refresh/network requests, which may take longer or fail.
        const popup = oauthPopupRef.current
        if (popup && !popup.closed) popup.close()
        if (popup && popup.closed && oauthPopupRef.current === popup) oauthPopupRef.current = null
        await refreshCloudEntitlements()
      } catch {
        oauthOutcomeRef.current = 'error'
        setMessage('Sign-in could not be completed. Please try again.')
      } finally {
        setBusy(false)
      }
    }
    window.addEventListener('message', handleOAuthMessage)
    return () => window.removeEventListener('message', handleOAuthMessage)
  }, [navigate, refreshCloudEntitlements])

  const openOAuthPopup = async () => {
    if (!supabase) {
      setMessage('Sign-in is temporarily unavailable. Please try again later.')
      return
    }
    const authClient = supabase

    const requestedReturnTo = window.location.pathname + window.location.search + window.location.hash
    const returnTo = requestedReturnTo.startsWith('/') && !requestedReturnTo.startsWith('//') ? requestedReturnTo : '/'
    try {
      localStorage.setItem('hyperion-oauth-return-to', JSON.stringify({ path: returnTo, startedAt: Date.now() }))
    } catch {
      // The callback still has a safe dashboard fallback if browser storage is blocked.
    }
    const popup = window.open('about:blank', 'hyperion-oauth', 'popup=yes,width=520,height=700')
    if (!popup) {
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      setMessage('Your browser blocked the sign-in popup. Allow pop-ups for hyperionmaritime.org and try again.')
      return
    }

    oauthPopupRef.current = popup
    oauthOutcomeRef.current = null
    setBusy(true)
    setMessage('')

    // If the browser drops window.opener during the external-provider roundtrip,
    // recover from the shared same-origin Supabase session once the popup closes.
    let sessionCheckInFlight = false
    const popupClosePoll = window.setInterval(() => {
      // Some browsers complete the OAuth redirect in the popup but fail to
      // deliver the postMessage/opener relationship afterward. Detect the
      // shared Supabase session from the main window and close the popup here.
      if (!popup.closed && oauthOutcomeRef.current === null && !sessionCheckInFlight) {
        sessionCheckInFlight = true
        void authClient.auth.getSession().then(async ({ data, error }) => {
          if (error || !data.session || popup.closed || oauthOutcomeRef.current !== null) return

          oauthOutcomeRef.current = 'success'
          window.clearInterval(popupClosePoll)
          if (oauthPopupRef.current === popup) oauthPopupRef.current = null
          try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
          setSession(data.session)
          setMessage('Signed in successfully.')
          navigate(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', { replace: true })
          popup.close()
          setBusy(false)
          await refreshCloudEntitlements()
        }).catch(() => {
          // Keep polling; the callback may still be completing.
        }).finally(() => {
          sessionCheckInFlight = false
        })
        return
      }

      if (!popup.closed) return
      window.clearInterval(popupClosePoll)
      if (oauthPopupRef.current === popup) oauthPopupRef.current = null
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      // The message handler may already have confirmed the session and closed
      // the popup. Do not run the recovery flow a second time.
      if (oauthOutcomeRef.current === 'success') {
        setBusy(false)
        return
      }
      void (async () => {
        try {
          const { data, error } = await authClient.auth.getSession()
          if (error) throw error
          if (data.session) {
            oauthOutcomeRef.current = 'success'
            setSession(data.session)
            setMessage('Signed in successfully.')
            navigate(returnTo.startsWith('/') && !returnTo.startsWith('//') ? returnTo : '/', { replace: true })
            await refreshCloudEntitlements()
          } else if (oauthOutcomeRef.current !== 'error') {
            setMessage('Sign-in could not be completed. Please try again.')
          }
        } catch {
          if (oauthOutcomeRef.current !== 'error') {
            setMessage('Sign-in could not be completed. Please try again.')
          }
        } finally {
          setBusy(false)
        }
      })()
    }, 300)

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: 'https://hyperionmaritime.org/auth/callback',
          skipBrowserRedirect: true,
        },
      })
      if (error) throw error
      if (!data.url) throw new Error('The sign-in provider did not return a login URL.')
      popup.location.href = data.url
      popup.focus()
    } catch {
      window.clearInterval(popupClosePoll)
      popup.close()
      if (oauthPopupRef.current === popup) oauthPopupRef.current = null
      try { localStorage.removeItem('hyperion-oauth-return-to') } catch { /* ignore */ }
      setMessage('Sign-in could not be completed. Please try again.')
      setBusy(false)
    }
  }

  const signInWithGoogle = async () => openOAuthPopup()

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
  const profileField = (editable: boolean): React.CSSProperties => ({ ...field, background: editable ? 'var(--bg-elevated)' : 'var(--bg)', color: editable ? 'var(--text)' : 'var(--text-muted)', border: editable ? '1px solid var(--border)' : '1px solid #cbd5e1', boxShadow: 'none', outline: 'none', cursor: editable ? 'text' : 'default', userSelect: editable ? 'text' : 'none', WebkitUserSelect: editable ? 'text' : 'none', pointerEvents: editable ? 'auto' : 'none', caretColor: editable ? 'auto' : 'transparent' })
  const label: React.CSSProperties = { display: 'block', marginTop: '.8rem' }
  const statusLabel: Record<string,string> = { submitted: 'Awaiting manual review', pending: 'Awaiting payment review', paid: 'Approved', failed: 'Rejected', refunded: 'Refunded', cancelled: 'Cancelled by you' }
  const pendingOrder = orders.find(order => order.product_code === product && ['submitted', 'pending'].includes(order.status))
  const deleteAccount = async () => {
    if (!supabase || !session || deleteConfirmation !== 'DELETE') return
    setBusy(true)
    setMessage('Deleting your account and associated account data…')
    try {
      const { data, error } = await supabase.functions.invoke('delete-account', { body: { confirmation: 'DELETE' } })
      if (error) throw error
      if (data?.error) throw new Error(data.error)
      await supabase.auth.signOut()
      setSession(null)
      setOwned([])
      setOrders([])
      setDeleteConfirmOpen(false)
      setDeleteConfirmation('')
      setMessage('Your Hyperion account has been deleted.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Unable to delete your account. Please try again or contact support.')
    } finally {
      setBusy(false)
    }
  }

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
    <p className="subtitle" style={{ textAlign: 'center', maxWidth: 520, margin: '0 auto 1.25rem' }}>Sign in to Hyperion Maritime with Google to access your account and review-track subscriptions.</p>
    {!session ? <section style={{ ...card, maxWidth: 460, margin: '1.5rem auto' }}>
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
      {/* Intentionally omit sign-in error notices; keep provider diagnostics off the user-facing screen. */}
      
      {params.get('payment') === 'success' && <div role="status" style={{ ...card, marginTop: '1rem', marginBottom: 0 }}>Payments are verified manually. A return to this page does not grant access.</div>}
    </section> : <>
      <div style={{ display: 'flex', justifyContent: 'center', marginBottom: '1rem' }}>{isAdmin && <span style={{ display: 'inline-block', border: '1px solid #16a34a', background: '#dcfce7', color: '#166534', borderRadius: 999, padding: '0.35rem 0.8rem', fontWeight: 800, fontSize: '0.82rem', letterSpacing: '0.04em' }}>✓ VERIFIED ADMIN · ALL ACCESS</span>}</div>
      <div role="tablist" aria-label="Account sections" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', gap: 8, marginBottom: '1rem' }}>
        <button type="button" role="tab" aria-selected={accountTab === 'payments'} className={accountTab === 'payments' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setAccountTab('payments')}>Payments & profile</button>
        <button type="button" role="tab" aria-selected={accountTab === 'licenses'} className={accountTab === 'licenses' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setAccountTab('licenses')}>Active licenses</button>
        <button type="button" role="tab" aria-selected={accountTab === 'delete'} className={accountTab === 'delete' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setAccountTab('delete')} style={accountTab === 'delete' ? { background: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' } : { color: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}>Delete account</button>
      </div>
      {accountTab === 'licenses' ? <section style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem' }}>Active licenses</h2>
        {owned.length ? owned.map(item => <div key={item.product_code} style={{ padding: '.5rem 0', borderBottom: '1px solid var(--border)' }}>✓ {PAID_PRODUCTS.find(p => p.code === item.product_code)?.label ?? item.product_code} · expires {item.expires_at ? new Date(item.expires_at).toLocaleDateString() : 'date unavailable'}</div>) : <p style={{ color: 'var(--text-muted)' }}>No approved subscriptions are linked to this account yet.</p>}
      </section> : accountTab === 'delete' ? <section style={{ ...card, borderColor: 'var(--danger, #dc2626)' }}>
        <h2 style={{ marginTop: 0, fontSize: '1.1rem', color: 'var(--danger, #dc2626)' }}>Delete account</h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.55 }}>Permanently delete your Hyperion account, linked licenses, and payment submissions associated with this account. This action cannot be undone. It does not delete records retained independently by Google Play, Google, or Facebook.</p>
        {!deleteConfirmOpen ? <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setDeleteConfirmation(''); setDeleteConfirmOpen(true) }} style={{ width: '100%', borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)' }}>DELETE MY ACCOUNT</button> : <div>
          <label style={label}>To confirm, type DELETE below<input autoComplete="off" value={deleteConfirmation} onChange={e => setDeleteConfirmation(e.target.value)} style={field} /></label>
          <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setDeleteConfirmOpen(false); setDeleteConfirmation('') }} style={{ flex: 1 }}>Cancel</button>
            <button type="button" className="btn btn-primary" disabled={busy || deleteConfirmation !== 'DELETE'} onClick={() => void deleteAccount()} style={{ flex: 1, background: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}>{busy ? 'Deleting…' : 'Permanently delete'}</button>
          </div>
        </div>}
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
        <label style={label}>Full name<input required maxLength={160} readOnly={!profileEditing} value={fullName} onChange={e => setFullName(e.target.value)} style={profileField(profileEditing)} /></label>
        <label style={label}>Company (optional)<input maxLength={160} readOnly={!profileEditing} value={company} onChange={e => setCompany(e.target.value)} style={{ ...field, opacity: profileEditing ? 1 : 0.8, cursor: profileEditing ? 'text' : 'default' }} /></label>
        <label style={label}>School (optional)<input maxLength={160} readOnly={!profileEditing} value={school} onChange={e => setSchool(e.target.value)} style={{ ...field, opacity: profileEditing ? 1 : 0.8, cursor: profileEditing ? 'text' : 'default' }} /></label>
        {!profileEditing ? <button type="button" className="btn btn-primary" disabled={busy} onClick={() => { setMessage(''); setProfileEditing(true) }} style={{ width: '100%', marginTop: '1rem' }}>EDIT PROFILE</button> : <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => { setFullName(savedProfile.fullName); setCompany(savedProfile.company); setSchool(savedProfile.school); setProfileEditing(false); setMessage('') }} style={{ flex: 1 }}>CANCEL</button>
          <button type="button" className="btn btn-primary" disabled={busy || !fullName.trim() || (fullName.trim() === savedProfile.fullName && company.trim() === savedProfile.company && school.trim() === savedProfile.school)} onClick={() => void saveProfile()} style={{ flex: 1 }}>{busy ? 'Please wait…' : 'SAVE CHANGES'}</button>
        </div>}
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
