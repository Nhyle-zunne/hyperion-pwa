import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'

type Order = { id: string; user_id: string; email: string; product_code: string; track_id: string; license_term: 'week'|'month'|'year'; amount_php: number; status: string; access_status: string; access_expires_at: string | null; payment_reference: string | null; payment_method: string | null; proof_url: string | null; customer_note: string | null; customer_name: string | null; customer_company: string | null; customer_school: string | null; admin_note: string | null; created_at: string }
type ReconciliationAlert = { id: string; checkout_reference: string; checkout_session_id: string; paymongo_payment_id: string; expected_amount_php: number; observed_amount_minor: number; observed_currency: string; reason: string; created_at: string }
function safeAdminError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : ''
  if (!message || /supabase|postgrest|postgres|sqlstate|provider credentials|redirect settings|edge function|row[- ]level security|\bpgrst\b|\bjwt\b|database schema|relation .* does not exist|violates .* constraint/i.test(message)) return fallback
  return message
}
const names: Record<string,string> = { oic_nw:'Deck OIC-NW', gmdss:'GMDSS GOC', engine_ew:'Engine OIC-EW', deck_mgt:'Deck Management', engine_mgt:'Engine Management', all_access:'All-Access Bundle' }
export default function AdminPaymentsScreen() {
  const navigate = useNavigate()
  const [orders, setOrders] = useState<Order[]>([])
  const [reconciliationAlerts, setReconciliationAlerts] = useState<ReconciliationAlert[]>([])
  const [alertLoadWarning, setAlertLoadWarning] = useState('')
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
      try {
        const reconciliation = await call({ action: 'reconciliation-alerts' })
        setReconciliationAlerts(reconciliation.alerts || [])
        setAlertLoadWarning('')
      } catch {
        setAlertLoadWarning('Could not load PayMongo reconciliation alerts. Check the function logs before marking any duplicate payment resolved.')
      }
    } catch (e) { setAuthorized(false); setMessage(safeAdminError(e, 'Unable to load payment submissions. Please retry.')) }
  }, [call])
  // Keep the admin view current when webhook delivery or customer-side verification
  // updates a PayMongo order, without requiring manual refreshes.
  useEffect(() => {
    void withPageLoading('Loading payment submissions', () => load())
    const timer = window.setInterval(() => { void load() }, 10000)
    return () => window.clearInterval(timer)
  }, [load])
  const review = async (orderId: string, decision: 'approve'|'reject') => {
    setBusy(true); setMessage('')
    try { await withPageLoading(decision === 'approve' ? 'Approving payment' : 'Reviewing payment', async () => { await call({ action:'review', orderId, decision, adminNote: note[orderId] || '' }); setMessage(decision === 'approve' ? 'Payment approved and access granted.' : 'Payment rejected.'); await load() }) }
    catch (e) { setMessage(safeAdminError(e, 'Could not complete the payment review. Please try again.')) }
    finally { setBusy(false) }
  }
  const duration = (term: Order['license_term']) => term === 'week' ? 'Weekly' : term === 'month' ? 'Monthly' : 'Yearly'

  const card: React.CSSProperties = { background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'1rem', marginBottom:'1rem' }
  const field: React.CSSProperties = { width:'100%', boxSizing:'border-box', padding:'.8rem', marginTop:'.4rem', background:'var(--bg-elevated)', color:'var(--text)', border:'1px solid var(--border)', borderRadius:6, font:'inherit' }
  return <div className="screen admin-payments-page" style={{ width:'min(calc(100% - 1rem), 1180px)', maxWidth:1180, margin:'0 auto', paddingBottom:'2rem' }}>
    <style>{`
      .admin-payments-page .page-title{text-align:left;margin:.2rem 0 .3rem}
      .admin-payments-page .subtitle{ text-align:left }
      .admin-admin-nav{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .admin-payment-orders-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.75rem;align-items:start}
      .admin-payment-orders-grid>section{margin:0;min-width:0}
      .admin-payment-orders-grid textarea{min-height:76px}
      @media(max-width:760px){.admin-payment-orders-grid{grid-template-columns:1fr}.admin-admin-nav{width:100%;justify-content:stretch}.admin-admin-nav button{flex:1 1 160px}}
    `}</style>
    <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, flexWrap:'wrap', marginBottom:'.8rem' }}>
      <button type="button" onClick={() => navigate('/account')} style={{ color:'var(--text-muted)' }}>← Account</button>
      <div className="admin-admin-nav">
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/licenses')}>USER LICENSES</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/payments')}>PAYMENT SUBMISSIONS</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/questions')}>QUESTION BANK</button>
      </div>
    </div>
    <h1 className="page-title">Payment Submissions</h1>
    <p className="subtitle">Review manual payment submissions here. License activation, extension, and revocation are managed separately in User Licenses.</p>
    {message && <div role="status" style={card}>{/supabase/i.test(message) ? 'Payment administration is temporarily unavailable. Please try again later.' : message}</div>}
    {!authorized ? <section style={card}><p>Admin dashboard could not load. Confirm that you are signed in with an email listed in ADMIN_EMAILS, then refresh.</p><button className="btn btn-outline" onClick={() => void withPageLoading('Refreshing payment submissions', () => load())}>Retry</button></section> : <>
      {alertLoadWarning && <div role="alert" style={{ ...card, borderColor: 'var(--danger, #dc2626)' }}>{alertLoadWarning}</div>}
      {reconciliationAlerts.length > 0 && <section style={{ ...card, borderColor: 'var(--danger, #dc2626)', borderWidth: 2 }}>
        <h2 style={{ marginTop: 0, color: 'var(--danger, #dc2626)' }}>PayMongo reconciliation required ({reconciliationAlerts.length})</h2>
        <p style={{ lineHeight: 1.5 }}>PayMongo reported a distinct paid transaction for a checkout that was already fulfilled, or the payment ID was associated with another checkout. Hyperion deliberately did not grant a second license term. Compare these records with PayMongo and reconcile any duplicate charge with the provider. Keep the alert as an audit record; do not grant another license term automatically.</p>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(min(100%,320px),1fr))', gap: '.75rem' }}>
          {reconciliationAlerts.map(alert => <section key={alert.id} style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '.85rem', minWidth: 0 }}>
            <strong style={{ display: 'block', marginBottom: '.4rem' }}>Observed payment · {alert.observed_currency} {(Number(alert.observed_amount_minor) / 100).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</strong>
            <div style={{ fontSize: '.84rem', lineHeight: 1.55, overflowWrap: 'anywhere' }}>
              Expected checkout total: ₱{alert.expected_amount_php}<br/>
              Payment ID: {alert.paymongo_payment_id}<br/>
              Checkout reference: {alert.checkout_reference}<br/>
              Session ID: {alert.checkout_session_id}<br/>
              Detected: {new Date(alert.created_at).toLocaleString()}
            </div>
            <p style={{ margin: '.6rem 0 0', color: 'var(--text-muted)', fontSize: '.82rem', lineHeight: 1.45 }}>{alert.reason}</p>
          </section>)}
        </div>
      </section>}
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:8, flexWrap:'wrap', marginBottom:'.65rem' }}>
        <h2 style={{ margin:0 }}>Payment submissions ({orders.length})</h2>
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void withPageLoading('Refreshing payment submissions', () => load())} style={{ padding:'.55rem .8rem' }}>Refresh submissions</button>
      </div>
      {orders.length ? <div className="admin-payment-orders-grid">{orders.map(order => <section key={order.id} style={card}>
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
      </section>)}</div> : <section style={card}><p style={{ margin:0 }}>No payment submissions yet.</p></section>}
    </>}
  </div>
}
