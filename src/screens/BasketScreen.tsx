import { useEffect, useMemo, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import type { Session } from '@supabase/supabase-js'
import { PAID_PRODUCTS, supabase, supabaseConfigured } from '../lib/supabase'
import type { LicenseTerm, PaidTrack } from '../lib/supabase'
import { priceForTerm, termLabel } from '../lib/supabase'
import { useLicenseStore } from '../stores/licenseStore'
import AccountSectionTabs from '../components/AccountSectionTabs'

type Order = {
  id: string
  product_code: string
  license_term: LicenseTerm
  amount_php: number
  status: string
  payment_reference: string | null
  payment_method: string | null
  customer_name: string | null
  created_at: string
  paid_at: string | null
  checkout_batch_id: string | null
}

type BasketItem = { code: PaidTrack; term: LicenseTerm }

function savedBasket(): BasketItem[] {
  try {
    const raw = localStorage.getItem('hyperion-account-basket-v1')
    const saved: unknown = raw ? JSON.parse(raw) : []
    if (!Array.isArray(saved)) return []
    const normalized: BasketItem[] = saved.flatMap((entry: unknown) => {
      if (typeof entry === 'string' && PAID_PRODUCTS.some(item => item.code === entry)) return [{ code: entry as PaidTrack, term: 'year' as const }]
      if (!entry || typeof entry !== 'object') return []
      const item = entry as { code?: unknown; term?: unknown }
      if (typeof item.code !== 'string' || !PAID_PRODUCTS.some(product => product.code === item.code)) return []
      const term: LicenseTerm = item.term === 'week' || item.term === 'month' || item.term === 'year' ? item.term : 'year'
      return [{ code: item.code as PaidTrack, term }]
    })
    return [...new Map(normalized.map(item => [item.code, item] as const)).values()]
  } catch {
    return []
  }
}

async function edgeError(error: unknown): Promise<string> {
  if (error && typeof error === 'object' && 'context' in error) {
    const context = (error as { context?: unknown }).context
    if (context instanceof Response) {
      try {
        const body = await context.clone().json() as { error?: unknown }
        if (typeof body.error === 'string' && body.error.trim()) return body.error
      } catch { /* Use the generic message below. */ }
    }
  }
  return error instanceof Error && error.message && !/functions|supabase|jwt|fetch failed/i.test(error.message)
    ? error.message
    : 'The request could not be completed. Please retry in a moment.'
}

export default function BasketScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [session, setSession] = useState<Session | null>(null)
  const [basket, setBasket] = useState<BasketItem[]>(savedBasket)
  const [orders, setOrders] = useState<Order[]>([])
  const [ownedCodes, setOwnedCodes] = useState<PaidTrack[]>([])
  const [busy, setBusy] = useState(false)
  const [busyCheckoutId, setBusyCheckoutId] = useState<string | null>(null)
  const [message, setMessage] = useState('')
  const [isError, setIsError] = useState(false)
  const [manualFallbackItems, setManualFallbackItems] = useState<BasketItem[]>([])
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)

  useEffect(() => {
    try {
      if (basket.length) localStorage.setItem('hyperion-account-basket-v1', JSON.stringify(basket))
      else localStorage.removeItem('hyperion-account-basket-v1')
    } catch { /* Keep the basket in memory for this visit. */ }
  }, [basket])

  useEffect(() => {
    if (!supabase) return
    void supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession))
    return () => listener.subscription.unsubscribe()
  }, [])

  const refreshData = async () => {
    if (!supabase || !session?.user.id) {
      setOrders([])
      setOwnedCodes([])
      return
    }
    const [orderResult, entitlementResult] = await Promise.all([
      supabase.from('orders')
        .select('id,product_code,license_term,amount_php,status,payment_reference,payment_method,customer_name,created_at,paid_at,checkout_batch_id')
        .eq('user_id', session.user.id)
        .order('created_at', { ascending: false })
        .limit(100),
      supabase.from('entitlements')
        .select('product_code')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
    ])
    if (orderResult.error) throw new Error('Unable to load your order history. Please refresh the page.')
    if (entitlementResult.error) throw new Error('Unable to check your active licenses. Please refresh the page.')
    setOrders((orderResult.data ?? []) as Order[])
    setOwnedCodes((entitlementResult.data ?? [])
      .map(row => row.product_code as PaidTrack)
      .filter(code => PAID_PRODUCTS.some(item => item.code === code)))
    await refreshCloudEntitlements()
  }

  useEffect(() => {
    let active = true
    if (session) {
      void refreshData().catch(async error => {
        if (active) {
          setIsError(true)
          setMessage(await edgeError(error))
        }
      })
    } else {
      setOrders([])
      setOwnedCodes([])
    }
    return () => { active = false }
  }, [session?.user.id])

  const clearBasketCodes = (codes: string[]) => setBasket(current => current.filter(item => !codes.includes(item.code)))
  const selectedItems = useMemo(() => basket.flatMap(entry => {
    const product = PAID_PRODUCTS.find(item => item.code === entry.code)
    return product ? [{ ...entry, product, price: priceForTerm(product, entry.term) }] : []
  }), [basket])
  const totalPhp = selectedItems.reduce((sum, item) => sum + item.price, 0)
  const activeInBasket = selectedItems.filter(item => ownedCodes.includes(item.code))
  const pendingPayMongoOrders = orders.filter(order => order.status === 'pending' && order.payment_method === 'PayMongo Checkout')
  const pendingCheckoutGroups = useMemo(() => {
    const groups = new Map<string, Order[]>()
    for (const order of pendingPayMongoOrders) {
      const id = order.checkout_batch_id || order.id
      groups.set(id, [...(groups.get(id) ?? []), order])
    }
    return [...groups.entries()].map(([id, groupOrders]) => ({
      id,
      orders: groupOrders,
      items: groupOrders.flatMap(order => {
        const validCode = PAID_PRODUCTS.some(item => item.code === order.product_code)
        const term: LicenseTerm = order.license_term === 'week' || order.license_term === 'month' || order.license_term === 'year' ? order.license_term : 'year'
        return validCode ? [{ code: order.product_code as PaidTrack, term }] : []
      }),
      codes: [...new Set(groupOrders.map(order => order.product_code))]
        .filter((code): code is PaidTrack => PAID_PRODUCTS.some(item => item.code === code)),
      total: groupOrders.reduce((sum, order) => sum + Number(order.amount_php), 0),
    }))
  }, [pendingPayMongoOrders])
  const pendingCheckoutIds = pendingCheckoutGroups.map(group => group.id).sort().join(',')

  // If PayMongo's webhook is delayed, keep reconciling while the customer stays in Checkout.
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
          const uniqueCodes = [...new Set(activated)]
          const labels = uniqueCodes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code)
          setIsError(false)
          setMessage(`Payment confirmed automatically. Activated: ${labels.join(', ')}.`)
          clearBasketCodes(uniqueCodes)
          await refreshData()
        }
      } catch {
        // Retry on the next interval after transient failures.
      } finally {
        checking = false
      }
    }
    void checkPending()
    const timer = window.setInterval(() => { void checkPending() }, 8000)
    return () => { active = false; window.clearInterval(timer) }
  }, [session?.user.id, pendingCheckoutIds])

  const confirmPaidCheckout = async (orderId: string, attemptCount = 1) => {
    if (!supabase) return false
    for (let attempt = 0; attempt < attemptCount; attempt++) {
      const { data, error } = await supabase.functions.invoke('verify-checkout', { body: { orderId } })
      if (!error && data?.status === 'paid') {
        const codes: string[] = Array.isArray(data.productCodes)
          ? data.productCodes
          : typeof data.productCode === 'string' ? [data.productCode] : []
        clearBasketCodes(codes)
        await refreshData()
        setIsError(false)
        setMessage(`Payment confirmed. Activated: ${codes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code).join(', ')}. No manual approval is needed.`)
        return true
      }
      if (error) setMessage(await edgeError(error))
      else if (typeof data?.error === 'string') setMessage(data.error)
      else if (data?.status === 'pending') setMessage(data.message || 'PayMongo has not confirmed payment yet. No license was granted.')
      if (attempt < attemptCount - 1) await new Promise(resolve => window.setTimeout(resolve, 1600))
    }
    return false
  }

  useEffect(() => {
    const paymentState = params.get('payment')
    const orderId = params.get('order_id')
    if (!session || !paymentState || !orderId) return
    let active = true
    if (paymentState === 'cancelled') {
      setMessage('You returned from PayMongo. The checkout may still be open. Use the pending checkout controls below if you want to cancel it or switch payment methods.')
      setIsError(false)
      return () => { active = false }
    }
    if (paymentState !== 'success') return
    setBusy(true)
    setIsError(false)
    setMessage('Checking the completed payment directly with PayMongo…')
    void (async () => {
      try {
        const paid = await confirmPaidCheckout(orderId, 6)
        if (!active) return
        if (!paid) {
          setIsError(true)
          setMessage(current => current || 'PayMongo has not confirmed this checkout as paid yet. Do not pay again; use Refresh payment status shortly.')
        }
      } catch (error) {
        if (active) {
          setIsError(true)
          setMessage(await edgeError(error))
        }
      } finally {
        if (active) setBusy(false)
      }
    })()
    return () => { active = false }
  }, [session?.user.id, params])

  const checkout = async (requestedItems: BasketItem[] = basket) => {
    if (!supabase || !session) {
      navigate('/account')
      setMessage('Sign in to Hyperion first. Your selected tracks are saved in this browser.')
      return
    }
    const itemsByCode = new Map<PaidTrack, BasketItem>()
    for (const entry of requestedItems) {
      if (PAID_PRODUCTS.some(item => item.code === entry.code) &&
          (entry.term === 'week' || entry.term === 'month' || entry.term === 'year')) itemsByCode.set(entry.code, entry)
    }
    const items = [...itemsByCode.values()]
    const codes = items.map(item => item.code)
    if (!codes.length) {
      setIsError(true)
      setMessage('Your checkout is empty. Return to the shop and add a reviewer track first.')
      return
    }
    const unavailable = codes.filter(code => ownedCodes.includes(code))
    if (unavailable.length) {
      setIsError(true)
      setMessage(`Remove already-active licenses before checking out: ${unavailable.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code).join(', ')}.`)
      return
    }

    setBusy(true)
    setIsError(false)
    setManualFallbackItems([])
    setMessage('Preparing secure checkout…')
    try {
      const { data, error } = await supabase.functions.invoke('create-checkout', { body: { items: items.map(item => ({ productCode: item.code, term: item.term })) } })
      if (error) throw new Error(await edgeError(error))
      if (data?.error) throw new Error(data.error)
      if (data?.alreadyProcessing === true && typeof data.orderId === 'string') {
        const paid = await confirmPaidCheckout(data.orderId, 6)
        if (!paid) setMessage('PayMongo reports a payment attempt for this checkout. Refresh payment status shortly; do not pay again.')
        return
      }
      const url = typeof data?.checkoutUrl === 'string' ? new URL(data.checkoutUrl) : null
      if (!url || url.protocol !== 'https:' || url.hostname !== 'checkout.paymongo.com') {
        throw new Error('PayMongo did not return a valid secure checkout URL. Please retry or contact Hyperion support.')
      }
      window.location.assign(url.toString())
    } catch (error) {
      setIsError(true)
      setManualFallbackItems(items)
      setMessage(await edgeError(error))
    } finally {
      setBusy(false)
    }
  }

  const cancelCheckout = async (groupId: string, groupItems: BasketItem[]) => {
    if (!supabase || !session) return
    setBusy(true)
    setBusyCheckoutId(groupId)
    setIsError(false)
    setMessage('Checking with PayMongo before closing this checkout…')
    try {
      const { data, error } = await supabase.functions.invoke('cancel-checkout', { body: { orderId: groupId } })
      if (error) throw new Error(await edgeError(error))
      if (data?.error) throw new Error(data.error)
      if (data?.status === 'already_paid') {
        const paid = await confirmPaidCheckout(groupId, 6)
        if (!paid) setMessage('PayMongo reports this payment as paid or processing. Do not pay again; refresh payment status shortly.')
        return
      }
      if (data?.status === 'processing') {
        setMessage(data.message || 'A payment is still processing. Wait for PayMongo to confirm it before switching methods.')
        return
      }
      if (data?.status !== 'cancelled') throw new Error('PayMongo did not confirm that this checkout was cancelled. No new payment should be started yet.')
      setBasket(current => [...new Map<PaidTrack, BasketItem>([...current, ...groupItems].map(item => [item.code, item] as const)).values()])
      await refreshData()
      setMessage('Checkout cancelled successfully. Its tracks were added back to your basket; you can now edit your selection or check out again.')
    } catch (error) {
      setIsError(true)
      setMessage(await edgeError(error))
      await refreshData().catch(() => undefined)
    } finally {
      setBusy(false)
      setBusyCheckoutId(null)
    }
  }

  const refreshStatus = async () => {
    if (!supabase || !session) return
    setBusy(true)
    setIsError(false)
    setMessage('Refreshing payment status from PayMongo…')
    try {
      const checkoutIds = [...new Set(pendingPayMongoOrders.map(order => order.checkout_batch_id || order.id))]
      let activated: string[] = []
      for (const id of checkoutIds) {
        const { data, error } = await supabase.functions.invoke('verify-checkout', { body: { orderId: id } })
        if (error) throw new Error(await edgeError(error))
        if (data?.status === 'paid') {
          const codes: string[] = Array.isArray(data.productCodes) ? data.productCodes : typeof data.productCode === 'string' ? [data.productCode] : []
          activated.push(...codes.map(code => PAID_PRODUCTS.find(item => item.code === code)?.label ?? code))
          clearBasketCodes(codes)
        } else if (data?.status === 'pending') {
          setMessage(data.message || 'PayMongo has not confirmed this checkout as paid yet.')
        } else if (data?.error) {
          setMessage(data.error)
        }
      }
      await refreshData()
      if (activated.length) {
        setIsError(false)
        setMessage(`Payment confirmed. Activated: ${[...new Set(activated)].join(', ')}.`)
      } else if (!checkoutIds.length) {
        setMessage('You have no pending PayMongo checkouts.')
      }
    } catch (error) {
      setIsError(true)
      setMessage(await edgeError(error))
    } finally {
      setBusy(false)
    }
  }

  const style = {
    card: { background: 'var(--bg-card)', border: '1px solid var(--border)', padding: '1rem', borderRadius: 12 } as const,
    primary: { width: '100%', minHeight: 48, background: 'var(--accent)', borderColor: 'var(--accent)', color: 'var(--btn-primary-text)', fontWeight: 900 } as const,
  }

  return <div className="screen basket-page" style={{ width: 'min(calc(100% - 2rem), 1040px)', maxWidth: 1040, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{`
      .basket-page .basket-row{display:flex;align-items:center;justify-content:space-between;gap:1rem;border-bottom:1px solid var(--border);padding:.9rem 0}
      .basket-page .basket-row:last-child{border-bottom:0}
      .basket-page .basket-layout{display:grid;grid-template-columns:minmax(0,1fr) 310px;gap:1rem;align-items:start}
      .basket-page .basket-summary{position:sticky;top:84px}
      .basket-page .basket-item-art{width:48px;height:48px;display:grid;place-items:center;background:var(--bg-elevated);color:var(--accent);border:1px solid var(--border);border-radius:10px;font-size:1.4rem;flex-shrink:0}
      .basket-page .basket-muted{color:var(--text-muted);font-size:.84rem;line-height:1.45}
      .basket-page .basket-action-row{display:flex;gap:.5rem;flex-wrap:wrap}
      .basket-page .checkout-pay-button{background:var(--accent);border-color:var(--accent);color:var(--btn-primary-text);transition:background-color .16s ease,border-color .16s ease,transform .16s ease}
      .basket-page .checkout-pay-button:hover:not(:disabled){background:var(--accent-dim);border-color:var(--accent-dim)}
      [data-theme='dark'] .basket-page .checkout-pay-button{color:#fff}
      .basket-page .checkout-pay-button:focus-visible{outline:2px solid var(--accent);outline-offset:3px}
      .basket-page .manual-fallback-link{display:inline-flex;align-items:center;justify-content:center;gap:.25rem;color:var(--accent);font-weight:850;text-decoration:underline;text-underline-offset:3px;padding:.55rem .65rem;border:1px solid var(--border);border-radius:8px;overflow-wrap:anywhere}
      .basket-page .manual-fallback-link:hover{background:var(--bg-elevated)}
      @media(max-width:820px){.basket-page .basket-layout{grid-template-columns:minmax(0,1fr)}.basket-page .basket-summary{position:static}}
      @media(max-width:520px){.basket-page .basket-row{align-items:flex-start}.basket-page .basket-action-row button{flex:1}}
    `}</style>
    <button type="button" onClick={() => navigate('/account')} style={{ color: 'var(--text-muted)', marginBottom: '.6rem' }}>← Back to Bond Store</button>
    <AccountSectionTabs active={null} />
    <div style={{ display: 'flex', alignItems: 'end', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: '1rem' }}>
      <div><div style={{ color: 'var(--accent)', fontWeight: 900, fontSize: '.72rem', letterSpacing: '.16em', marginBottom: '.25rem' }}>HYPERION MARITIME</div><h1 className="page-title" style={{ textAlign: 'left', margin: 0 }}>Checkout</h1><p className="subtitle" style={{ textAlign: 'left', margin: '.35rem 0 0' }}>Review your selected tracks and check out securely in one payment.</p></div>
      <span style={{ border: '1px solid var(--border)', borderRadius: 9, padding: '.55rem .75rem', background: 'var(--bg-card)', fontWeight: 850, fontSize: '.8rem' }}>🛒 {basket.length} {basket.length === 1 ? 'item' : 'items'} to purchase</span>
    </div>

    {!session ? <section style={{ ...style.card, maxWidth: 600 }}>
      <h2 style={{ marginTop: 0 }}>Sign in to continue</h2>
      <p className="basket-muted">Your basket is saved in this browser. Sign in to verify pending purchases and complete checkout.</p>
      <button type="button" className="btn btn-primary" onClick={() => navigate('/account')} style={{ width: '100%' }}>SIGN IN / OPEN ACCOUNT</button>
    </section> : <>
      {message && <div role="status" style={{ ...style.card, marginBottom: '1rem', borderColor: isError ? 'var(--danger, #dc2626)' : 'var(--border)', lineHeight: 1.5 }}>
        {message}
        {isError && manualFallbackItems.length > 0 && <div style={{ marginTop: '.85rem', paddingTop: '.8rem', borderTop: '1px solid var(--border)' }}>
          <strong style={{ display: 'block', marginBottom: '.3rem' }}>PayMongo checkout is unavailable</strong>
          <p className="basket-muted" style={{ margin: '0 0 .7rem' }}>You can pay by QR instead. Choose the track below to open its dedicated manual payment page. Manual payments require admin review before your license is activated.</p>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
            {manualFallbackItems.map(({ code, term }) => {
              const item = PAID_PRODUCTS.find(product => product.code === code)
              if (!item) return null
              return <Link key={code} className="manual-fallback-link" to={`/manual-payment?product=${encodeURIComponent(code)}&term=${term}`}>Pay manually for {item.label} · ₱{priceForTerm(item, term)}</Link>
            })}
          </div>
        </div>}
      </div>}

      {pendingCheckoutGroups.length > 0 && <section style={{ ...style.card, borderColor: 'var(--border)', marginBottom: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 1, alignItems: 'center', flexWrap: 'wrap' }}>
          <div><h2 style={{ fontSize: '1.05rem', margin: 0 }}>Pending checkout{pendingCheckoutGroups.length === 1 ? '' : 's'}</h2><p className="basket-muted" style={{ margin: '.25rem 0 0' }}>Resume the same payment or cancel it safely. Don’t start a second payment for the same items.</p></div>
          <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void refreshStatus()}>{busy ? 'Checking…' : 'Refresh payment status'}</button>
        </div>
        {pendingCheckoutGroups.map(group => <div className="basket-row" key={group.id}>
          <div style={{ minWidth: 0 }}>
            <strong>{group.items.map(entry => `${PAID_PRODUCTS.find(item => item.code === entry.code)?.label ?? entry.code} (${termLabel(entry.term)})`).join(' + ')}</strong>
            <div className="basket-muted" style={{ marginTop: '.25rem' }}>{group.codes.length} track{group.codes.length === 1 ? '' : 's'} · ₱{group.total}</div>
          </div>
          <div className="basket-action-row">
            <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void checkout(group.items)}>RESUME CHECKOUT</button>
            <button type="button" className="btn btn-outline" disabled={busy} onClick={() => void cancelCheckout(group.id, group.items)} style={{ color: 'var(--danger, #dc2626)', borderColor: 'var(--danger, #dc2626)' }}>{busyCheckoutId === group.id ? 'CHECKING…' : 'CANCEL'}</button>
          </div>
        </div>)}
      </section>}

      <div className="basket-layout">
        <section style={style.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.8rem', flexWrap: 'wrap' }}>
            <div><h2 style={{ fontSize: '1.1rem', margin: 0 }}>Selected tracks</h2><p className="basket-muted" style={{ margin: '.25rem 0 0' }}>Only items shown here will be included in this payment.</p></div>
            {basket.length > 0 && <button type="button" className="btn btn-outline" disabled={busy} onClick={() => setBasket([])}>CLEAR SELECTION</button>}
          </div>
          {selectedItems.length ? selectedItems.map(({ code, term, product: item, price }) => {
            const active = ownedCodes.includes(code)
            return <div className="basket-row" key={code}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', minWidth: 0 }}>
                <div className="basket-item-art">{code === 'gmdss' ? '📡' : code === 'engine_ew' || code === 'engine_mgt' ? '⚙️' : '⚓'}</div>
                <div style={{ minWidth: 0 }}><strong style={{ display: 'block' }}>{item.label}</strong><div className="basket-muted">{term === 'week' ? '7-day' : term === 'month' ? '1-month' : '12-month'} reviewer license</div>{active && <div style={{ color: 'var(--success, #15803d)', fontWeight: 800, fontSize: '.75rem', marginTop: '.25rem' }}>Already active</div>}</div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: '.6rem', flexShrink: 0 }}><strong>₱{price}</strong><button type="button" disabled={busy} onClick={() => setBasket(current => current.filter(entry => entry.code !== code))} style={{ color: 'var(--danger, #dc2626)', fontWeight: 850, padding: '.35rem' }}>Remove</button></div>
            </div>
          }) : <div style={{ textAlign: 'center', padding: '2.4rem 1rem', border: '1px dashed var(--border)', borderRadius: 10, marginTop: '1rem' }}><div style={{ fontSize: '2rem', marginBottom: '.5rem' }}>🛒</div><strong>Your checkout is empty</strong><p className="basket-muted" style={{ margin: '.35rem 0 1rem' }}>Visit Bond Store and add one or more reviewer tracks.</p><button type="button" className="btn btn-primary" onClick={() => navigate('/account')}>BROWSE TRACKS</button></div>}
        </section>

        <aside className="basket-summary" style={style.card}>
          <h2 style={{ margin: 0, fontSize: '1.1rem' }}>Order summary</h2>
          <p className="basket-muted" style={{ margin: '.3rem 0 1rem' }}>{selectedItems.length} selected track{selectedItems.length === 1 ? '' : 's'}</p>
          {selectedItems.map(({ code, term, product, price }) => <div key={code} style={{ display: 'flex', justifyContent: 'space-between', gap: '.5rem', padding: '.45rem 0', fontSize: '.84rem' }}><span>{product.label} <span className="basket-muted">({termLabel(term)})</span></span><strong>₱{price}</strong></div>)}
          <div style={{ borderTop: '1px solid var(--border)', marginTop: '.7rem', paddingTop: '.8rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '.7rem' }}><strong>Total due</strong><strong style={{ fontSize: '1.5rem' }}>₱{totalPhp}</strong></div>
          <button type="button" className="btn btn-primary checkout-pay-button" disabled={busy || !supabaseConfigured || !selectedItems.length || activeInBasket.length > 0} onClick={() => void checkout()} style={{ ...style.primary, marginTop: '1rem' }}>{busy ? 'PROCESSING…' : '⚡ CHECK OUT WITH PAYMONGO →'}</button>
          {activeInBasket.length > 0 && <p style={{ color: 'var(--danger, #dc2626)', fontSize: '.8rem', lineHeight: 1.45 }}>Remove already active tracks to continue checkout.</p>}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.35rem', justifyContent: 'center', marginTop: '.8rem' }}>{['GCash','Maya','QR Ph','Card'].map(method => <span key={method} style={{ padding: '.3rem .45rem', border: '1px solid var(--border)', background: 'var(--bg-elevated)', borderRadius: 5, fontSize: '.7rem', fontWeight: 750 }}>{method}</span>)}</div>
          <p className="basket-muted" style={{ textAlign: 'center', fontSize: '.76rem', marginBottom: 0, marginTop: '.75rem' }}>Each selected track is activated only after PayMongo confirms this exact basket payment.</p>
        </aside>
      </div>
    </>}
  </div>
}
