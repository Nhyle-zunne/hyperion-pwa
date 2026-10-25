import { createClient } from 'npm:@supabase/supabase-js@2'

const products = {
  oic_nw: { env: 'PRICE_OIC_NW_PHP', track: 'DECK_OIC_NW' },
  gmdss: { env: 'PRICE_GMDSS_PHP', track: 'GMDSS_GOC' },
  engine_ew: { env: 'PRICE_ENGINE_EW_PHP', track: 'ENGINE_OIC_EW' },
  deck_mgt: { env: 'PRICE_DECK_MGT_PHP', track: 'DECK_MGT' },
  engine_mgt: { env: 'PRICE_ENGINE_MGT_PHP', track: 'ENGINE_MGT' },
  all_access: { env: 'PRICE_ALL_ACCESS_PHP', track: 'ALL' },
} as const
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Please sign in first.' }, 401)
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return json({ error: 'Please sign in again.' }, 401)
  let body: { productCode?: string; paymentMethod?: string; paymentReference?: string; proofUrl?: string; customerNote?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const code = body.productCode as keyof typeof products, product = products[code]
  if (!product) return json({ error: 'Unknown product.' }, 400)
  const paymentMethod = String(body.paymentMethod || '').trim().slice(0, 80)
  const paymentReference = String(body.paymentReference || '').trim().slice(0, 160)
  const proofUrl = String(body.proofUrl || '').trim().slice(0, 1000)
  const customerNote = String(body.customerNote || '').trim().slice(0, 1000)
  if (!paymentMethod || !paymentReference) return json({ error: 'Payment method and transaction/reference number are required.' }, 400)
  if (proofUrl && !/^https:\/\//i.test(proofUrl)) return json({ error: 'Proof link must start with https://.' }, 400)
  const amount = Number(Deno.env.get(product.env))
  if (!Number.isSafeInteger(amount) || amount <= 0) return json({ error: 'This product is not available yet because its price is not configured.' }, 503)
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: order, error } = await admin.from('orders').insert({ user_id: user.id, product_code: code, track_id: product.track, amount_php: amount, status: 'submitted', payment_method: paymentMethod, payment_reference: paymentReference, proof_url: proofUrl || null, customer_note: customerNote || null }).select('id,amount_php,status').single()
  if (error || !order) return json({ error: 'Could not submit payment for review. Please try again.' }, 500)
  return json({ order })
})
