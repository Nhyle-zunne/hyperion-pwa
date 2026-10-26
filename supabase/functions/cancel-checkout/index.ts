import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
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
    return json({ error: 'PayMongo is not configured. Please contact Hyperion support.' }, 503)
  }
  if ((expectedMode === 'true' && !paymongoKey.startsWith('sk_live_')) || (expectedMode === 'false' && !paymongoKey.startsWith('sk_test_'))) {
    return json({ error: 'PayMongo configuration does not match the active payment mode.' }, 503)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Please sign in first.' }, 401)
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser()
  if (userError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { orderId?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  if (!body.orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId)) {
    return json({ error: 'Invalid checkout order.' }, 400)
  }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const { data: order, error: orderError } = await admin.from('orders')
    .select('id,user_id,product_code,status,payment_method,paymongo_checkout_session_id')
    .eq('id', body.orderId)
    .eq('user_id', user.id)
    .maybeSingle()
  if (orderError || !order) return json({ error: 'Checkout order not found.' }, 404)
  if (order.status === 'paid') return json({ status: 'already_paid', orderId: order.id })
  if (order.payment_method !== 'PayMongo Checkout' || !order.paymongo_checkout_session_id) {
    return json({ error: 'This order is not a tracked PayMongo checkout.' }, 409)
  }
  if (order.status === 'cancelled' || order.status === 'failed') return json({ status: 'cancelled', orderId: order.id })
  if (order.status !== 'pending') return json({ error: 'This checkout cannot be cancelled in its current status.' }, 409)

  const sessionUrl = `https://api.paymongo.com/v2/checkout_sessions/${encodeURIComponent(order.paymongo_checkout_session_id)}`
  const auth = `Basic ${btoa(paymongoKey + ':')}`
  const getSession = async () => {
    const response = await fetch(sessionUrl, { headers: { Authorization: auth } })
    const result = await response.json().catch(() => ({}))
    return { response, result }
  }

  let sessionResponse: Response
  let sessionResult: any
  try {
    ({ response: sessionResponse, result: sessionResult } = await getSession())
  } catch {
    return json({ error: 'Could not check the checkout with PayMongo. Your order was not changed; please retry before switching payment methods.' }, 502)
  }
  if (!sessionResponse.ok) return json({ error: 'Could not verify the current checkout with PayMongo. Your order was not changed.' }, 502)

  const session = sessionResult?.data
  const attributes = session?.attributes
  if (session?.id !== order.paymongo_checkout_session_id
    || attributes?.reference_number !== order.id
    || attributes?.metadata?.order_id !== order.id
    || attributes?.metadata?.user_id !== user.id
    || attributes?.metadata?.product_code !== order.product_code
    || attributes?.livemode !== (expectedMode === 'true')) {
    return json({ error: 'The checkout details did not match this order. Please contact Hyperion support.' }, 409)
  }

  const payments = Array.isArray(attributes?.payments) ? attributes.payments : []
  if (payments.some((payment: any) => payment?.attributes?.status === 'paid')) {
    return json({ status: 'already_paid', orderId: order.id })
  }
  if (payments.some((payment: any) => ['pending', 'processing'].includes(payment?.attributes?.status))) {
    return json({ status: 'processing', orderId: order.id, message: 'A payment attempt is still processing. Please wait for PayMongo to confirm the result before switching to manual payment.' })
  }

  if (attributes?.status !== 'active' && attributes?.status !== 'expired') {
    return json({ error: 'PayMongo reported an unexpected checkout status. Please contact Hyperion support.' }, 409)
  }

  if (attributes.status === 'active') {
    let expireResponse: Response
    try {
      expireResponse = await fetch(
        `https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(order.paymongo_checkout_session_id)}/expire`,
        { method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json' } }
      )
    } catch {
      return json({ error: 'PayMongo could not be reached to close this checkout. Your order remains pending; please retry.' }, 502)
    }

    if (!expireResponse.ok) {
      // A payment may have started between the read and expire call. Re-read and
      // never allow a manual payment until PayMongo confirms the session is expired.
      try {
        const latest = await getSession()
        if (latest.response.ok) {
          const latestSession = latest.result?.data
          const latestAttrs = latestSession?.attributes
          const latestPayments = Array.isArray(latestAttrs?.payments) ? latestAttrs.payments : []
          if (latestPayments.some((payment: any) => payment?.attributes?.status === 'paid')) {
            return json({ status: 'already_paid', orderId: order.id })
          }
          if (latestPayments.some((payment: any) => ['pending', 'processing'].includes(payment?.attributes?.status))) {
            return json({ status: 'processing', orderId: order.id, message: 'A payment attempt is still processing. Please wait for PayMongo to confirm the result before switching payment methods.' })
          }
          if (latestAttrs?.status !== 'expired') {
            return json({ error: 'PayMongo could not close this checkout yet. Your order remains pending; please retry later.' }, 409)
          }
        } else {
          return json({ error: 'Could not verify whether PayMongo closed this checkout. Your order remains pending.' }, 502)
        }
      } catch {
        return json({ error: 'Could not verify whether PayMongo closed this checkout. Your order remains pending.' }, 502)
      }
    }
  }

  const { error: updateError } = await admin.from('orders')
    .update({ status: 'cancelled' })
    .eq('id', order.id)
    .eq('user_id', user.id)
    .eq('status', 'pending')
    .eq('payment_method', 'PayMongo Checkout')
  if (updateError) return json({ error: 'PayMongo closed the checkout, but Hyperion could not update the order. Refresh your account or contact support.' }, 500)

  return json({ status: 'cancelled', orderId: order.id })
})
