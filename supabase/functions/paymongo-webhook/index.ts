import { createClient } from 'npm:@supabase/supabase-js@2'

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
  const event = payload?.data
  const attributes = event?.attributes
  if (!event?.id || !attributes || typeof attributes.livemode !== 'boolean') {
    return new Response('Invalid webhook event envelope', { status: 400 })
  }

  const isLive = attributes.livemode === true
  const suppliedSignature = isLive ? parts.li : parts.te
  const expectedSignature = await hmacHex(webhookSecret, `${timestamp}.${raw}`)
  if (!suppliedSignature || !equalConstantTime(expectedSignature, suppliedSignature)) {
    return new Response('Invalid signature', { status: 401 })
  }

  const expectedMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  if (expectedMode === 'true' && !isLive) return new Response('Test-mode event rejected by live webhook', { status: 400 })
  if (expectedMode === 'false' && isLive) return new Response('Live event rejected by test webhook', { status: 400 })

  if (attributes.type !== 'checkout_session.payment.paid') return Response.json({ received: true })

  const checkoutSession = attributes.data
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

  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,user_id,product_code,track_id,amount_php,status,paymongo_checkout_session_id')
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
    order.id !== sessionAttrs?.metadata?.order_id
  ) return new Response('Order metadata mismatch', { status: 400 })

  const paymentAttrs = payment.attributes
  if (paymentAttrs?.currency !== 'PHP' || Number(paymentAttrs?.amount) !== order.amount_php * 100) {
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
    const expiresAt = new Date(renewalBase)
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)

    const { error: entitlementError } = await admin.from('entitlements').upsert({
      user_id: order.user_id,
      product_code: order.product_code,
      track_id: order.track_id,
      order_id: order.id,
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
    paid_at: new Date().toISOString()
  }).eq('id', order.id).eq('paymongo_checkout_session_id', checkoutSession.id).neq('status', 'paid')
  if (updateError) return new Response('Could not update paid order', { status: 500 })

  return Response.json({ received: true })
})
