import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AccountSectionTabs from '../components/AccountSectionTabs'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'

type Order = {
  id: string
  product_code: string
  license_term: 'week' | 'month' | 'year'
  amount_php: number
  status: string
  payment_reference: string | null
  payment_method: string | null
  customer_name: string | null
  customer_company: string | null
  customer_school: string | null
  customer_note: string | null
  admin_note: string | null
  created_at: string
  paid_at: string | null
  reviewed_at: string | null
  checkout_batch_id: string | null
}

const statusLabel: Record<string, string> = {
  submitted: 'Awaiting manual review',
  pending: 'Awaiting payment',
  paid: 'Approved',
  failed: 'Rejected',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}

async function readableError(error: unknown, fallback: string): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const body = await context.clone().json() as { error?: unknown }
        if (typeof body.error === 'string' && body.error.trim()) return body.error
      } catch { /* Return the safe fallback below. */ }
    }
  }
  const message = error instanceof Error ? error.message : ''
  return !message || /supabase|postgrest|postgres|sqlstate|edge function|jwt|fetch failed/i.test(message) ? fallback : message
}

export default function OrdersPaymentHistoryScreen() {
  const navigate = useNavigate()
  const [session, setSession] = useState<Session | null>(null)
  const [authLoaded, setAuthLoaded] = useState(false)
  const [orders, setOrders] = useState<Order[]>([])
  const [loading, setLoading] = useState(false)
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState(false)
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    if (!supabase) { setAuthLoaded(true); return }
    void supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoaded(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      setSession(nextSession)
      setAuthLoaded(true)
    })
    return () => listener.subscription.unsubscribe()
  }, [])

  const loadOrders = async (): Promise<Order[]> => {
    if (!supabase || !session?.user.id) {
      setOrders([])
      return []
    }
    const { data, error } = await supabase.from('orders')
      .select('id,product_code,license_term,amount_php,status,payment_reference,payment_method,customer_name,customer_company,customer_school,customer_note,admin_note,created_at,paid_at,reviewed_at,checkout_batch_id')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) throw new Error('Unable to load your orders and payment history. Please try again.')
    const rows = (data ?? []) as Order[]
    setOrders(rows)
    return rows
  }

  useEffect(() => {
    if (!session) { setOrders([]); return }
    let active = true
    setLoading(true)
    void loadOrders().catch(async err => {
      if (!active) return
      setErrorMessage(true)
      setMessage(await readableError(err, 'Unable to load your orders. Please refresh the page.'))
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session?.user.id])

  const refreshStatus = async () => {
    if (!supabase || !session) return
    setLoading(true)
    setErrorMessage(false)
    setMessage('Refreshing orders and checking pending PayMongo payments…')
    try {
      const currentOrders = await loadOrders()
      const pending = currentOrders.filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
      const checkoutIds = [...new Set(pending.map(order => order.checkout_batch_id || order.id))]
      const activated: string[] = []
      let stillPending = 0
      let lastError = ''

      for (const orderId of checkoutIds) {
        const { data, error } = await supabase.functions.invoke('verify-checkout', { body: { orderId } })
        if (error) {
          lastError = await readableError(error, 'PayMongo verification is temporarily unavailable.')
          continue
        }
        if (data?.status === 'paid') {
          const codes: string[] = Array.isArray(data.productCodes)
            ? data.productCodes
            : typeof data.productCode === 'string' ? [data.productCode] : []
          activated.push(...codes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code))
        } else if (data?.status === 'pending') {
          stillPending += 1
        } else if (typeof data?.error === 'string') {
          lastError = data.error
        }
      }
      await loadOrders()
      await refreshCloudEntitlements()
      if (activated.length) {
        setErrorMessage(false)
        setMessage(`Payment confirmed. Activated: ${[...new Set(activated)].join(', ')}.`)
      } else if (lastError) {
        setErrorMessage(true)
        setMessage(lastError)
      } else if (stillPending) {
        setMessage('PayMongo has not confirmed all pending checkouts as paid yet. No additional license was granted.')
      } else {
        setMessage('Orders and payment history are up to date.')
      }
    } catch (err) {
      setErrorMessage(true)
      setMessage(await readableError(err, 'Could not refresh your orders right now. Please try again.'))
    } finally {
      setLoading(false)
    }
  }

  const pendingCheckoutIds = [...new Set(orders
    .filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
    .map(order => order.checkout_batch_id || order.id))].sort().join(',')

  // Automatically reconcile open PayMongo checkouts while the customer views their history.
  useEffect(() => {
    const client = supabase
    if (!client || !session?.user.id || !pendingCheckoutIds) return
    let active = true
    let checking = false
    const checkPending = async () => {
      if (checking) return
      checking = true
      try {
        const activated: string[] = []
        for (const orderId of pendingCheckoutIds.split(',').filter(Boolean)) {
          const { data, error } = await client.functions.invoke('verify-checkout', { body: { orderId } })
          if (!active) return
          if (error || data?.status !== 'paid') continue
          const codes: string[] = Array.isArray(data.productCodes)
            ? data.productCodes
            : typeof data.productCode === 'string' ? [data.productCode] : []
          activated.push(...codes)
        }
        if (active && activated.length) {
          const labels = [...new Set(activated)].map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code)
          setErrorMessage(false)
          setMessage(`Payment confirmed automatically. Activated: ${labels.join(', ')}.`)
          await loadOrders()
          await refreshCloudEntitlements()
        }
      } catch {
        // A transient failure is retried on the next interval.
      } finally {
        checking = false
      }
    }
    void checkPending()
    const timer = window.setInterval(() => { void checkPending() }, 8000)
    return () => { active = false; window.clearInterval(timer) }
  }, [session?.user.id, pendingCheckoutIds, refreshCloudEntitlements])

  const card: React.CSSProperties = {
    background: 'var(--bg-card)',
    color: 'var(--text)',
    border: '1px solid var(--border)',
    borderRadius: 12,
    padding: '1rem',
    minWidth: 0,
  }

  return <div className="screen orders-history-page" style={{ width: 'min(calc(100% - 2rem), 1080px)', maxWidth: 1080, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{`
      .orders-history-page .orders-entry{padding:1rem 0;border-bottom:1px solid var(--border)}
      .orders-history-page .orders-entry:last-child{border-bottom:0;padding-bottom:0}
      .orders-history-page .orders-title-row{display:flex;align-items:flex-start;justify-content:space-between;gap:.75rem;flex-wrap:wrap}
      .orders-history-page .orders-status{display:inline-flex;align-items:center;border:1px solid var(--border);border-radius:999px;background:var(--bg-elevated);padding:.28rem .55rem;font-size:.7rem;font-weight:850}
      .orders-history-page .orders-meta{color:var(--text-muted);font-size:.82rem;line-height:1.5;overflow-wrap:anywhere}
      @media(max-width:520px){.orders-history-page .orders-heading-actions{width:100%}.orders-history-page .orders-heading-actions button{width:100%}}
    `}</style>
    <button type="button" onClick={() => navigate('/account?tab=payments')} style={{ color: 'var(--text-muted)', marginBottom: '.65rem' }}>← Back to Bond Store</button>
    <AccountSectionTabs active="orders" />
    <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
      <div>
        <div style={{ color: 'var(--accent)', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.14em' }}>ACCOUNT & SUBSCRIPTIONS</div>
        <h1 className="page-title" style={{ textAlign: 'left', margin: '.2rem 0 .3rem' }}>Orders & payment history</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Review your manual submissions, PayMongo purchases, and payment status.</p>
      </div>
      <div className="orders-heading-actions" style={{ display: 'flex', gap: '.55rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" disabled={loading || !session} onClick={() => void refreshStatus()}>{loading ? 'Refreshing…' : 'Refresh status'}</button>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/account?tab=payments')}>BOND STORE</button>
      </div>
    </div>

    {!authLoaded ? <section style={card}>Checking your Hyperion account…</section>
      : !session ? <section style={card}>
        <h2 style={{ marginTop: 0 }}>Sign in to view your orders</h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>Your order and payment history is private to your Hyperion account.</p>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/account')}>OPEN ACCOUNT / SIGN IN</button>
      </section>
      : <>
        {message && <div role="status" style={{ ...card, borderColor: errorMessage ? 'var(--danger, #dc2626)' : 'var(--border)', marginBottom: '1rem', lineHeight: 1.5 }}>{message}</div>}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap', paddingBottom: '.8rem', borderBottom: '1px solid var(--border)' }}>
            <div><h2 style={{ fontSize: '1.05rem', margin: 0 }}>All orders</h2><p style={{ color: 'var(--text-muted)', fontSize: '.82rem', margin: '.25rem 0 0' }}>{orders.length} record{orders.length === 1 ? '' : 's'} · newest first</p></div>
            <span style={{ fontSize: '.76rem', fontWeight: 800, color: 'var(--text-muted)' }}>PRIVATE ACCOUNT HISTORY</span>
          </div>
          {loading && !orders.length ? <p style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Loading your orders…</p>
            : orders.length ? orders.map(order => {
              const product = PAID_PRODUCTS.find(item => item.code === order.product_code)
              const status = statusLabel[order.status] || order.status
              const paid = order.status === 'paid'
              const rejected = ['failed', 'refunded', 'cancelled'].includes(order.status)
              return <article className="orders-entry" key={order.id}>
                <div className="orders-title-row">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '1rem' }}>{product?.label ?? order.product_code} · {order.license_term === 'week' ? 'Weekly' : order.license_term === 'month' ? 'Monthly' : 'Yearly'} · ₱{order.amount_php}</strong>
                    <div className="orders-meta" style={{ marginTop: '.3rem' }}>{new Date(order.paid_at || order.created_at).toLocaleString()} · {order.payment_method || 'Payment method not recorded'}</div>
                  </div>
                  <span className="orders-status" style={paid ? { color: 'var(--success, #15803d)', borderColor: '#86cba0', background: 'rgba(34,197,94,.08)' } : rejected ? { color: 'var(--text-muted)' } : { color: '#9a6b07', borderColor: '#e8c875', background: 'rgba(245,199,94,.09)' }}>{status}</span>
                </div>
                {order.customer_name && <div style={{ marginTop: '.45rem', fontSize: '.85rem' }}>Customer name: {order.customer_name}</div>}
                {order.customer_company && <div className="orders-meta" style={{ marginTop: '.2rem' }}>Company: {order.customer_company}</div>}
                {order.customer_school && <div className="orders-meta" style={{ marginTop: '.2rem' }}>School: {order.customer_school}</div>}
                <div className="orders-meta" style={{ marginTop: '.4rem' }}>Payment reference: {order.payment_reference || 'Not provided'}</div>
                <div className="orders-meta" style={{ marginTop: '.15rem' }}>Order ID: {order.id}</div>
                {order.admin_note && <div className="orders-meta" style={{ marginTop: '.4rem' }}>Admin note: {order.admin_note}</div>}
                {order.customer_note && <div className="orders-meta" style={{ marginTop: '.25rem' }}>Your note: {order.customer_note}</div>}
              </article>
            }) : <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🧾</div>
              <strong>No orders yet</strong>
              <p style={{ color: 'var(--text-muted)', margin: '.35rem 0 1rem' }}>Purchases and manual payment submissions will appear here.</p>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/account?tab=payments')}>BROWSE BOND STORE</button>
            </div>}
        </section>
      </>}
  </div>
}
