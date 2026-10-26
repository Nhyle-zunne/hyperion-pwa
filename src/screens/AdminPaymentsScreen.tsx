import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Order = { id: string; user_id: string; email: string; product_code: string; track_id: string; license_term: 'week'|'month'|'year'; amount_php: number; status: string; access_status: string; access_expires_at: string | null; payment_reference: string | null; payment_method: string | null; proof_url: string | null; customer_note: string | null; customer_name: string | null; customer_company: string | null; customer_school: string | null; admin_note: string | null; created_at: string }
function safeAdminError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (!message || /supabase|postgrest|postgres|sqlstate|provider credentials|redirect settings|edge function|row[- ]level security|\bpgrst\b|\bjwt\b|database schema|relation .* does not exist|violates .* constraint/i.test(message)) return fallback
  return message
}
const names: Record<string,string> = { oic_nw:'Deck OIC-NW', gmdss:'GMDSS GOC', engine_ew:'Engine OIC-EW', deck_mgt:'Deck Management', engine_mgt:'Engine Management', all_access:'All-Access Bundle' }
export default function AdminPaymentsScreen() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [note, setNote] = useState<Record<string,string>>({})
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  const [authorized, setAuthorized] = useState(false)
  const [bankStatus, setBankStatus] = useState<'loading'|'pending'|'running'|'complete'|'failed'|'unknown'>('loading')
  const [bankAssetCount, setBankAssetCount] = useState(0)
  const [bankBusy, setBankBusy] = useState(false)
  const [bankMessage, setBankMessage] = useState('')
  const call = useCallback(async (body: Record<string,unknown>) => {
    if (!supabase) throw new Error('Payment administration is temporarily unavailable. Please try again later.')
    const { data, error } = await supabase.functions.invoke('admin-payment-review', { body })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }, [])
  const load = useCallback(async () => {
    try {
      const result = await call({ action: 'list' })
      setOrders(result.orders || [])
      setAuthorized(true)
    } catch (e) { setAuthorized(false); setMessage(safeAdminError(e, 'Unable to load payment submissions. Please retry.')) }
  }, [call])
  useEffect(() => { void load() }, [load])
  const loadBankStatus = useCallback(async () => {
    if (!supabase) { setBankStatus('unknown'); return }
    try {
      const { data, error } = await supabase.functions.invoke('question-bank', { body: { action: 'status' } })
      if (error || data?.error) throw new Error('Could not check private question storage status.')
      setBankStatus(data.status || 'unknown')
      setBankAssetCount(Number(data.assetCount) || 0)
      setBankMessage(data.status === 'complete' ? 'All question files are copied to private storage. Public static copies remain until the protected loader is deployed.' : '')
    } catch {
      setBankStatus('unknown')
    }
  }, [])
  useEffect(() => { if (authorized) void loadBankStatus() }, [authorized, loadBankStatus])
  const migrateQuestionBank = async () => {
    if (!window.confirm('Copy all 69 encrypted question files from the current site into private Supabase Storage? This does not remove the currently working public copies.')) return
    setBankBusy(true)
    setBankMessage('')
    try {
      if (!supabase) throw new Error('Question storage migration is temporarily unavailable.')
      const { data, error } = await supabase.functions.invoke('question-bank', { body: { action: 'migrate' } })
      if (error || data?.error) throw new Error(data?.error || 'Could not complete private question storage migration.')
      setBankStatus(data.status || 'unknown')
      setBankAssetCount(Number(data.assetCount) || 0)
      setBankMessage(data.message || 'Question files copied to private storage.')
    } catch (e) {
      setBankStatus('failed')
      setBankMessage(e instanceof Error ? e.message : 'Question storage migration failed. Retry or inspect the migration status.')
      await loadBankStatus()
    } finally {
      setBankBusy(false)
    }
  }
  const review = async (orderId: string, decision: 'approve'|'reject') => {
    setBusy(true); setMessage('')
    try { await call({ action:'review', orderId, decision, adminNote: note[orderId] || '' }); setMessage(decision === 'approve' ? 'Payment approved and access granted.' : 'Payment rejected.'); await load() }
    catch (e) { setMessage(safeAdminError(e, 'Could not complete the payment review. Please try again.')) }
    finally { setBusy(false) }
  }
  const revoke = async (order: Order) => {
    if (!window.confirm(`Revoke ${names[order.product_code] || order.product_code} access for ${order.email}? The payment record will remain paid, but the license will no longer grant access.`)) return
    setBusy(true); setMessage('')
    try { await call({ action: 'revoke', orderId: order.id, adminNote: note[order.id] || '' }); setMessage('License access revoked. The payment record remains paid.'); await load() }
    catch (e) { setMessage(safeAdminError(e, 'Could not revoke license access. Please try again.')) }
    finally { setBusy(false) }
  }
  const duration = (term: Order['license_term']) => term === 'week' ? 'Weekly' : term === 'month' ? 'Monthly' : 'Yearly'

  const card: React.CSSProperties = { background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'1rem', marginBottom:'1rem' }
  const field: React.CSSProperties = { width:'100%', boxSizing:'border-box', padding:'.8rem', marginTop:'.4rem', background:'var(--bg-elevated)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, font:'inherit' }
  return <div className="screen" style={{ paddingBottom:'2rem' }}>
    <button type="button" onClick={() => navigate('/account')} style={{ color:'var(--text-muted)', marginBottom:'1rem' }}>← Account</button>
    <h1 className="page-title">Payment Admin</h1>
    <p className="subtitle">Only email addresses configured in the server-side ADMIN_EMAILS secret can review payments.</p>
    {message && <div role="status" style={card}>{/supabase/i.test(message) ? 'Payment administration is temporarily unavailable. Please try again later.' : message}</div>}
    {!authorized ? <section style={card}><p>Admin dashboard could not load. Confirm that you are signed in with an email listed in ADMIN_EMAILS, then refresh.</p><button className="btn btn-outline" onClick={() => void load()}>Retry</button></section> : <>
      <section style={{ ...card, borderColor: bankStatus === 'complete' ? 'var(--success, #15803d)' : 'var(--border)' }}>
        <h2 style={{ marginTop: 0 }}>Question-bank protection</h2>
        <p style={{ marginTop: 0, lineHeight: 1.5 }}>Copy the encrypted question files into private Supabase Storage before switching the app to protected question delivery. This one-time step does not delete the currently working public files.</p>
        <p style={{ fontWeight: 800 }}>Status: {bankStatus === 'complete' ? 'PRIVATE COPY COMPLETE' : bankStatus === 'running' || bankBusy ? 'COPYING FILES…' : bankStatus === 'failed' ? 'COPY FAILED' : bankStatus === 'pending' ? 'NOT COPIED YET' : bankStatus === 'unknown' ? 'STATUS UNAVAILABLE' : 'CHECKING…'} · {bankAssetCount}/69 files</p>
        {bankMessage && <p role="status" style={{ overflowWrap: 'anywhere', lineHeight: 1.5 }}>{bankMessage}</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          <button type="button" className="btn btn-primary" disabled={bankBusy || bankStatus === 'running' || bankStatus === 'complete'} onClick={() => void migrateQuestionBank()}>{bankBusy ? 'Copying encrypted files…' : bankStatus === 'failed' ? 'Retry private copy' : bankStatus === 'complete' ? 'Private copy complete' : 'Copy question banks to private storage'}</button>
          <button type="button" className="btn btn-outline" disabled={bankBusy} onClick={() => void loadBankStatus()}>Refresh status</button>
        </div>
      </section>
      <h2>Payment submissions ({orders.length})</h2>
      {orders.length ? orders.map(order => <section key={order.id} style={card}>
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:8 }}><strong>{names[order.product_code] || order.product_code} · {duration(order.license_term || 'year')} · ₱{order.amount_php}</strong><strong>{order.status.toUpperCase()}</strong></div>
        <p style={{ margin:'.6rem 0', overflowWrap:'anywhere' }}>{order.email}<br/>Submitted: {new Date(order.created_at).toLocaleString()}<br/>Order ID: {order.id}</p>
        <p style={{ margin:'.4rem 0' }}><strong>Customer name:</strong> {order.customer_name || 'Not provided'}{order.customer_company ? <><br/>Company: {order.customer_company}</> : null}{order.customer_school ? <><br/>School: {order.customer_school}</> : null}</p>
        <p style={{ margin:'.4rem 0' }}>Method: {order.payment_method || 'Not provided'}<br/>Transaction reference: {order.payment_reference || 'Not provided'}</p>
        {order.proof_url && <p><a href={order.proof_url} target="_blank" rel="noreferrer">Open proof of payment</a></p>}
        {order.customer_note && <p>Student note: {order.customer_note}</p>}
        {order.status === 'paid' && <p style={{ color: 'var(--text-muted)', fontSize: '.84rem', margin: '.5rem 0' }}>License access: <strong style={{ color: order.access_status === 'active' ? 'var(--success, #15803d)' : 'var(--text)' }}>{order.access_status === 'active' ? 'ACTIVE' : order.access_status === 'revoked' ? 'REVOKED' : order.access_status === 'expired' ? 'EXPIRED' : 'NOT CURRENT'}</strong>{order.access_expires_at ? ` · Expires ${new Date(order.access_expires_at).toLocaleString()}` : ''}</p>}
        {order.payment_method === 'PayMongo Checkout' && order.status === 'pending' ? <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', lineHeight: 1.5 }}>Awaiting PayMongo confirmation. Do not manually approve this order; Hyperion activates the license after the verified webhook arrives.</p> : order.status !== 'paid' && order.status !== 'failed' && <>
          <label>Admin note<textarea rows={2} value={note[order.id] || ''} onChange={e => setNote(old => ({...old,[order.id]:e.target.value}))} style={field}/></label>
          <div style={{ display:'flex', gap:8, marginTop:'.8rem' }}><button className="btn btn-primary" disabled={busy} onClick={() => void review(order.id,'approve')}>Approve & unlock</button><button className="btn btn-outline" disabled={busy} onClick={() => void review(order.id,'reject')}>Reject</button></div>
        </>}
        {order.status === 'paid' && order.access_status === 'active' && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void revoke(order)} style={{ marginTop: '.6rem', borderColor: 'var(--danger, #dc2626)', color: 'var(--danger, #dc2626)' }}>REVOKE ACCESS</button>}
      </section>) : <p>No payment submissions yet.</p>}
    </>}
  </div>
}
