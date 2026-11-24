import { createClient } from 'npm:@supabase/supabase-js@2'
import { finalizeVerifiedLifetimePayment, lifetimeProduct, hasLifetimePaymongoWebhook } from '../_shared/paymongoLifetime.ts'

const WEBSITE_PAYMONGO_PURCHASES_DISABLED = true

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
  })
}
function paymentConfiguration() {
  const key = Deno.env.get('PAYMONGO_SECRET_KEY') || ''
  const mode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  const configured = (mode === 'true' && key.startsWith('sk_live_')) ||
    (mode === 'false' && key.startsWith('sk_test_'))
  return {
    key, mode, configured, isLive: mode === 'true',
    // Reuse the working PayMongo checkout integration. The optional lifetime
    // override permits emergency shutdown, never bypassing the webhook gate.
    enabled: configured && Deno.env.get('PAYMONGO_CHECKOUT_ENABLED') === 'true' &&
      Deno.env.get('LIFETIME_PAYMONGO_ENABLED') !== 'false'
  }
}
async function readProviderCheckout(key: string, id: string) {
  const response = await fetch(
    'https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(id),
    { headers: { Authorization: 'Basic ' + btoa(key + ':') }, signal: AbortSignal.timeout(8000) }
  )
  if (!response.ok) throw Error('Could not read the existing PayMongo checkout.')
  const result = await response.json()
  if (result?.data?.id !== id) throw Error('PayMongo returned an unexpected session.')
  return result.data
}
function checkoutUrl(session: any): string | null {
  const raw = session?.attributes?.checkout_url
  if (typeof raw !== 'string') return null
  try {
    const url = new URL(raw)
    return url.protocol === 'https:' && url.hostname === 'checkout.paymongo.com' ? url.toString() : null
  } catch { return null }
}

