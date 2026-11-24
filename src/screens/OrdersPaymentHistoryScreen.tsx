import { createPaymentPollingState, pendingPaymentCheckoutIds, startPaymentPolling } from '../lib/paymentPolling'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import AccountSectionTabs from '../components/AccountSectionTabs'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'
import { useLicenseStore } from '../stores/licenseStore'
import { fetchOrderPage, fetchPendingOrders, ORDER_PAGE_SIZE } from '../lib/orderHistoryRequests'
import type { HistoryOrder as Order, PendingOrder } from '../lib/orderHistoryRequests'


function orderStatusLabel(order: Pick<Order, 'status' | 'payment_method'>): string {
  if (order.status === 'failed' && order.payment_method === 'PayMongo Checkout') return 'Checkout not completed'
  if (order.status === 'pending' && order.payment_method === 'PayMongo Checkout') return 'Awaiting earlier checkout payment'
  if (order.status === 'paid') return 'Approved'
  return ({
    submitted: 'Awaiting manual review',
    pending: 'Awaiting payment',
    failed: 'Rejected',
    refunded: 'Refunded',
    cancelled: 'Cancelled',
  } as Record<string, string>)[order.status] || order.status
}

function orderStatusHelp(order: Pick<Order, 'status' | 'payment_method'>): string | null {
  if (order.status === 'failed' && order.payment_method === 'PayMongo Checkout') {
    return 'No license was activated from this checkout. You can start a new checkout or choose manual payment from the Bond Store.'
  }
  if (order.status === 'pending' && order.payment_method === 'PayMongo Checkout') {
    return 'The former payment provider has not confirmed this payment yet. Use Refresh status before trying another payment, and do not pay again while a payment attempt is still processing.'
  }
  if (order.status === 'submitted') {
    return 'Your manual payment submission is waiting for review. Access is activated only after approval.'
  }
  if (order.status === 'failed') {
    return 'This manual payment submission was rejected. Check the admin note above for any explanation.'
  }
  if (order.status === 'cancelled') {
    return 'No license was activated from this checkout. You can start a new purchase when you are ready.'
  }
  return null
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
  const [lifetimeOrders, setLifetimeOrders] = useState<Array<{
    id: string; product_code: string; amount_php: number; status: string; created_at: string; paid_at: string | null
  }>>([])
  const [loading, setLoading] = useState(false)
  const [loadingMore, setLoadingMore] = useState(false)
  const [hasMore, setHasMore] = useState(false)
  const [pendingOrders, setPendingOrders] = useState<PendingOrder[]>([])
  const [loadedOwner, setLoadedOwner] = useState<string | null>(null)
  const ordersRef = useRef<Order[]>([])
  const requestVersion = useRef(0)
  const mounted = useRef(true)
  const statusRefresh = useRef<object | null>(null)
  const currentOwner = useRef<string | null>(null)
  if (currentOwner.current !== (session?.user.id ?? null)) {
    currentOwner.current = session?.user.id ?? null
    requestVersion.current++
    ordersRef.current = []
    statusRefresh.current = null
  }
  const visibleOrders = loadedOwner === session?.user.id ? orders : []
  const visibleLifetime = loadedOwner === session?.user.id ? lifetimeOrders : []
  const [message, setMessage] = useState('')
  const [errorMessage, setErrorMessage] = useState(false)
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; requestVersion.current++ }
  }, [])

  useEffect(() => {
    if (!supabase) { setAuthLoaded(true); return }
    let active = true
    let authChanged = false
    void supabase.auth.getSession().then(({ data }) => {
      if (!active || authChanged) return
      setSession(data.session)
      setAuthLoaded(true)
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
      if (!active) return
      authChanged = true
      setSession(nextSession)
      setAuthLoaded(true)
    })
    return () => { active = false; listener.subscription.unsubscribe() }
  }, [])

  const loadOrders = async (preserveLoaded = false): Promise<PendingOrder[] | null> => {
    const client = supabase
    const owner = session?.user.id
    if (!client || !owner || !mounted.current || currentOwner.current !== owner) return null
    const version = ++requestVersion.current
    const isCurrent = () => mounted.current && currentOwner.current === owner && requestVersion.current === version
    const target = preserveLoaded ? Math.max(ORDER_PAGE_SIZE, ordersRef.current.length) : ORDER_PAGE_SIZE
    let rows: Order[] = []
    let more = false
    do {
      const page = await fetchOrderPage(client, owner, rows.length ? rows[rows.length - 1] : undefined)
      if (!isCurrent()) return null
      rows = [...rows, ...page.orders]
      more = page.hasMore
    } while (more && rows.length < target)
    // Payment discovery must not depend on which history page happens to be visible.
    const pending = more ? await fetchPendingOrders(client, owner)
      : rows.filter(row => row.status === 'pending' && row.payment_method === 'PayMongo Checkout')
    if (!isCurrent()) return null
    const { data: lifetimeHistory, error: lifetimeError } = await client.from('lifetime_orders')
      .select('id,product_code,amount_php,status,created_at,paid_at')
      .eq('user_id', owner).order('created_at', { ascending: false }).limit(50)
    if (!isCurrent()) return null
    if (lifetimeError) throw new Error('Could not load one-time purchase history.')
    ordersRef.current = rows
    setOrders(rows)
    setLifetimeOrders(lifetimeHistory ?? [])
    setPendingOrders(pending)
    setHasMore(more)
    setLoadedOwner(owner)
    return pending
  }

  const loadMore = async () => {
    const owner = session?.user.id
    if (!supabase || !owner || loading || loadingMore || !hasMore || loadedOwner !== owner) return
    const cursor = ordersRef.current[ordersRef.current.length - 1]
    if (!cursor) return
    const version = ++requestVersion.current
    setLoadingMore(true)
    setErrorMessage(false)
    setMessage('')
    try {
      const page = await fetchOrderPage(supabase, owner, cursor)
      if (!mounted.current || currentOwner.current !== owner || requestVersion.current !== version) return
      const existing = new Set(ordersRef.current.map(order => order.id))
      const combined = [...ordersRef.current, ...page.orders.filter(order => !existing.has(order.id))]
      ordersRef.current = combined
      setOrders(combined)
      setHasMore(page.hasMore)
    } catch (error) {
      if (mounted.current && currentOwner.current === owner && requestVersion.current === version) {
        const message = await readableError(error, 'Older orders could not be loaded. Please try again.')
        if (!mounted.current || currentOwner.current !== owner || requestVersion.current !== version) return
        setErrorMessage(true)
        setMessage(message)
      }
    } finally {
      if (mounted.current && currentOwner.current === owner) setLoadingMore(false)
    }
  }

  useEffect(() => {
    setOrders([])
    setLifetimeOrders([])
    setPendingOrders([])
    setHasMore(false)
    setLoadingMore(false)
    setLoadedOwner(null)
    setMessage('')
    setErrorMessage(false)
    if (!session) { setLoading(false); return }
    let active = true
    setLoading(true)
    void withPageLoading('Loading orders and payment history', () => loadOrders()).catch(async err => {
      if (!active) return
      const message = await readableError(err, 'Unable to load your orders. Please refresh the page.')
      if (!active) return
      setErrorMessage(true)
      setMessage(message)
    }).finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [session?.user.id])

  const refreshStatusInternal = async () => {
    if (!supabase || !session || statusRefresh.current) return
    const refresh = {}
    statusRefresh.current = refresh
    setLoading(true)
    setErrorMessage(false)
    setMessage('Refreshing orders and checking pending historical payments…')
    try {
      const pending = await loadOrders()
      if (!pending) return
      const checkoutIds = [...new Set(pending.map(order => order.checkout_batch_id || order.id))]
      const activated: string[] = []
      let stillPending = 0
      let lastError = ''

      for (const orderId of checkoutIds) {
        if (!mounted.current || currentOwner.current !== session.user.id) return
        const { data, error } = await supabase.functions.invoke('verify-checkout', { body: { orderId } })
        if (!mounted.current || currentOwner.current !== session.user.id) return
        if (error) {
          lastError = await readableError(error, 'Historical payment verification is temporarily unavailable.')
          if (!mounted.current || currentOwner.current !== session.user.id) return
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
      // One-time payments have their own order table; verify against PayMongo,
      // not a browser redirect or the status of a timed subscription.
      const { data: pendingLifetime, error: lifetimeError } = await supabase.from('lifetime_orders')
        .select('id,product_code').eq('user_id', session.user.id)
        .eq('status','pending').not('paymongo_checkout_session_id','is',null).limit(20)
      if (lifetimeError) throw new Error('Could not check pending one-time payments.')
      for (const purchase of pendingLifetime ?? []) {
        if (!mounted.current || currentOwner.current !== session.user.id) return
        const { data, error } = await supabase.functions.invoke('verify-lifetime-checkout', {
          body: { orderId: purchase.id }
        })
        if (!mounted.current || currentOwner.current !== session.user.id) return
        if (error) {
          lastError = await readableError(error, 'Lifetime payment verification is temporarily unavailable.')
        } else if (data?.status === 'paid') {
          const name = PAID_PRODUCTS.find(p => p.code === purchase.product_code)?.label ?? purchase.product_code
          activated.push(name + ' Lifetime Access')
        } else if (data?.status === 'pending') {
          stillPending++
        } else if (data?.status === 'reconciliation_required') {
          lastError = 'A one-time payment needs manual reconciliation. Do not pay again.'
        }
      }
      if (!await loadOrders()) return
      await refreshCloudEntitlements()
      if (!mounted.current || currentOwner.current !== session.user.id) return
      if (activated.length) {
        setErrorMessage(false)
        setMessage(`Payment confirmed. Activated: ${[...new Set(activated)].join(', ')}.`)
      } else if (lastError) {
        setErrorMessage(true)
        setMessage(lastError)
      } else if (stillPending) {
        setMessage('The former payment provider has not confirmed all pending checkouts as paid yet. No additional license was granted.')
      } else {
        setMessage('Orders and payment history are up to date.')
      }
    } catch (err) {
      if (mounted.current && currentOwner.current === session.user.id) {
        const message = await readableError(err, 'Could not refresh your orders right now. Please try again.')
        if (!mounted.current || currentOwner.current !== session.user.id) return
        setErrorMessage(true)
        setMessage(message)
      }
    } finally {
      if (statusRefresh.current === refresh) {
        statusRefresh.current = null
        if (mounted.current && currentOwner.current === session.user.id) setLoading(false)
      }
    }
  }

  const refreshStatus = async () => withPageLoading('Verifying payment status', () => refreshStatusInternal())

  const pendingCheckoutIds = loadedOwner === session?.user.id ? pendingPaymentCheckoutIds(pendingOrders) : ''
  const paymentPolling = useRef<{ userId: string; state: ReturnType<typeof createPaymentPollingState> } | null>(null)

  // Automatically reconcile open PayMongo checkouts while the customer views their history.
  useEffect(() => {
    const client = supabase
    if (!session?.user.id) { paymentPolling.current = null; return }
    if (!client || !pendingCheckoutIds) return
    if (paymentPolling.current?.userId !== session.user.id) {
      paymentPolling.current = { userId: session.user.id, state: createPaymentPollingState() }
    }
    let active = true
    let checking = false
    const checkPending = async (isCurrent: () => boolean) => {
      if (checking || statusRefresh.current) return
      checking = true
      try {
        const activated: string[] = []
        for (const orderId of pendingPaymentCheckoutIds(pendingOrders).split(',').filter(Boolean)) {
          if (!active) return
          if (!isCurrent()) break
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
          if (!await loadOrders(true) || !mounted.current || currentOwner.current !== session.user.id) return
          await refreshCloudEntitlements()
        }
      } catch {
        // A transient failure is retried with bounded backoff.
      } finally {
        checking = false
      }
    }
    const stop = startPaymentPolling(checkPending, { state: paymentPolling.current.state })
    return () => { active = false; stop() }
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
    <AccountSectionTabs active="orders" />
    <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
      <div>
        <div style={{ color: 'var(--accent)', fontWeight: 900, fontSize: '.7rem', letterSpacing: '.14em' }}>ACCOUNT & SUBSCRIPTIONS</div>
        <h1 className="page-title" style={{ textAlign: 'left', margin: '.2rem 0 .3rem' }}>Orders & payment history</h1>
        <p style={{ color: 'var(--text-muted)', margin: 0 }}>Review your manual submissions, earlier website purchases, and payment status.</p>
      </div>
      <div className="orders-heading-actions" style={{ display: 'flex', gap: '.55rem', flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-outline" disabled={loading || loadingMore || !session} onClick={() => void refreshStatus()}>{loading ? 'Refreshing…' : 'Refresh status'}</button>
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
        {visibleLifetime.length > 0 && <section style={card} aria-label="One-time Lifetime Access purchases">
          <div style={{ borderBottom: '1px solid var(--border)', paddingBottom: '.6rem' }}>
            <h2 style={{ fontSize: '1.05rem', margin: 0 }}>Lifetime Access purchases</h2>
            <p className="orders-meta" style={{ margin: '.25rem 0 0' }}>Earlier one-time website orders, separate from subscriptions.</p>
          </div>
          {visibleLifetime.map(order => {
            const product = PAID_PRODUCTS.find(item => item.code === order.product_code)
            const paid = order.status === 'paid'
            return <article className="orders-entry" key={order.id}>
              <div className="orders-title-row">
                <div style={{ minWidth: 0 }}>
                  <strong>{product?.label ?? order.product_code} · Lifetime · ₱{order.amount_php.toLocaleString()}</strong>
                  <div className="orders-meta">{new Date(order.paid_at || order.created_at).toLocaleString()} · Earlier website QR Ph checkout</div>
                </div>
                <span className="orders-status" style={paid ? { color: 'var(--success, #15803d)' } : undefined}>
                  {paid ? 'PAID · LIFETIME' : order.status === 'pending' ? 'AWAITING PAYMENT'
                    : order.status === 'reconciliation_required' ? 'REVIEW REQUIRED'
                    : order.status.toUpperCase()}
                </span>
              </div>
              <div className="orders-meta" style={{ marginTop: '.45rem' }}>Order ID: {order.id}</div>
              {order.status === 'pending' && <p className="orders-meta" style={{ margin: '.4rem 0 0' }}>Resume or cancel this checkout from Bond Store. Refresh status before paying again.</p>}
              {order.status === 'refunded' && <p className="orders-meta" style={{ margin: '.4rem 0 0' }}>Lifetime access from this payment was revoked; saved study history is retained.</p>}
            </article>
          })}
        </section>}
        <section style={card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.75rem', flexWrap: 'wrap', paddingBottom: '.8rem', borderBottom: '1px solid var(--border)' }}>
            <div><h2 style={{ fontSize: '1.05rem', margin: 0 }}>All orders</h2><p style={{ color: 'var(--text-muted)', fontSize: '.82rem', margin: '.25rem 0 0' }}>{visibleOrders.length} {hasMore ? 'shown' : `record${visibleOrders.length === 1 ? '' : 's'}`} · newest first</p></div>
            <span style={{ fontSize: '.76rem', fontWeight: 800, color: 'var(--text-muted)' }}>PRIVATE ACCOUNT HISTORY</span>
          </div>
          {loading && !visibleOrders.length ? <p style={{ color: 'var(--text-muted)', padding: '1rem 0' }}>Loading your orders…</p>
            : visibleOrders.length ? visibleOrders.map(order => {
              const product = PAID_PRODUCTS.find(item => item.code === order.product_code)
              const status = orderStatusLabel(order)
              const statusHelp = orderStatusHelp(order)
              const paid = order.status === 'paid'
              const rejected = ['failed', 'refunded', 'cancelled'].includes(order.status)
              return <article className="orders-entry" key={order.id}>
                <div className="orders-title-row">
                  <div style={{ minWidth: 0 }}>
                    <strong style={{ display: 'block', fontSize: '1rem' }}>{product?.label ?? order.product_code} · {order.license_term === 'week' ? 'Weekly' : order.license_term === 'month' ? 'Monthly' : 'Yearly'} · ₱{order.amount_php}</strong>
                    <div className="orders-meta" style={{ marginTop: '.3rem' }}>{new Date(order.paid_at || order.created_at).toLocaleString()} · {order.payment_method === 'PayMongo Checkout' ? 'Earlier hosted checkout' : order.payment_method || 'Payment method not recorded'}</div>
                  </div>
                  <span className="orders-status" style={paid ? { color: 'var(--success, #15803d)', borderColor: '#86cba0', background: 'rgba(34,197,94,.08)' } : rejected ? { color: 'var(--text-muted)' } : { color: 'var(--text-muted)', borderColor: 'var(--border)', background: 'var(--bg-elevated)' }}>{status}</span>
                </div>
                {order.customer_name && <div style={{ marginTop: '.45rem', fontSize: '.85rem' }}>Customer name: {order.customer_name}</div>}
                {order.customer_company && <div className="orders-meta" style={{ marginTop: '.2rem' }}>Company: {order.customer_company}</div>}
                {order.customer_school && <div className="orders-meta" style={{ marginTop: '.2rem' }}>School: {order.customer_school}</div>}
                <div className="orders-meta" style={{ marginTop: '.4rem' }}>Payment reference: {order.payment_reference || 'Not provided'}</div>
                <div className="orders-meta" style={{ marginTop: '.15rem' }}>Order ID: {order.id}</div>
                {statusHelp && <p className="orders-meta" style={{ margin: '.6rem 0 0', padding: '.6rem .7rem', borderRadius: 8, border: '1px solid var(--border)', background: 'var(--bg-elevated)', lineHeight: 1.5 }}>{statusHelp}</p>}
                {order.admin_note && <div className="orders-meta" style={{ marginTop: '.4rem' }}>Admin note: {order.admin_note}</div>}
                {order.customer_note && <div className="orders-meta" style={{ marginTop: '.25rem' }}>Your note: {order.customer_note}</div>}
              </article>
            }) : <div style={{ textAlign: 'center', padding: '2.5rem 1rem' }}>
              <div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🧾</div>
              <strong>No orders yet</strong>
              <p style={{ color: 'var(--text-muted)', margin: '.35rem 0 1rem' }}>Purchases and manual payment submissions will appear here.</p>
              <button type="button" className="btn btn-primary" onClick={() => navigate('/account?tab=payments')}>BROWSE BOND STORE</button>
            </div>}
          {hasMore && visibleOrders.length > 0 && <div style={{ paddingTop: '1rem', textAlign: 'center' }}>
            <button type="button" className="btn btn-outline" disabled={loading || loadingMore} onClick={() => void loadMore()}>{loadingMore ? 'Loading older orders…' : 'Load older orders'}</button>
          </div>}
        </section>
      </>}
  </div>
}
