import { createClient } from 'npm:@supabase/supabase-js@2'

type LicenseTerm = 'week' | 'month' | 'year'
const productTracks: Record<string, string> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}
const termPrices: Record<string, Record<LicenseTerm, number>> = {
  oic_nw: { week: 20, month: 50, year: 350 },
  gmdss: { week: 15, month: 40, year: 250 },
  engine_ew: { week: 20, month: 50, year: 350 },
  deck_mgt: { week: 40, month: 100, year: 700 },
  engine_mgt: { week: 40, month: 100, year: 700 }
}
function expiryForTerm(base: Date, term: LicenseTerm) {
  const result = new Date(base)
  if (term === 'week') {
    result.setUTCDate(result.getUTCDate() + 7)
    return result
  }
  if (term === 'month') {
    const day = result.getUTCDate()
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + 1)
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
    result.setUTCDate(Math.min(day, lastDay))
    return result
  }
  const month = result.getUTCMonth()
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCFullYear(result.getUTCFullYear() + 1)
  result.setUTCMonth(month)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), month + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}

function equalConstantTime(a: string, b: string) {
  const aa = new TextEncoder().encode(a)
  const bb = new TextEncoder().encode(b)
  if (aa.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i]
  return diff === 0
}

async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })

  const raw = await req.text()
  const header = req.headers.get('Paymongo-Signature') || req.headers.get('X-Paymongo-Signature') || ''
  const parts: Record<string, string> = {}
  for (const item of header.split(',')) {
    const separator = item.indexOf('=')
    if (separator > 0) parts[item.slice(0, separator).trim()] = item.slice(separator + 1).trim()
  }

  const timestamp = parts.t
  const webhookSecret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')
  if (!webhookSecret || !timestamp || (!parts.te && !parts.li)) {
    return new Response('Webhook not configured or signature missing', { status: 401 })
  }
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
    return new Response('Stale webhook', { status: 401 })
  }

  let payload: any
  try { payload = JSON.parse(raw) } catch { return new Response('Invalid JSON', { status: 400 }) }

  // PayMongo has documented both the legacy event envelope
  // { data: { id, type: "event", attributes: { type, livemode, data } } }
  // and the newer dispatch envelope
  // { event_type: "send.webhook", data: { type, livemode, data } }.
  // Normalize both before verifying the signature and processing the session.
  const eventRoot = payload?.data
  const legacyAttributes = eventRoot?.attributes
  const eventType = typeof legacyAttributes?.type === 'string'
    ? legacyAttributes.type
    : typeof eventRoot?.type === 'string' && eventRoot.type !== 'event'
      ? eventRoot.type
      : null
  const isLiveValue = typeof legacyAttributes?.livemode === 'boolean'
    ? legacyAttributes.livemode
    : typeof eventRoot?.livemode === 'boolean'
      ? eventRoot.livemode
      : null
  const checkoutSessionFromEvent = legacyAttributes?.data ?? eventRoot?.data

  if (!eventType || typeof isLiveValue !== 'boolean') {
    return new Response('Invalid webhook event envelope', { status: 400 })
  }

  const isLive = isLiveValue
  const suppliedSignature = isLive ? parts.li : parts.te
  const expectedSignature = await hmacHex(webhookSecret, `${timestamp}.${raw}`)
  if (!suppliedSignature || !equalConstantTime(expectedSignature, suppliedSignature)) {
    return new Response('Invalid signature', { status: 401 })
  }

  const expectedMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  if (expectedMode !== 'true' && expectedMode !== 'false') {
    return new Response('Expected PayMongo live/test mode is not configured', { status: 503 })
  }
  if ((expectedMode === 'true') !== isLive) {
    return new Response('Webhook event mode does not match configured checkout mode', { status: 400 })
  }

  if (eventType !== 'checkout_session.payment.paid') return Response.json({ received: true })

  const checkoutSession = checkoutSessionFromEvent
  const sessionAttrs = checkoutSession?.attributes
  const orderId = sessionAttrs?.reference_number || sessionAttrs?.metadata?.order_id
  const payment = Array.isArray(sessionAttrs?.payments)
    ? sessionAttrs.payments.find((item: any) => item?.attributes?.status === 'paid')
    : null
  if (!orderId || !checkoutSession?.id || !payment) {
    return new Response('Paid session is missing order or payment details', { status: 400 })
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!supabaseUrl || !serviceKey) return new Response('Payment service is not configured', { status: 503 })
  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Multi-item basket payment: activate exactly the child orders recorded for this
  // server-created batch, never a client-supplied product list.
  const { data: batch, error: batchError } = await admin.from('checkout_batches')
    .select('*')
    .eq('id', orderId)
    .maybeSingle()
  if (batchError) return new Response('Could not look up basket checkout', { status: 500 })
  if (batch) {
    if (batch.status === 'paid') return Response.json({ received: true, duplicate: true })
    if (batch.status !== 'pending' || batch.paymongo_checkout_session_id !== checkoutSession.id) {
      return new Response('Basket order status or checkout session mismatch', { status: 409 })
    }
    const codes = Array.isArray(batch.product_codes) ? batch.product_codes as string[] : []
    const batchTerms = (batch.license_terms ?? codes.map(() => 'year')) as string[]
    const metadataCodes = typeof sessionAttrs?.metadata?.product_codes === 'string'
      ? sessionAttrs.metadata.product_codes.split(',').filter(Boolean).sort()
      : []
    const expectedProductTerms = codes.map((code, index) => `${code}:${batchTerms[index]}`).sort().join(',')
    const metadataProductTerms = typeof sessionAttrs?.metadata?.product_terms === 'string'
      ? sessionAttrs.metadata.product_terms.split(',').sort().join(',')
      : ''
    if (!codes.length || new Set(codes).size !== codes.length ||
        batchTerms.length !== codes.length || batchTerms.some(term => !['week','month','year'].includes(term)) ||
        sessionAttrs?.reference_number !== batch.id ||
        (sessionAttrs?.metadata?.batch_id !== batch.id && sessionAttrs?.metadata?.order_id !== batch.id) ||
        sessionAttrs?.metadata?.user_id !== batch.user_id ||
        metadataCodes.join(',') !== [...codes].sort().join(',') ||
        (metadataProductTerms ? metadataProductTerms !== expectedProductTerms : batchTerms.some(term => term !== 'year')) ||
        sessionAttrs?.livemode !== isLive) {
      return new Response('Basket order metadata mismatch', { status: 400 })
    }

    const paymentAttrs = payment.attributes
    if (paymentAttrs?.currency !== 'PHP' || Number(paymentAttrs?.amount) !== Number(batch.amount_php) * 100) {
      return new Response('Basket payment amount mismatch', { status: 400 })
    }

    const { data: childOrders, error: childError } = await admin.from('orders')
      .select('id,user_id,product_code,track_id,license_term,amount_php,currency,status,customer_name,customer_company,customer_school')
      .eq('checkout_batch_id', batch.id)
      .eq('user_id', batch.user_id)
    if (childError || !childOrders) return new Response('Could not load basket order items', { status: 500 })
    const childCodes = childOrders.map((order: any) => order.product_code).sort()
    const expectedCodes = [...codes].sort()
    const childTotal = childOrders.reduce((sum: number, order: any) => sum + Number(order.amount_php), 0)
    const termsByCode = Object.fromEntries(codes.map((code, index) => [code, batchTerms[index]])) as Record<string, LicenseTerm>
    if (childOrders.length !== codes.length ||
        childCodes.some((code: string, index: number) => code !== expectedCodes[index]) ||
        childOrders.some((order: any) => productTracks[order.product_code] !== order.track_id || order.currency !== 'PHP' ||
          order.license_term !== termsByCode[order.product_code] ||
          Number(order.amount_php) !== termPrices[order.product_code]?.[termsByCode[order.product_code]]) ||
        childTotal !== Number(batch.amount_php)) {
      return new Response('Basket item list or total mismatch', { status: 400 })
    }

    const source = paymentAttrs?.source?.type || paymentAttrs?.source?.attributes?.type || 'PayMongo Checkout'
    const paidAt = new Date().toISOString()
    const customerName = batch.customer_name || sessionAttrs?.billing?.name || paymentAttrs?.billing?.name || null
    const customerCompany = batch.customer_company || null
    const customerSchool = batch.customer_school || null

    for (const order of childOrders) {
      const { data: existingEntitlement, error: currentError } = await admin.from('entitlements')
        .select('order_id,status,expires_at')
        .eq('user_id', order.user_id)
        .eq('product_code', order.product_code)
        .maybeSingle()
      if (currentError) return new Response('Could not check basket entitlement', { status: 500 })

      const alreadyGrantedForOrder = existingEntitlement?.order_id === order.id
        && existingEntitlement.status === 'active'
        && existingEntitlement.expires_at
      if (!alreadyGrantedForOrder) {
        const now = new Date()
        const existingExpiry = existingEntitlement?.status === 'active' && existingEntitlement.expires_at
          ? new Date(existingEntitlement.expires_at)
          : null
        const renewalBase = existingExpiry && existingExpiry.getTime() > now.getTime() ? existingExpiry : now
        const term: LicenseTerm = order.license_term === 'week' || order.license_term === 'month' ? order.license_term : 'year'
        const expiresAt = expiryForTerm(renewalBase, term)

        const { error: grantError } = await admin.from('entitlements').upsert({
          user_id: order.user_id,
          product_code: order.product_code,
          track_id: order.track_id,
          order_id: order.id,
          license_term: term,
          status: 'active',
          granted_at: now.toISOString(),
          renewed_at: now.toISOString(),
          expires_at: expiresAt.toISOString()
        }, { onConflict: 'user_id,product_code' })
        if (grantError) return new Response('Could not grant a basket entitlement', { status: 500 })
      }
    }

    const { error: ordersUpdateError } = await admin.from('orders').update({
      status: 'paid',
      payment_reference: payment.id,
      payment_method: `PayMongo · ${String(source).slice(0, 80)}`,
      paid_at: paidAt,
      customer_name: customerName,
      customer_company: customerCompany,
      customer_school: customerSchool
    }).eq('checkout_batch_id', batch.id).eq('user_id', batch.user_id).in('status', ['pending','paid'])
    if (ordersUpdateError) return new Response('Could not finalize basket order items', { status: 500 })

    const { error: batchUpdateError } = await admin.from('checkout_batches').update({
      status: 'paid',
      paymongo_payment_id: payment.id,
      payment_reference: payment.id,
      payment_method: `PayMongo · ${String(source).slice(0, 80)}`,
      paid_at: paidAt,
      customer_name: customerName,
      customer_company: customerCompany,
      customer_school: customerSchool
    }).eq('id', batch.id).eq('status', 'pending')
    if (batchUpdateError) return new Response('Could not finalize basket payment', { status: 500 })

    return Response.json({ received: true, basket: true, productCount: codes.length })
  }

  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,user_id,product_code,track_id,license_term,amount_php,status,customer_name,customer_company,customer_school,paymongo_checkout_session_id')
    .eq('id', orderId)
    .maybeSingle()
  if (orderError || !order) return new Response('Order not found', { status: 404 })
  if (order.status === 'paid') return Response.json({ received: true, duplicate: true })
  if (order.status !== 'pending' || order.paymongo_checkout_session_id !== checkoutSession.id) {
    return new Response('Order status or checkout session mismatch', { status: 409 })
  }
  if (
    order.product_code !== sessionAttrs?.metadata?.product_code ||
    order.user_id !== sessionAttrs?.metadata?.user_id ||
    order.id !== sessionAttrs?.metadata?.order_id ||
    (sessionAttrs?.metadata?.license_term && sessionAttrs.metadata.license_term !== (order.license_term || 'year'))
  ) return new Response('Order metadata mismatch', { status: 400 })

  const paymentAttrs = payment.attributes
  const singleTerm: LicenseTerm = order.license_term === 'week' || order.license_term === 'month' ? order.license_term : 'year'
  if (Number(order.amount_php) !== termPrices[order.product_code]?.[singleTerm] ||
      paymentAttrs?.currency !== 'PHP' || Number(paymentAttrs?.amount) !== order.amount_php * 100) {
    return new Response('Payment amount mismatch', { status: 400 })
  }

  // Make retry handling idempotent. If the entitlement was written before a prior
  // delivery failed, reuse its expiry instead of extending the subscription twice.
  const { data: existingEntitlement, error: currentError } = await admin.from('entitlements')
    .select('order_id,status,expires_at')
    .eq('user_id', order.user_id)
    .eq('product_code', order.product_code)
    .maybeSingle()
  if (currentError) return new Response('Could not check current entitlement', { status: 500 })

  const alreadyGrantedForOrder = existingEntitlement?.order_id === order.id
    && existingEntitlement.status === 'active'
    && existingEntitlement.expires_at
  if (!alreadyGrantedForOrder) {
    const now = new Date()
    const existingExpiry = existingEntitlement?.status === 'active' && existingEntitlement.expires_at
      ? new Date(existingEntitlement.expires_at)
      : null
    const hasFutureExpiry = existingExpiry && existingExpiry.getTime() > now.getTime()
    const renewalBase = hasFutureExpiry ? existingExpiry : now
    const expiresAt = expiryForTerm(renewalBase, singleTerm)

    const { error: entitlementError } = await admin.from('entitlements').upsert({
      user_id: order.user_id,
      product_code: order.product_code,
      track_id: order.track_id,
      order_id: order.id,
      license_term: singleTerm,
      status: 'active',
      granted_at: now.toISOString(),
      renewed_at: now.toISOString(),
      expires_at: expiresAt.toISOString()
    }, { onConflict: 'user_id,product_code' })
    if (entitlementError) return new Response('Could not grant entitlement', { status: 500 })
  }

  const paymentSource = paymentAttrs?.source?.type || paymentAttrs?.source?.attributes?.type || 'PayMongo Checkout'
  const { error: updateError } = await admin.from('orders').update({
    status: 'paid',
    paymongo_payment_id: payment.id,
    payment_reference: payment.id,
    payment_method: `PayMongo · ${String(paymentSource).slice(0, 80)}`,
    paid_at: new Date().toISOString(),
    customer_name: order.customer_name || sessionAttrs?.billing?.name || paymentAttrs?.billing?.name || null
  }).eq('id', order.id).eq('paymongo_checkout_session_id', checkoutSession.id).neq('status', 'paid')
  if (updateError) return new Response('Could not update paid order', { status: 500 })

  return Response.json({ received: true })
})