// Do not rely on a paid-event-only subscription for permanent licenses.
// Provider webhooks must include completed refunds, in the correct mode.
let webhookReadyUntil = 0
async function lifetimeWebhookReady(key: string, isLive: boolean, supabaseUrl: string): Promise<boolean> {
  if (Date.now() < webhookReadyUntil) return true
  try {
    const endpoint = new URL('/functions/v1/paymongo-webhook', supabaseUrl)
    if (endpoint.protocol !== 'https:') return false
    const response = await fetch('https://api.paymongo.com/v1/webhooks', {
      headers: { Authorization: 'Basic ' + btoa(key + ':') },
      signal: AbortSignal.timeout(8000)
    })
    if (!response.ok) return false
    const payload = await response.json()
    const valid = hasLifetimePaymongoWebhook(payload?.data, endpoint.toString(), isLive)
    if (valid) webhookReadyUntil = Date.now() + 60000
    return valid
  } catch { return false }
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json({ error: 'Lifetime checkout is not configured.' }, 503)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Sign in before buying Lifetime Access.' }, 401)
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError || !user) return json({ error: 'Sign in again to buy Lifetime Access.' }, 401)

  let body: { action?: unknown; productCode?: unknown; expectedTotalPhp?: unknown; orderId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const config = paymentConfiguration()
  if (body.action === 'status') {
    const enabled = !WEBSITE_PAYMONGO_PURCHASES_DISABLED && config.enabled && await lifetimeWebhookReady(config.key, config.isLive, url)
    return json({ enabled })
  }
  if (!config.configured) return json({ error: 'PayMongo checkout is not configured.' }, 503)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  if (body.action === 'cancel') {
    if (typeof body.orderId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.orderId)) {
      return json({ error: 'Invalid lifetime order.' }, 400)
    }
    const { data: order, error: lookupError } = await admin.from('lifetime_orders')
      .select('*').eq('id', body.orderId).eq('user_id', user.id).maybeSingle()
    if (lookupError) return json({ error: 'Unable to load your lifetime checkout.' }, 500)
    if (!order) return json({ error: 'Lifetime order not found.' }, 404)
    if (order.status === 'cancelled') return json({ status: 'cancelled', orderId: order.id })
    if (order.status !== 'pending' || !order.paymongo_checkout_session_id) {
      return json({ error: 'This checkout cannot be cancelled online. Contact support if needed.' }, 409)
    }
    try {
      const session = await readProviderCheckout(config.key, order.paymongo_checkout_session_id)
      const attrs = session?.attributes
      if (attrs?.reference_number !== order.id || attrs?.metadata?.kind !== 'lifetime' ||
          attrs?.metadata?.user_id !== user.id || attrs?.metadata?.product_code !== order.product_code ||
          (typeof attrs?.livemode === 'boolean' && attrs.livemode !== config.isLive)) {
        return json({ error: 'Provider checkout identity mismatch. Contact support.' }, 409)
      }
      if (attrs?.payments?.some((p: any) => p?.attributes?.status === 'paid') ||
          attrs?.payments?.some((p: any) => p?.attributes?.status === 'processing')) {
        return json({ error: 'Payment is processing or completed. Verify its status before cancelling.' }, 409)
      }
      if (attrs?.status !== 'expired') {
        const expired = await fetch(
          'https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(session.id) + '/expire',
          { method: 'POST', headers: { Authorization: 'Basic ' + btoa(config.key + ':'), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) }
        )
        if (!expired.ok) return json({ error: 'PayMongo did not confirm cancellation. Do not create another payment yet.' }, 409)
      }
      const { data: updated, error: updateError } = await admin.from('lifetime_orders')
        .update({ status: 'cancelled', updated_at: new Date().toISOString() })
        .eq('id', order.id).eq('user_id', user.id).eq('status', 'pending')
        .select('id').maybeSingle()
      if (updateError || !updated) return json({ error: 'Checkout changed while cancelling. Refresh its status.' }, 409)
      return json({ status: 'cancelled', orderId: order.id })
    } catch {
      return json({ error: 'Could not safely confirm PayMongo cancellation. Try again before creating another payment.' }, 502)
    }
  }

  if (body.action !== 'create') return json({ error: 'Unsupported lifetime checkout action.' }, 400)
  if (WEBSITE_PAYMONGO_PURCHASES_DISABLED) return json({ error: 'Website payments use the manual QR checkout. New PayMongo sessions are disabled.' }, 503)
  if (!config.enabled || !await lifetimeWebhookReady(config.key, config.isLive, url)) {
    return json({ error: 'Lifetime Access requires a working PayMongo checkout and a live signed payment-and-refund webhook. No payment has been started.' }, 503)
  }
  const product = lifetimeProduct(body.productCode)
  if (!product) return json({ error: 'Choose a valid Lifetime Access track.' }, 400)
  if (body.expectedTotalPhp !== product.amountPhp) {
    return json({ error: 'Lifetime price has changed. Refresh the store before paying.' }, 409)
  }
  const { data: existingOwnership, error: ownerError } = await admin.from('lifetime_entitlements')
    .select('id').eq('user_id', user.id).eq('product_code', product.code)
    .eq('status', 'active').limit(1)
  if (ownerError) return json({ error: 'Could not safely verify existing lifetime ownership.' }, 503)
  if (existingOwnership?.length) return json({ error: 'This account already owns Lifetime Access for that track.' }, 409)

  // Reuse the same pending order and provider idempotency key across tabs.
  let { data: order, error: pendingError } = await admin.from('lifetime_orders')
    .select('*').eq('user_id', user.id).eq('product_code', product.code)
    .eq('status', 'pending').maybeSingle()
  if (pendingError) return json({ error: 'Unable to check your open lifetime payments.' }, 503)
  if (!order) {
    const created = await admin.from('lifetime_orders').insert({
      user_id: user.id, product_code: product.code, track_id: product.track,
      amount_php: product.amountPhp, status: 'pending', paymongo_livemode: config.isLive
    }).select('*').single()
    if (created.error?.code === '23505') return json({ error: 'Checkout opened in another tab. Refresh and resume it.' }, 409)
    if (created.error || !created.data) return json({ error: 'Unable to prepare your lifetime order.' }, 500)
    order = created.data
  }
  if (order.amount_php !== product.amountPhp || order.track_id !== product.track ||
      order.currency !== 'PHP' || order.paymongo_livemode !== config.isLive) {
    return json({ error: 'This pending checkout uses a previous price. Cancel the pending checkout on this page to start a new purchase at the updated price.' }, 409)
  }
  if (order.paymongo_checkout_session_id) {
    try {
      const session = await readProviderCheckout(config.key, order.paymongo_checkout_session_id)
      if (session.attributes?.reference_number !== order.id ||
          session.attributes?.metadata?.kind !== 'lifetime' ||
          session.attributes?.metadata?.product_code !== product.code ||
          session.attributes?.metadata?.user_id !== user.id ||
          (typeof session.attributes?.livemode === 'boolean' && session.attributes.livemode !== config.isLive)) {
        return json({ error: 'Open checkout identity mismatch. Contact support.' }, 409)
      }
      if (session.attributes?.payments?.some((p: any) => p?.attributes?.status === 'paid')) {
        const verified = await finalizeVerifiedLifetimePayment(admin, order, session, config.isLive)
        return json({ ...verified, orderId: order.id })
      }
      if (session.attributes?.status === 'expired') {
        await admin.from('lifetime_orders').update({ status: 'failed' })
          .eq('id', order.id).eq('status', 'pending')
        return json({ error: 'Previous checkout expired. Try buying again.' }, 409)
      }
      const link = checkoutUrl(session)
      return link ? json({ status: 'pending', orderId: order.id, checkoutUrl: link, reused: true })
        : json({ error: 'Unable to resume the existing checkout. Contact support.' }, 409)
    } catch {
      return json({ error: 'Could not safely resume your PayMongo checkout. Do not pay twice.' }, 502)
    }
  }

  const configuredBase = (Deno.env.get('APP_BASE_URL') || 'https://hyperionmaritime.org').replace(/\/+$/, '')
  let base: URL
  try { base = new URL(configuredBase) } catch {
    return json({ error: 'Invalid checkout return URL configuration.' }, 503)
  }
  if (base.protocol !== 'https:' && !(base.hostname === 'localhost' && base.protocol === 'http:')) {
    return json({ error: 'Lifetime checkout requires an HTTPS return URL.' }, 503)
  }
  const profile = user.user_metadata || {}
  const customerName = typeof profile.full_name === 'string' ? profile.full_name.trim().slice(0, 160) : null
  const payload = {
    data: { attributes: {
      line_items: [{ name: product.label + ' — Lifetime Access', amount: product.amountPhp * 100, currency: 'PHP', quantity: 1 }],
      billing: { ...(customerName ? { name: customerName } : {}), ...(user.email ? { email: user.email } : {}) },
      payment_method_types: ['qrph'],
      success_url: configuredBase + '/account?tab=licenses&lifetime_payment=success&lifetime_order_id=' + encodeURIComponent(order.id),
      cancel_url: configuredBase + '/account?tab=licenses&lifetime_payment=cancelled&lifetime_order_id=' + encodeURIComponent(order.id),
      reference_number: order.id,
      send_email_receipt: true,
      metadata: { kind: 'lifetime', order_id: order.id, user_id: user.id, product_code: product.code }
    } }
  }
  let response: Response
  let result: any
  try {
    response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST',
      headers: {
        Authorization: 'Basic ' + btoa(config.key + ':'),
        'Content-Type': 'application/json',
        'Idempotency-Key': order.id
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(10000)
    })
    result = await response.json().catch(() => ({}))
  } catch {
    // Outcome unknown. Keep order/idempotency key to prevent duplicate charges.
    return json({ error: 'PayMongo connection was interrupted. Retry the same checkout; do not start a second purchase.' }, 502)
  }
  const session = result?.data
  const link = checkoutUrl(session)
  if (!response.ok || !session?.id || !link) {
    return json({ error: 'PayMongo could not issue a verified lifetime checkout. Retry or contact support.' }, 502)
  }
  const saved = await admin.from('lifetime_orders')
    .update({ paymongo_checkout_session_id: session.id, updated_at: new Date().toISOString() })
    .eq('id', order.id).eq('status', 'pending')
    .is('paymongo_checkout_session_id', null).select('id').maybeSingle()
  if (saved.error || !saved.data) {
    // Never issue an untracked checkout URL.
    await fetch('https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(session.id) + '/expire', {
      method: 'POST', headers: { Authorization: 'Basic ' + btoa(config.key + ':') },
      signal: AbortSignal.timeout(8000)
    }).catch(() => undefined)
    return json({ error: 'Could not save PayMongo tracking. Contact support before retrying.' }, 500)
  }
  return json({ status: 'pending', orderId: order.id, checkoutUrl: link })
})
