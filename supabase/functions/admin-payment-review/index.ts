import { createClient } from 'npm:@supabase/supabase-js@2'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' }
Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  const url = Deno.env.get('SUPABASE_URL')!, anon = Deno.env.get('SUPABASE_ANON_KEY')!, service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const auth = req.headers.get('Authorization')
  if (!auth) return json({ error: 'Sign-in required.' }, 401)
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user?.email) return json({ error: 'Please sign in again.' }, 401)
  const allowed = (Deno.env.get('ADMIN_EMAILS') || '').split(',').map(x => x.trim().toLowerCase()).filter(Boolean)
  if (!allowed.includes(user.email.toLowerCase())) return json({ error: 'Admin access denied.' }, 403)
  let body: { action?: string; orderId?: string; decision?: string; adminNote?: string; instructions?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  if (body.action === 'check-admin') return json({ isAdmin: true })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  if (body.action === 'list') {
    const { data, error } = await admin.from('orders').select('id,user_id,product_code,track_id,amount_php,status,payment_reference,payment_method,proof_url,customer_note,customer_name,customer_company,customer_school,admin_note,created_at,reviewed_at,paid_at').in('status', ['submitted','pending','paid','failed']).order('created_at', { ascending: false }).limit(200)
    if (error) return json({ error: 'Could not load payment submissions.' }, 500)
    const ids = [...new Set((data || []).map(row => row.user_id))]
    const emails: Record<string,string> = {}
    for (const id of ids) { const { data: userData } = await admin.auth.admin.getUserById(id); if (userData.user?.email) emails[id] = userData.user.email }
    return json({ orders: (data || []).map(row => ({ ...row, email: emails[row.user_id] || '(email unavailable)' })) })
  }
  if (body.action === 'instructions') {
    const instructions = String(body.instructions || '').trim().slice(0, 5000)
    if (!instructions) return json({ error: 'Payment instructions cannot be empty.' }, 400)
    const { error } = await admin.from('payment_settings').upsert({ id: 1, instructions, updated_at: new Date().toISOString() })
    return error ? json({ error: 'Could not save payment instructions.' }, 500) : json({ ok: true })
  }
  if (body.action !== 'review' || !body.orderId || !['approve','reject'].includes(body.decision || '')) return json({ error: 'Invalid review action.' }, 400)
  const { data: order, error: lookupError } = await admin.from('orders').select('*').eq('id', body.orderId).maybeSingle()
  if (lookupError || !order) return json({ error: 'Order not found.' }, 404)
  if (order.status === 'paid') return json({ error: 'This payment is already approved.' }, 409)
  if (!['submitted','pending'].includes(order.status)) return json({ error: 'This order is not awaiting review.' }, 409)
  const adminNote = String(body.adminNote || '').trim().slice(0, 1000) || null
  if (body.decision === 'approve') {
    const now = new Date()
    const { data: currentEntitlement, error: currentError } = await admin.from('entitlements').select('order_id,status,expires_at').eq('user_id', order.user_id).eq('product_code', order.product_code).maybeSingle()
    if (currentError) return json({ error: 'Could not check the existing subscription.' }, 500)
    const currentExpiry = currentEntitlement?.status === 'active' && currentEntitlement.expires_at
      ? new Date(currentEntitlement.expires_at)
      : null
    const hasActiveLicense = currentEntitlement?.status === 'active' &&
      (!currentExpiry || currentExpiry.getTime() > now.getTime())
    if (hasActiveLicense && currentEntitlement?.order_id !== order.id) {
      return json({ error: 'This user already has an active license for this track. Reject this duplicate order instead.' }, 409)
    }
    const renewalBase = currentExpiry && currentExpiry.getTime() > now.getTime() ? currentExpiry : now
    const expiresAt = new Date(renewalBase)
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + 1)
    const { error: entitlementError } = await admin.from('entitlements').upsert({ user_id: order.user_id, product_code: order.product_code, track_id: order.track_id, order_id: order.id, status: 'active', granted_at: now.toISOString(), renewed_at: now.toISOString(), expires_at: expiresAt.toISOString() }, { onConflict: 'user_id,product_code' })
    if (entitlementError) return json({ error: 'Could not grant access. Review was not completed.' }, 500)
    const { error } = await admin.from('orders').update({ status: 'paid', admin_note: adminNote, reviewed_by: user.email, reviewed_at: new Date().toISOString(), paid_at: new Date().toISOString() }).eq('id', order.id).in('status', ['submitted','pending'])
    if (error) return json({ error: 'Access was granted but order status update failed. Please inspect this order.' }, 500)
  } else {
    const { error } = await admin.from('orders').update({ status: 'failed', admin_note: adminNote, reviewed_by: user.email, reviewed_at: new Date().toISOString() }).eq('id', order.id).in('status', ['submitted','pending'])
    if (error) return json({ error: 'Could not reject this submission.' }, 500)
  }
  return json({ ok: true })
})
