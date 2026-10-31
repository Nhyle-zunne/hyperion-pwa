import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
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
  const [statusTab, setStatusTab] = useState<'active' | 'pending' | 'failed' | 'expired'>('pending')
  const [expandedOrders, setExpandedOrders] = useState<Record<string, boolean>>({})
  const loadInFlight = useRef<Promise<void> | null>(null)
  const lastAutoLoadAt = useRef(0)
  const call = useCallback(async (body: Record<string,unknown>) => {
    if (!supabase) throw new Error('Payment administration is temporarily unavailable. Please try again later.')
    const { data, error } = await supabase.functions.invoke('admin-payment-review', { body })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }, [])
  const load = useCallback(async (force = false) => {
    if (loadInFlight.current) return loadInFlight.current
    // Focus and visibilitychange can fire together, and multiple admin tabs may
    // be open. Share a single request pair and throttle background refreshes.
    if (!force && Date.now() - lastAutoLoadAt.current < 120_000) return
    lastAutoLoadAt.current = Date.now()
    const task = (async () => {
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
    })()
    loadInFlight.current = task
    try {
      await task
    } finally {
      if (loadInFlight.current === task) loadInFlight.current = null
    }
  }, [call])
  // Webhooks deliver payment status changes; manual refresh remains available
  // while background polling is intentionally limited to one request pair / 2 min.
  useEffect(() => {
    void withPageLoading('Loading payment submissions', () => load(true))
    const refreshIfVisible = () => {
      if (document.visibilityState === 'visible') void load(false)
    }
    const timer = window.setInterval(refreshIfVisible, 120_000)
    document.addEventListener('visibilitychange', refreshIfVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshIfVisible)
    }
  }, [load])
  const review = async (orderId: string, decision: 'approve'|'reject') => {
    setBusy(true); setMessage('')
    try { await withPageLoading(decision === 'approve' ? 'Approving payment' : 'Reviewing payment', async () => { await call({ action:'review', orderId, decision, adminNote: note[orderId] || '' }); setMessage(decision === 'approve' ? 'Payment approved and access granted.' : 'Payment rejected.'); await load(true) }) }
    catch (e) { setMessage(safeAdminError(e, 'Could not complete the payment review. Please try again.')) }
    finally { setBusy(false) }
  }
  const duration = (term: Order['license_term']) => term === 'week' ? 'Weekly' : term === 'month' ? 'Monthly' : 'Yearly'

  const orderGroup = (order: Order): 'active' | 'pending' | 'failed' | 'expired' => {
    if (order.status === 'failed') return 'failed'
    if (order.status === 'submitted' || order.status === 'pending') return 'pending'
    if (order.status === 'paid' && order.access_status === 'active') return 'active'
    // Keep revoked and legacy paid records visible instead of hiding them from all tabs.
    return 'expired'
  }
  const ordersByStatus = useMemo(() => {
    const groups: Record<'active' | 'pending' | 'failed' | 'expired', Order[]> = {
      active: [], pending: [], failed: [], expired: []
    }
    for (const order of orders) groups[orderGroup(order)].push(order)
    return groups
  }, [orders])
  const visibleOrders = ordersByStatus[statusTab]
  const paymentStatusLabel = (order: Order) => {
    const group = orderGroup(order)
    if (group === 'active') return 'ACTIVE'
    if (group === 'pending') return 'PENDING'
    if (group === 'failed') return 'FAILED'
    if (order.access_status === 'revoked') return 'REVOKED'
    if (order.access_status === 'not_current') return 'INACTIVE'
    return 'EXPIRED'
  }

  const card: React.CSSProperties = { background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:10, padding:'1rem', marginBottom:'1rem' }
  return <div className="screen admin-payments-page" style={{ width:'min(calc(100% - 1rem), 1180px)', maxWidth:1180, margin:'0 auto', paddingBottom:'2rem' }}>
    <style>{`
      .admin-payments-page .page-title{text-align:left;margin:.2rem 0 .3rem}
      .admin-payments-page .subtitle{ text-align:left }
      .admin-admin-nav{display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end}
      .admin-payment-status-tabs{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:.45rem;margin:.9rem 0 1rem}
      .admin-payment-status-tab{display:flex;align-items:center;justify-content:center;gap:.55rem;min-width:0;border:1px solid var(--border);border-radius:9px;padding:.7rem .6rem;background:var(--bg-card);color:var(--text-muted);font:inherit;font-size:.83rem;font-weight:850;cursor:pointer;transition:background 150ms ease,border-color 150ms ease,color 150ms ease}
      .admin-payment-status-tab.is-active{color:var(--accent);border-color:var(--accent);background:var(--accent-soft)}
      .admin-payment-status-count{display:inline-flex;align-items:center;justify-content:center;min-width:1.55rem;height:1.55rem;padding:0 .3rem;border-radius:999px;background:var(--bg-elevated);color:var(--text);font-size:.72rem;font-weight:900}
      .admin-payment-status-tab.is-active .admin-payment-status-count{background:var(--accent);color:#fff}
      .admin-payment-table-wrap{width:100%;overflow-x:auto;border:1px solid var(--border);border-radius:10px;background:var(--bg-card)}
      .admin-payment-table{width:100%;border-collapse:separate;border-spacing:0;min-width:850px;font-size:.88rem;text-align:left}
      .admin-payment-table th{position:sticky;top:0;background:var(--bg-elevated);color:var(--text-muted);font-size:.73rem;letter-spacing:.035em;text-transform:uppercase;padding:.8rem .85rem;border-bottom:1px solid var(--border);white-space:nowrap}
      .admin-payment-table td{padding:.8rem .85rem;border-bottom:1px solid var(--border);vertical-align:middle}
      .admin-payment-table tbody:last-child tr:last-child td{border-bottom:0}
      .admin-payment-table .payment-main-row:hover td{background:color-mix(in srgb,var(--accent) 3%,var(--bg-card))}
      .admin-payment-customer{font-weight:750;min-width:145px}
      .admin-payment-email{min-width:180px;overflow-wrap:anywhere;color:var(--text-muted)}
      .admin-payment-date{min-width:160px;white-space:nowrap}
      .admin-payment-purchase{min-width:175px}
      .admin-payment-status-pill{display:inline-flex;align-items:center;border-radius:999px;padding:.3rem .55rem;font-size:.72rem;letter-spacing:.02em;font-weight:900;border:1px solid var(--border);white-space:nowrap}
      .admin-payment-status-pill.active{color:var(--success,#15803d);background:var(--accent-soft);border-color:color-mix(in srgb,var(--success,#15803d) 28%,var(--border))}
      .admin-payment-status-pill.pending{color:var(--text);background:var(--bg-elevated)}
      .admin-payment-status-pill.failed,.admin-payment-status-pill.expired{color:var(--text-muted);background:var(--bg-elevated)}
      .admin-payment-details-row td{background:var(--bg-elevated);padding:0;border-bottom:1px solid var(--border)}
      .admin-payment-details-content{padding:1rem;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.7rem 1.25rem}
      .admin-payment-detail-item{min-width:0;overflow-wrap:anywhere;font-size:.86rem;line-height:1.55}
      .admin-payment-detail-label{display:block;font-size:.7rem;color:var(--text-muted);font-weight:850;text-transform:uppercase;letter-spacing:.04em;margin-bottom:.15rem}
      .admin-payment-detail-actions{grid-column:1/-1;display:flex;gap:.6rem;flex-wrap:wrap;align-items:end;border-top:1px solid var(--border);padding-top:.85rem}
      .admin-payment-detail-actions label{flex:1 1 260px}
      .admin-payment-detail-actions textarea{width:100%;box-sizing:border-box;min-height:76px;padding:.65rem;margin-top:.35rem;background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-radius:6px;font:inherit}
      .admin-payment-expand{border:1px solid var(--border);border-radius:7px;background:var(--bg-card);color:var(--text);padding:.42rem .62rem;font:inherit;font-size:.79rem;font-weight:800;white-space:nowrap;cursor:pointer}
      .admin-payment-expand[aria-expanded="true"]{border-color:var(--accent);color:var(--accent);background:var(--accent-soft)}
      @media(max-width:760px){.admin-admin-nav{width:100%;justify-content:stretch}.admin-admin-nav button{flex:1 1 160px}.admin-payment-status-tabs{grid-template-columns:repeat(2,minmax(0,1fr))}.admin-payment-details-content{grid-template-columns:1fr}.admin-payment-detail-actions{grid-column:auto}}
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
    {!authorized ? <section style={card}><p>Admin dashboard could not load. Confirm that you are signed in with an email listed in ADMIN_EMAILS, then refresh.</p><button className="btn btn-outline" onClick={() => void withPageLoading('Refreshing payment submissions', () => load(true))}>Retry</button></section> : <>
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
        <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void withPageLoading('Refreshing payment submissions', () => load(true))} style={{ padding:'.55rem .8rem' }}>Refresh submissions</button>
      </div>
      <div className="admin-payment-status-tabs" role="tablist" aria-label="Filter payment submissions by status">
        {([
          ['active', 'ACTIVE'],
          ['pending', 'PENDING'],
          ['failed', 'FAILED'],
          ['expired', 'EXPIRED']
        ] as const).map(([id, label]) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={statusTab === id}
            aria-controls="admin-payment-status-panel"
            className={`admin-payment-status-tab${statusTab === id ? ' is-active' : ''}`}
            onClick={() => setStatusTab(id)}
          >
            <span>{label}</span><span className="admin-payment-status-count">{ordersByStatus[id].length}</span>
          </button>
        ))}
      </div>
      {statusTab === 'expired' && visibleOrders.some(order => order.access_status === 'revoked' || order.access_status === 'not_current') && (
        <p style={{ color:'var(--text-muted)', fontSize:'.82rem', margin:'.1rem 0 .8rem' }}>This tab also includes paid licenses that have been revoked or are no longer current.</p>
      )}
      <div id="admin-payment-status-panel" role="tabpanel" aria-label={`${statusTab} payment submissions`}>
      {visibleOrders.length ? <div className="admin-payment-table-wrap">
        <table className="admin-payment-table">
          <thead>
            <tr>
              <th scope="col">Customer name</th>
              <th scope="col">Email</th>
              <th scope="col">Date &amp; time submitted</th>
              <th scope="col">Purchase</th>
              <th scope="col">Status</th>
              <th scope="col">More info</th>
            </tr>
          </thead>
          {visibleOrders.map(order => {
            const expanded = Boolean(expandedOrders[order.id])
            const group = orderGroup(order)
            const statusClass = group === 'active' ? 'active' : group === 'pending' ? 'pending' : group === 'failed' ? 'failed' : 'expired'
            return <tbody key={order.id}>
              <tr className="payment-main-row">
                <td className="admin-payment-customer">{order.customer_name || 'Not provided'}</td>
                <td className="admin-payment-email">{order.email || 'Not provided'}</td>
                <td className="admin-payment-date">{new Date(order.created_at).toLocaleString()}</td>
                <td className="admin-payment-purchase">
                  <strong>{names[order.product_code] || order.product_code}</strong><br/>
                  <span style={{ color:'var(--text-muted)', fontSize:'.8rem' }}>{duration(order.license_term || 'year')} · ₱{order.amount_php}</span>
                </td>
                <td><span className={`admin-payment-status-pill ${statusClass}`}>{paymentStatusLabel(order)}</span></td>
                <td>
                  <button
                    type="button"
                    className="admin-payment-expand"
                    aria-expanded={expanded}
                    aria-controls={`payment-details-${order.id}`}
                    onClick={() => setExpandedOrders(old => ({ ...old, [order.id]: !old[order.id] }))}
                  >{expanded ? 'Hide details ▲' : 'Details ▼'}</button>
                </td>
              </tr>
              {expanded && <tr id={`payment-details-${order.id}`} className="admin-payment-details-row">
                <td colSpan={6}>
                  <div className="admin-payment-details-content">
                    <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Order ID</span>{order.id}</div>
                    <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Payment method</span>{order.payment_method || 'Not provided'}</div>
                    <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Transaction / reference</span>{order.payment_reference || 'Not provided'}</div>
                    {order.customer_company && <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Company</span>{order.customer_company}</div>}
                    {order.customer_school && <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">School</span>{order.customer_school}</div>}
                    {order.proof_url && <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Payment proof</span><a href={order.proof_url} target="_blank" rel="noreferrer">Open proof of payment</a></div>}
                    {order.customer_note && <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Customer note</span>{order.customer_note}</div>}
                    {order.status === 'paid' && <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">License access</span><strong style={{ color: order.access_status === 'active' ? 'var(--success, #15803d)' : 'var(--text)' }}>{order.access_status === 'active' ? 'ACTIVE' : order.access_status === 'revoked' ? 'REVOKED' : order.access_status === 'expired' ? 'EXPIRED' : 'NOT CURRENT'}</strong>{order.access_expires_at ? ` · Expires ${new Date(order.access_expires_at).toLocaleString()}` : ''}</div>}
                    {order.admin_note && <div className="admin-payment-detail-item"><span className="admin-payment-detail-label">Admin note</span>{order.admin_note}</div>}
                    {order.payment_method === 'PayMongo Checkout' && order.status === 'pending' && <div className="admin-payment-detail-item" style={{ gridColumn:'1/-1', color:'var(--text-muted)' }}>Awaiting PayMongo confirmation. Do not manually approve this order; Hyperion activates the license after the verified webhook arrives.</div>}
                    {order.status !== 'paid' && order.status !== 'failed' && order.payment_method !== 'PayMongo Checkout' && <div className="admin-payment-detail-actions">
                      <label>Admin note<textarea rows={2} value={note[order.id] || ''} onChange={e => setNote(old => ({ ...old, [order.id]:e.target.value }))} /></label>
                      <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void review(order.id,'approve')}>Approve &amp; unlock</button>
                      <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void review(order.id,'reject')}>Reject</button>
                    </div>}
                  </div>
                </td>
              </tr>}
            </tbody>
          })}
        </table>
      </div> : <section style={card}><p style={{ margin:0 }}>No {statusTab} payment submissions.</p></section>}
      </div>
    </>}
  </div>
}
