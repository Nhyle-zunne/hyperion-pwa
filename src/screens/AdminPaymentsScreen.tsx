import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'

type Order = { id: string; user_id: string; email: string; product_code: string; track_id: string; amount_php: number; status: string; payment_reference: string | null; payment_method: string | null; proof_url: string | null; customer_note: string | null; customer_name: string | null; customer_company: string | null; customer_school: string | null; admin_note: string | null; created_at: string }
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
  const review = async (orderId: string, decision: 'approve'|'reject') => {
    setBusy(true); setMessage('')
    try { await call({ action:'review', orderId, decision, adminNote: note[orderId] || '' }); setMessage(decision === 'approve' ? 'Payment approved and access granted.' : 'Payment rejected.'); await load() }
    catch (e) { setMessage(safeAdminError(e, 'Could not complete the payment review. Please try again.')) }
    finally { setBusy(false) }
  }

  const card: React.CSSProperties = { background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'1rem', marginBottom:'1rem' }
  const field: React.CSSProperties = { width:'100%', boxSizing:'border-box', padding:'.8rem', marginTop:'.4rem', background:'var(--bg-elevated)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, font:'inherit' }
  return <div className="screen" style={{ paddingBottom:'2rem' }}>
    <button type="button" onClick={() => navigate('/account')} style={{ color:'var(--text-muted)', marginBottom:'1rem' }}>← Account</button>
    <h1 className="page-title">Payment Admin</h1>
    <p className="subtitle">Only email addresses configured in the server-side ADMIN_EMAILS secret can review payments.</p>
    {message && <div role="status" style={card}>{/supabase/i.test(message) ? 'Payment administration is temporarily unavailable. Please try again later.' : message}</div>}
    {!authorized ? <section style={card}><p>Admin dashboard could not load. Confirm that you are signed in with an email listed in ADMIN_EMAILS, then refresh.</p><button className="btn btn-outline" onClick={() => void load()}>Retry</button></section> : <>
      <h2>Payment submissions ({orders.length})</h2>
      {orders.length ? orders.map(order => <section key={order.id} style={card}>
        <div style={{ display:'flex', flexWrap:'wrap', justifyContent:'space-between', gap:8 }}><strong>{names[order.product_code] || order.product_code} · ₱{order.amount_php}</strong><strong>{order.status.toUpperCase()}</strong></div>
        <p style={{ margin:'.6rem 0', overflowWrap:'anywhere' }}>{order.email}<br/>Submitted: {new Date(order.created_at).toLocaleString()}<br/>Order ID: {order.id}</p>
        <p style={{ margin:'.4rem 0' }}><strong>Customer name:</strong> {order.customer_name || 'Not provided'}{order.customer_company ? <><br/>Company: {order.customer_company}</> : null}{order.customer_school ? <><br/>School: {order.customer_school}</> : null}</p>
        <p style={{ margin:'.4rem 0' }}>Method: {order.payment_method || 'Not provided'}<br/>Transaction reference: {order.payment_reference || 'Not provided'}</p>
        {order.proof_url && <p><a href={order.proof_url} target="_blank" rel="noreferrer">Open proof of payment</a></p>}
        {order.customer_note && <p>Student note: {order.customer_note}</p>}
        {order.status !== 'paid' && order.status !== 'failed' && <>
          <label>Admin note<textarea rows={2} value={note[order.id] || ''} onChange={e => setNote(old => ({...old,[order.id]:e.target.value}))} style={field}/></label>
          <div style={{ display:'flex', gap:8, marginTop:'.8rem' }}><button className="btn btn-primary" disabled={busy} onClick={() => void review(order.id,'approve')}>Approve & unlock</button><button className="btn btn-outline" disabled={busy} onClick={() => void review(order.id,'reject')}>Reject</button></div>
        </>}
      </section>) : <p>No payment submissions yet.</p>}
    </>}
  </div>
}
