import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const url = Deno.env.get('SUPABASE_URL')!
  const anon = Deno.env.get('SUPABASE_ANON_KEY')!
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Please sign in first.' }, 401)

  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return json({ error: 'Please sign in again.' }, 401)

  let body: { orderId?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const orderId = String(body.orderId || '').trim()
  if (!orderId) return json({ error: 'Missing payment submission ID.' }, 400)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: order, error: findError } = await admin.from('orders')
    .select('id,status,payment_method,paymongo_checkout_session_id').eq('id', orderId).eq('user_id', user.id).maybeSingle()
  if (findError || !order) return json({ error: 'Payment submission not found.' }, 404)
  if (order.paymongo_checkout_session_id || order.payment_method === 'PayMongo Checkout' ||
      (typeof order.payment_method === 'string' && order.payment_method.startsWith('PayMongo ·'))) {
    return json({ error: 'This is a PayMongo checkout. Use Cancel Checkout so Hyperion can verify its payment status before changing the order.' }, 409)
  }
  if (!['submitted', 'pending'].includes(order.status)) return json({ error: 'Only a payment submission awaiting review can be cancelled.' }, 409)

  const { data: cancelledOrder, error } = await admin.from('orders').update({
    status: 'cancelled',
    admin_note: 'Cancelled by the customer before review.',
    reviewed_at: new Date().toISOString(),
    reviewed_by: user.id
  }).eq('id', orderId).eq('user_id', user.id).in('status', ['submitted', 'pending']).select('id').maybeSingle()
  if (error) return json({ error: 'Could not cancel the payment submission. Please refresh and try again.' }, 500)
  if (!cancelledOrder) return json({ error: 'This submission was changed while you were cancelling it. Refresh the page and check its current status.' }, 409)
  return json({ success: true, orderId, status: 'cancelled' })
})
