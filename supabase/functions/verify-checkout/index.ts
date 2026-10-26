import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const products: Record<string, { track: string }> = {
  oic_nw: { track: 'DECK_OIC_NW' },
  gmdss: { track: 'GMDSS_GOC' },
  engine_ew: { track: 'ENGINE_OIC_EW' },
  deck_mgt: { track: 'DECK_MGT' },
  engine_mgt: { track: 'ENGINE_MGT' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paymongoKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  const expectedMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Payment service is not configured.' }, 503)
  if (!paymongoKey || (expectedMode !== 'true' && expectedMode !== 'false')) {
    return json({ error: 'PayMongo checkout verification is not configured yet.' }, 503)
  }
  if ((expectedMode === 'true' && !paymongoKey.startsWith('sk_live_')) || (expectedMode === 'false' && !paymongoKey.startsWith('sk_test_'))) {
    return json({ error: 'The PayMongo API key does not match the configured test/live mode.' }, 503)
  }

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Please sign in first.' }, 401)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { orderId?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  if (!body.orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId)) {
    return json({ error: 'Invalid checkout order.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,user_id,product_code,track_id,amount_php,currency,status,payment_method,customer_name,customer_company,customer_school,paymongo_checkout_session_id')
    .eq('id', body.orderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (orderError || !order) return json({ error: 'Checkout order not found for your account.' }, 404)
  if (order.payment_method !== 'PayMongo Checkout' || !order.paymongo_checkout_session_id) {
    return json({ error: 'This order is not a tracked PayMongo checkout.' }, 409)
  }
  if (order.status === 'paid') {
    return json({ status: 'paid', orderId: order.id, productCode: order.product_code, trackId: order.track_id })
  }
  if (order.status !== 'pending') return json({ error: 'This checkout order is no longer pending.' }, 409)

  const product = products[order.product_code]
  if (!product || product.track !== order.track_id || order.currency !== 'PHP') {
    return json({ error: 'The order product or currency does not match Hyperion’s product catalogue.' }, 409)
  }

  let response: Response
  let result: any
  try {
    response = await fetch(`https://api.paymongo.com/v2/checkout_sessions/${encodeURIComponent(order.paymongo_checkout_session_id)}`, {
      headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}` }
    })
    result = await response.json().catch(() => ({}))
  } catch {
    return json({ error: 'Could not verify the payment with PayMongo. Refresh status shortly.' }, 502)
  }
  if (!response.ok) return json({ error: 'PayMongo could not verify this checkout. Check the API key and try refreshing status.' }, 502)

  const checkoutSession = result?.data
  const sessionAttrs = checkoutSession?.attributes
  const modeIsLive = expectedMode === 'true'
  if (checkoutSession?.id !== order.paymongo_checkout_session_id ||
      sessionAttrs?.livemode !== modeIsLive ||
      sessionAttrs?.reference_number !== order.id ||
      sessionAttrs?.metadata?.order_id !== order.id ||
      sessionAttrs?.metadata?.user_id !== order.user_id ||
      sessionAttrs?.metadata?.product_code !== order.product_code) {
    return json({ error: 'PayMongo checkout details did not match this order. No license was granted.' }, 409)
  }

  const payments = Array.isArray(sessionAttrs?.payments) ? sessionAttrs.payments : []
  const paidPayment = payments.find((payment: any) => payment?.attributes?.status === 'paid')
  if (!paidPayment) {
    return json({ status: 'pending', orderId: order.id, productCode: order.product_code, message: 'PayMongo has not confirmed a paid transaction for this checkout yet.' })
  }

  const paymentAttrs = paidPayment.attributes
  if (paymentAttrs?.currency !== 'PHP' || Number(paymentAttrs?.amount) !== order.amount_php * 100) {
    return json({ error: 'The confirmed payment amount or currency does not match this order. No license was granted.' }, 409)
  }

  const { data: existingEntitlement, error: entitlementLookupError } = await admin.from('entitlements')
    .select('order_id,status,expires_at')
    .eq('user_id', order.user_id)
    .eq('product_code', order.product_code)
    .maybeSingle()
  if (entitlementLookupError) return json({ error: 'Could not check the current entitlement. Please retry.' }, 500)

  let expiresAt: Date
  const alreadyGrantedForOrder = existingEntitlement?.order_id === order.id
    && existingEntitlement.status === 'active'
    && existingEntitlement.expires_at
  if (alreadyGrantedForOrder) {
    expiresAt = new Date(existingEntitlement.expires_at)
  } else {
    const now = new Date()
    const existingExpiry = existingEntitlement?.status === 'active' && existingEntitlement.expires_at
      ? new Date(existingEntitlement.expires_at)
      : null
    const renewalBase = existingExpiry && existingExpiry.getTime() > now.getTime() ? existingExpiry : now
    expiresAt = new Date(renewalBase)
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)

    const { error: grantError } = await admin.from('entitlements').upsert({
      user_id: order.user_id,
      product_code: order.product_code,
      track_id: order.track_id,
      order_id: order.id,
      status: 'active',
      granted_at: now.toISOString(),
      renewed_at: now.toISOString(),
      expires_at: expiresAt.toISOString()
    }, { onConflict: 'user_id,product_code' })
    if (grantError) return json({ error: 'Payment was confirmed, but Hyperion could not save the license. Please contact support with your order ID.' }, 500)
  }

  const paymentSource = paymentAttrs?.source?.type || paymentAttrs?.source?.attributes?.type || 'PayMongo Checkout'
  const billingName = paymentAttrs?.billing?.name || sessionAttrs?.billing?.name || null
  const billingEmail = paymentAttrs?.billing?.email || sessionAttrs?.billing?.email || null
  const profile = user.user_metadata ?? {}
  const profileName = [
    profile.full_name,
    profile.name,
    [profile.given_name, profile.family_name].filter((value: unknown) => typeof value === 'string' && value.trim()).join(' ')
  ].find((value: unknown) => typeof value === 'string' && value.trim()) || billingName || null
  const updatePayload: Record<string, unknown> = {
    status: 'paid',
    paymongo_payment_id: paidPayment.id,
    payment_reference: paidPayment.id,
    payment_method: `PayMongo · ${String(paymentSource).slice(0, 80)}`,
    paid_at: new Date().toISOString(),
    customer_name: order.customer_name || profileName,
    customer_company: order.customer_company || (typeof profile.company === 'string' ? profile.company : null),
    customer_school: order.customer_school || (typeof profile.school === 'string' ? profile.school : null)
  }
  const { data: updatedOrder, error: updateError } = await admin.from('orders')
    .update(updatePayload)
    .eq('id', order.id)
    .eq('user_id', order.user_id)
    .eq('status', 'pending')
    .select('id,status')
    .maybeSingle()
  if (updateError) return json({ error: 'License was saved but Hyperion could not finalize the order status.' }, 500)
  if (!updatedOrder) {
    const { data: latestOrder } = await admin.from('orders').select('status').eq('id', order.id).maybeSingle()
    if (latestOrder?.status !== 'paid') return json({ error: 'The order changed while the payment was being finalized. Refresh status shortly.' }, 409)
  }

  return json({ status: 'paid', orderId: order.id, productCode: order.product_code, trackId: order.track_id, expiresAt: expiresAt.toISOString() })
})
