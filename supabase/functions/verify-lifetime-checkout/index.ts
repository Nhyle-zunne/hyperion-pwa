import { createClient } from 'npm:@supabase/supabase-js@2'
import { finalizeVerifiedLifetimePayment } from '../_shared/paymongoLifetime.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
})
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const key = Deno.env.get('PAYMONGO_SECRET_KEY') || ''
  const expectedMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  const configured = (expectedMode === 'true' && key.startsWith('sk_live_')) ||
    (expectedMode === 'false' && key.startsWith('sk_test_'))
  if (!url || !anon || !service || !configured) {
    return json({ error: 'Payment verification is temporarily unavailable.' }, 503)
  }
  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Sign in first.' }, 401)
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
  })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return json({ error: 'Sign in again to verify your payment.' }, 401)
  let body: { orderId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  if (typeof body.orderId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId)) {
    return json({ error: 'Invalid lifetime order reference.' }, 400)
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: order, error: lookupError } = await admin.from('lifetime_orders')
    .select('*').eq('id', body.orderId).eq('user_id', user.id).maybeSingle()
  if (lookupError) return json({ error: 'Could not check your lifetime order.' }, 503)
  if (!order) return json({ error: 'Lifetime order not found for this account.' }, 404)
  if (order.status === 'refunded') return json({ status: 'refunded', orderId: order.id })
  if (order.status === 'paid') return json({ status: 'paid', orderId: order.id, productCode: order.product_code })
  if (order.status === 'reconciliation_required') {
    return json({ status: 'reconciliation_required', orderId: order.id, message: 'This payment needs support review; do not pay again.' })
  }
  if (order.status === 'cancelled') return json({ status: 'cancelled', orderId: order.id })
  if (!order.paymongo_checkout_session_id || order.paymongo_livemode !== (expectedMode === 'true')) {
    return json({ status: 'pending', orderId: order.id, message: 'No verified PayMongo payment has been recorded yet.' })
  }

  let session: any
  try {
    const result = await fetch(
      'https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(order.paymongo_checkout_session_id),
      { headers: { Authorization: 'Basic ' + btoa(key + ':') }, signal: AbortSignal.timeout(8000) }
    )
    if (!result.ok) return json({ error: 'PayMongo payment status could not be verified.' }, 502)
    session = (await result.json())?.data
  } catch {
    return json({ error: 'PayMongo verification is temporarily unavailable. Do not pay again.' }, 502)
  }
  if (!session || session.id !== order.paymongo_checkout_session_id ||
      session.attributes?.reference_number !== order.id ||
      session.attributes?.metadata?.kind !== 'lifetime' ||
      session.attributes?.metadata?.user_id !== user.id ||
      session.attributes?.metadata?.product_code !== order.product_code ||
      (typeof session.attributes?.livemode === 'boolean' &&
       session.attributes.livemode !== (expectedMode === 'true'))) {
    return json({ error: 'PayMongo returned a checkout with different payment details.' }, 409)
  }
  if (session.attributes?.status === 'expired' && !session.attributes?.payments?.some(
    (p: any) => p?.attributes?.status === 'paid'
  )) {
    await admin.from('lifetime_orders').update({ status: 'failed' })
      .eq('id', order.id).eq('status', 'pending')
    return json({ status: 'expired', orderId: order.id })
  }
  if (!session.attributes?.payments?.some((p: any) => p?.attributes?.status === 'paid')) {
    return json({ status: 'pending', orderId: order.id, message: 'PayMongo has not confirmed payment. Do not pay again until its status is known.' })
  }
  try {
    const verified = await finalizeVerifiedLifetimePayment(admin, order, session, expectedMode === 'true')
    return json(verified)
  } catch {
    return json({ error: 'Payment is reported by PayMongo but could not yet be safely finalized. Contact support; do not pay again.' }, 500)
  }
})
