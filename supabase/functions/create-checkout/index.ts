import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const products = {
  oic_nw: { env: 'PRICE_OIC_NW_PHP', name: 'Hyperion Deck OIC-NW', track: 'DECK_OIC_NW' },
  gmdss: { env: 'PRICE_GMDSS_PHP', name: 'Hyperion GMDSS GOC', track: 'GMDSS_GOC' },
  engine_ew: { env: 'PRICE_ENGINE_EW_PHP', name: 'Hyperion Engine OIC-EW', track: 'ENGINE_OIC_EW' },
  deck_mgt: { env: 'PRICE_DECK_MGT_PHP', name: 'Hyperion Deck Management', track: 'DECK_MGT' },
  engine_mgt: { env: 'PRICE_ENGINE_MGT_PHP', name: 'Hyperion Engine Management', track: 'ENGINE_MGT' },
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paymongoKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Payment service is not configured. Contact Hyperion support.' }, 503)
  if (!paymongoKey) return json({ error: 'PayMongo checkout is not configured yet. Please use manual payment for now.' }, 503)

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Please sign in first.' }, 401)
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser()
  if (userError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { productCode?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const code = body.productCode as keyof typeof products
  const product = products[code]
  if (!product) return json({ error: 'Unknown product.' }, 400)

  const price = Number(Deno.env.get(product.env))
  if (!Number.isSafeInteger(price) || price <= 0) {
    return json({ error: `Price for ${code} is not configured. Please contact Hyperion support or use manual payment.` }, 503)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: currentEntitlement, error: entitlementLookupError } = await admin
    .from('entitlements')
    .select('status,expires_at')
    .eq('user_id', user.id)
    .eq('product_code', code)
    .maybeSingle()
  if (entitlementLookupError) return json({ error: 'Could not check the current license. Please retry.' }, 500)
  if (currentEntitlement?.status === 'active' && currentEntitlement.expires_at && new Date(currentEntitlement.expires_at).getTime() > Date.now()) {
    return json({ error: 'This license is already active for your account. You do not need to purchase this track again.' }, 409)
  }

  const { data: order, error: insertError } = await admin.from('orders').insert({
    user_id: user.id,
    product_code: code,
    track_id: product.track,
    amount_php: price,
    currency: 'PHP',
    status: 'pending',
    payment_method: 'PayMongo Checkout'
  }).select('id').single()
  if (insertError || !order) return json({ error: 'Could not create your order. Please try again.' }, 500)

  const configuredBase = (Deno.env.get('APP_BASE_URL') || 'https://hyperionmaritime.org').replace(/\/+$/, '')
  let appUrl: URL
  try { appUrl = new URL(configuredBase) } catch {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'The app return URL is not configured correctly.' }, 503)
  }
  if (appUrl.protocol !== 'https:' && !(appUrl.hostname === 'localhost' && appUrl.protocol === 'http:')) {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'The app return URL must use HTTPS.' }, 503)
  }

  const payload = {
    data: {
      attributes: {
        line_items: [{ name: product.name, amount: price * 100, currency: 'PHP', quantity: 1 }],
        payment_method_types: ['gcash', 'maya', 'qrph', 'card'],
        success_url: `${configuredBase}/account?payment=success&order_id=${encodeURIComponent(order.id)}`,
        cancel_url: `${configuredBase}/account?payment=cancelled&order_id=${encodeURIComponent(order.id)}`,
        reference_number: order.id,
        send_email_receipt: true,
        metadata: { order_id: order.id, user_id: user.id, product_code: code }
      }
    }
  }

  let response: Response
  let result: any
  try {
    response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(paymongoKey + ':')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    result = await response.json().catch(() => ({}))
  } catch {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'Could not connect to PayMongo. Please retry or use manual payment.' }, 502)
  }

  const checkoutUrl = result?.data?.attributes?.checkout_url
  const sessionId = result?.data?.id
  if (!response.ok || !checkoutUrl || !sessionId) {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'PayMongo could not start checkout. Check the API key and enabled payment methods.' }, 502)
  }

  let parsedCheckoutUrl: URL
  try { parsedCheckoutUrl = new URL(checkoutUrl) } catch {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'PayMongo returned an invalid checkout link.' }, 502)
  }
  if (parsedCheckoutUrl.protocol !== 'https:' || parsedCheckoutUrl.hostname !== 'checkout.paymongo.com') {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'PayMongo returned an unexpected checkout domain.' }, 502)
  }

  const { error: updateError } = await admin.from('orders')
    .update({ paymongo_checkout_session_id: sessionId, payment_reference: order.id })
    .eq('id', order.id)
  if (updateError) {
    // Do not redirect a customer to checkout when the session cannot be attached
    // to the server-owned order, because the webhook could not safely match it.
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'Checkout tracking could not be saved. Please use manual payment or contact support.' }, 500)
  }

  return json({ checkoutUrl: parsedCheckoutUrl.toString(), orderId: order.id })
})
