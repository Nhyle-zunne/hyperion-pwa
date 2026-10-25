import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
const products = {
  oic_nw: { env: 'PRICE_OIC_NW_PHP', name: 'Hyperion Deck OIC-NW', track: 'DECK_OIC_NW' },
  gmdss: { env: 'PRICE_GMDSS_PHP', name: 'Hyperion GMDSS GOC', track: 'GMDSS_GOC' },
  engine_ew: { env: 'PRICE_ENGINE_EW_PHP', name: 'Hyperion Engine OIC-EW', track: 'ENGINE_OIC_EW' },
  deck_mgt: { env: 'PRICE_DECK_MGT_PHP', name: 'Hyperion Deck Management', track: 'DECK_MGT' },
  engine_mgt: { env: 'PRICE_ENGINE_MGT_PHP', name: 'Hyperion Engine Management', track: 'ENGINE_MGT' },
  all_access: { env: 'PRICE_ALL_ACCESS_PHP', name: 'Hyperion All-Access Bundle', track: 'ALL' },
} as const

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const supabaseUrl = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const paymongoKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  if (!paymongoKey) return json({ error: 'Checkout is not configured yet. Add the PayMongo secret key to Supabase function secrets.' }, 503)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Please sign in first.' }, 401)
  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authHeader } }, auth: { persistSession: false } })
  const { data: { user }, error: userError } = await authClient.auth.getUser()
  if (userError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { productCode?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const code = body.productCode as keyof typeof products
  const product = products[code]
  if (!product) return json({ error: 'Unknown product.' }, 400)
  const price = Number(Deno.env.get(product.env))
  if (!Number.isSafeInteger(price) || price <= 0) return json({ error: `Price for ${code} is not configured. Add ${product.env} in Supabase function secrets; value must be whole pesos.` }, 503)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })
  const trackIds: Record<string, string> = { oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW', deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT', all_access: 'ALL' }
  const { data: order, error: insertError } = await admin.from('orders').insert({ user_id: user.id, product_code: code, track_id: trackIds[code], amount_php: price }).select('id').single()
  if (insertError || !order) return json({ error: 'Could not create your order. Please try again.' }, 500)

  const origin = req.headers.get('origin') || Deno.env.get('APP_BASE_URL') || ''
  if (!origin.startsWith('https://') && !origin.startsWith('http://localhost')) return json({ error: 'APP_BASE_URL must be set to your HTTPS app URL.' }, 500)
  const payload = { data: { attributes: {
    line_items: [{ name: product.name, amount: price * 100, currency: 'PHP', quantity: 1 }],
    payment_method_types: ['gcash', 'maya', 'qrph', 'card'],
    success_url: `${origin}/account?payment=success`, cancel_url: `${origin}/account?payment=cancelled`,
    reference_number: order.id, send_email_receipt: true,
    metadata: { order_id: order.id, user_id: user.id, product_code: code },
  } } }
  const response = await fetch('https://api.paymongo.com/v2/checkout_sessions', { method: 'POST', headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}`, 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
  const result = await response.json().catch(() => ({}))
  const checkoutUrl = result?.data?.attributes?.checkout_url
  const sessionId = result?.data?.id
  if (!response.ok || !checkoutUrl || !sessionId) {
    await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
    return json({ error: 'PayMongo could not start checkout. Check your API key and enabled payment methods.' }, 502)
  }
  const { error: updateError } = await admin.from('orders').update({ paymongo_checkout_session_id: sessionId }).eq('id', order.id)
  if (updateError) return json({ error: 'Checkout started but order tracking failed. Contact support before retrying.' }, 500)
  return json({ checkoutUrl })
})
