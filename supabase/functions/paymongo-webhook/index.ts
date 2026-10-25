import { createClient } from 'npm:@supabase/supabase-js@2'

function equalConstantTime(a: string, b: string) {
  const aa = new TextEncoder().encode(a), bb = new TextEncoder().encode(b)
  if (aa.length !== bb.length) return false
  let diff = 0
  for (let i = 0; i < aa.length; i++) diff |= aa[i] ^ bb[i]
  return diff === 0
}
async function hmacHex(secret: string, value: string) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const bytes = new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value)))
  return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 })
  const raw = await req.text()
  const header = req.headers.get('Paymongo-Signature') || req.headers.get('X-Paymongo-Signature') || ''
  const parts = Object.fromEntries(header.split(',').map(part => part.trim().split('=').map(value => value.trim())))
  const timestamp = parts.t
  const secret = Deno.env.get('PAYMONGO_WEBHOOK_SECRET')
  if (!secret || !timestamp || (!parts.te && !parts.li)) return new Response('Webhook not configured or signature missing', { status: 401 })
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return new Response('Stale webhook', { status: 401 })
  const expected = await hmacHex(secret, `${timestamp}.${raw}`)
  let event: any
  try { event = JSON.parse(raw) } catch { return new Response('Invalid JSON', { status: 400 }) }
  const attributes = event?.data?.attributes
  const isLive = attributes?.livemode === true
  const supplied = isLive ? parts.li : parts.te
  if (!supplied || !equalConstantTime(expected, supplied)) return new Response('Invalid signature', { status: 401 })
  if (attributes?.type !== 'checkout_session.payment.paid') return Response.json({ received: true })

  const session = attributes?.data
  const sessionAttrs = session?.attributes
  const orderId = sessionAttrs?.reference_number || sessionAttrs?.metadata?.order_id
  const payment = Array.isArray(sessionAttrs?.payments) ? sessionAttrs.payments.find((p: any) => p?.attributes?.status === 'paid') : null
  if (!orderId || !session?.id || !payment) return new Response('Paid session is missing order or payment details', { status: 400 })

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!, { auth: { persistSession: false } })
  const { data: order, error: orderError } = await admin.from('orders').select('*').eq('id', orderId).maybeSingle()
  if (orderError || !order) return new Response('Order not found', { status: 404 })
  if (order.status === 'paid') return Response.json({ received: true, duplicate: true })
  if (order.paymongo_checkout_session_id !== session.id || order.product_code !== sessionAttrs?.metadata?.product_code || order.user_id !== sessionAttrs?.metadata?.user_id) return new Response('Order metadata mismatch', { status: 400 })
  const paymentAttrs = payment.attributes
  if (paymentAttrs.currency !== 'PHP' || Number(paymentAttrs.amount) !== order.amount_php * 100) return new Response('Payment amount mismatch', { status: 400 })

  const { error: updateError } = await admin.from('orders').update({ status: 'paid', paymongo_payment_id: payment.id, paid_at: new Date().toISOString() }).eq('id', order.id).neq('status', 'paid')
  if (updateError) return new Response('Could not update order', { status: 500 })
  const { error: entitlementError } = await admin.from('entitlements').upsert({ user_id: order.user_id, product_code: order.product_code, track_id: order.track_id, order_id: order.id, status: 'active' }, { onConflict: 'user_id,product_code' })
  if (entitlementError) return new Response('Could not grant entitlement', { status: 500 })
  return Response.json({ received: true })
})
