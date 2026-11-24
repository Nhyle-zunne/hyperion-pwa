import { createClient } from 'npm:@supabase/supabase-js@2'

// Preserve cancellation of historical Lifetime checkout sessions. The website
// no longer opens new hosted-payment sessions; current Lifetime purchases use
// QR Ph or bank transfer with administrator verification.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' },
  })
}

function historicPaymentConfiguration() {
  const key = Deno.env.get('PAYMONGO_SECRET_KEY') || ''
  const mode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  const configured = (mode === 'true' && key.startsWith('sk_live_')) ||
    (mode === 'false' && key.startsWith('sk_test_'))
  return { key, configured, isLive: mode === 'true' }
}

async function readProviderCheckout(key: string, id: string) {
  const response = await fetch(
    'https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(id),
    { headers: { Authorization: 'Basic ' + btoa(key + ':') }, signal: AbortSignal.timeout(8000) },
  )
  if (!response.ok) throw Error('Could not read the existing checkout.')
  const result = await response.json()
  if (result?.data?.id !== id) throw Error('Provider returned an unexpected session.')
  return result.data
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json({ error: 'Lifetime checkout is not configured.' }, 503)
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Sign in before managing Lifetime Access payments.' }, 401)
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: userError } = await client.auth.getUser()
  if (userError || !user) return json({ error: 'Sign in again to manage Lifetime Access payments.' }, 401)

  let body: { action?: unknown; orderId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  if (body.action === 'status') return json({ enabled: false })
  if (body.action !== 'cancel') return json({ error: 'New hosted checkout sessions are retired. Use manual QR Ph or bank transfer.' }, 503)

  const config = historicPaymentConfiguration()
  if (!config.configured) return json({ error: 'Historical checkout verification is temporarily unavailable. Contact support.' }, 503)

  if (typeof body.orderId !== 'string' || !/^[a-f0-9-]{36}$/i.test(body.orderId)) {
    return json({ error: 'Invalid lifetime order.' }, 400)
  }
  const admin = createClient(url, service, { auth: { persistSession: false } })
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
        { method: 'POST', headers: { Authorization: 'Basic ' + btoa(config.key + ':'), 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(8000) },
      )
      if (!expired.ok) return json({ error: 'The payment provider did not confirm cancellation. Do not create another payment yet.' }, 409)
    }
    const { data: updated, error: updateError } = await admin.from('lifetime_orders')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', order.id).eq('user_id', user.id).eq('status', 'pending')
      .select('id').maybeSingle()
    if (updateError || !updated) return json({ error: 'Checkout changed while cancelling. Refresh its status.' }, 409)
    return json({ status: 'cancelled', orderId: order.id })
  } catch {
    return json({ error: 'Could not safely confirm cancellation. Try again before creating another payment.' }, 502)
  }
})
