import { createClient } from 'npm:@supabase/supabase-js@2'

const products = {
  oic_nw: { track: 'DECK_OIC_NW' },
  gmdss: { track: 'GMDSS_GOC' },
  engine_ew: { track: 'ENGINE_OIC_EW' },
  deck_mgt: { track: 'DECK_MGT' },
  engine_mgt: { track: 'ENGINE_MGT' },
} as const
type LicenseTerm = 'week' | 'month' | 'year'
const prices: Record<keyof typeof products, Record<LicenseTerm, number>> = {
  oic_nw: { week: 20, month: 50, year: 350 },
  gmdss: { week: 15, month: 40, year: 250 },
  engine_ew: { week: 20, month: 50, year: 350 },
  deck_mgt: { week: 40, month: 100, year: 700 },
  engine_mgt: { week: 40, month: 100, year: 700 },
}
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
  let body: { productCode?: string; licenseTerm?: string; paymentMethod?: string; paymentReference?: string; proofUrl?: string; customerNote?: string; customerProfile?: { fullName?: string; company?: string; school?: string } }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  const code = body.productCode as keyof typeof products, product = products[code]
  if (!product) return json({ error: 'Unknown product.' }, 400)
  const requestedTerm = body.licenseTerm ?? 'year'
  if (requestedTerm !== 'week' && requestedTerm !== 'month' && requestedTerm !== 'year') return json({ error: 'Choose a valid access duration.' }, 400)
  const term: LicenseTerm = requestedTerm
  const paymentMethod = String(body.paymentMethod || '').trim().slice(0, 80)
  // This endpoint is only for manual QR transfer submissions. Never accept
  // PayMongo's internal method marker from a client-provided request.
  if (paymentMethod !== 'QR Ph (MariBank / InstaPay)') {
    return json({ error: 'Choose a supported manual payment method.' }, 400)
  }
  const paymentReference = String(body.paymentReference || '').trim().slice(0, 160)
  const proofUrl = String(body.proofUrl || '').trim().slice(0, 1000)
  const customerNote = String(body.customerNote || '').trim().slice(0, 1000)
  if (!paymentMethod || !paymentReference) return json({ error: 'Payment method and transaction/reference number are required.' }, 400)
  if (proofUrl && !/^https:\/\//i.test(proofUrl)) return json({ error: 'Proof link must start with https://.' }, 400)

  const metadataName = [user.user_metadata?.given_name, user.user_metadata?.family_name]
    .filter((value): value is string => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
  const customerName = String(body.customerProfile?.fullName || user.user_metadata?.full_name || user.user_metadata?.name || metadataName || '').trim().slice(0, 160)
  const customerCompany = String(body.customerProfile?.company || '').trim().slice(0, 160)
  const customerSchool = String(body.customerProfile?.school || '').trim().slice(0, 160)
  if (!customerName) return json({ error: 'Please add your full name to your account before submitting payment details.' }, 400)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: activeLicense, error: licenseError } = await admin.from('entitlements')
    .select('id,expires_at').eq('user_id', user.id).eq('product_code', code).eq('status', 'active').maybeSingle()
  if (licenseError) return json({ error: 'Could not check your existing license. Please try again.' }, 500)
  const licenseExpiry = activeLicense?.expires_at ? new Date(activeLicense.expires_at).getTime() : null
  if (activeLicense && (licenseExpiry === null || licenseExpiry > Date.now())) {
    return json({ error: 'This license is already active for your account. You do not need to purchase this track again.' }, 409)
  }

  const { data: existing, error: existingError } = await admin.from('orders')
    .select('id,status,payment_method').eq('user_id', user.id).eq('product_code', code).in('status', ['submitted', 'pending']).limit(20)
  if (existingError) return json({ error: 'Could not check existing payment submissions. Please try again.' }, 500)
  if (existing?.some(order => order.payment_method === 'PayMongo Checkout')) {
    return json({ error: 'You already have a PayMongo checkout pending for this track. Resume that checkout, or wait until it expires before submitting a manual payment to avoid being charged twice.' }, 409)
  }
  if (existing?.some(order => order.payment_method !== 'PayMongo Checkout')) {
    return json({ error: 'You already submitted this reviewer track for manual review. Check Payment submissions below, or cancel the pending review before submitting again.' }, 409)
  }

  const amount = prices[code][term]
  const { data: order, error } = await admin.from('orders').insert({ user_id: user.id, product_code: code, track_id: product.track, license_term: term, amount_php: amount, status: 'submitted', payment_method: paymentMethod, payment_reference: paymentReference, proof_url: proofUrl || null, customer_note: customerNote || null, customer_name: customerName, customer_company: customerCompany || null, customer_school: customerSchool || null }).select('id,amount_php,status,license_term').single()
  if (error || !order) return json({ error: 'Could not submit payment for review. Please try again.' }, 500)
  return json({ order })
})
