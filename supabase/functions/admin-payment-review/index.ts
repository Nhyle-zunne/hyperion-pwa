import { createClient } from 'npm:@supabase/supabase-js@2'

type LicenseTerm = 'week' | 'month' | 'year'
function expiryForTerm(base: Date, term: LicenseTerm) {
  const result = new Date(base)
  if (term === 'week') { result.setUTCDate(result.getUTCDate() + 7); return result }
  if (term === 'month') {
    const day = result.getUTCDate()
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + 1)
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
    result.setUTCDate(Math.min(day, lastDay))
    return result
  }
  const month = result.getUTCMonth(), day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCFullYear(result.getUTCFullYear() + 1)
  result.setUTCMonth(month)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), month + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', 'Access-Control-Max-Age': '86400' }
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
    const { data, error } = await admin.from('orders').select('id,user_id,product_code,track_id,license_term,amount_php,status,payment_reference,payment_method,proof_url,customer_note,customer_name,customer_company,customer_school,admin_note,created_at,reviewed_at,paid_at').in('status', ['submitted','pending','paid','failed']).order('created_at', { ascending: false }).limit(200)
    if (error) return json({ error: 'Could not load payment submissions.' }, 500)
    const ids = [...new Set((data || []).map(row => row.user_id))]
    const emails: Record<string,string> = {}
    for (const id of ids) { const { data: userData } = await admin.auth.admin.getUserById(id); if (userData.user?.email) emails[id] = userData.user.email }
    const paidOrderIds = (data || []).filter(row => row.status === 'paid').map(row => row.id)
    const { data: accessRows, error: accessError } = paidOrderIds.length
      ? await admin.from('entitlements').select('order_id,status,expires_at,granted_at').in('order_id', paidOrderIds)
      : { data: [], error: null }
    if (accessError) return json({ error: 'Could not load license access status.' }, 500)
    const accessByOrder: Record<string, { status: string; expires_at: string | null }> = {}
    for (const access of accessRows || []) {
      const effectiveStatus = access.status === 'revoked' ? 'revoked'
        : access.expires_at && new Date(access.expires_at).getTime() <= Date.now() ? 'expired' : 'active'
      accessByOrder[access.order_id] = { status: effectiveStatus, expires_at: access.expires_at }
    }
    return json({ orders: (data || []).map(row => ({
      ...row,
      email: emails[row.user_id] || '(email unavailable)',
      access_status: row.status !== 'paid' ? 'none' : accessByOrder[row.id]?.status || 'not_current',
      access_expires_at: accessByOrder[row.id]?.expires_at || null
    })) })
  }
  if (body.action === 'reconciliation-alerts') {
    const { data, error } = await admin.from('paymongo_reconciliation_alerts')
      .select('id,checkout_reference,checkout_session_id,paymongo_payment_id,expected_amount_php,observed_amount_minor,observed_currency,reason,created_at')
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) return json({ error: 'Could not load PayMongo reconciliation alerts.' }, 500)
    return json({ alerts: data || [] })
  }

  if (body.action === 'instructions') {
    const instructions = String(body.instructions || '').trim().slice(0, 5000)
    if (!instructions) return json({ error: 'Payment instructions cannot be empty.' }, 400)
    const { error } = await admin.from('payment_settings').upsert({ id: 1, instructions, updated_at: new Date().toISOString() })
    return error ? json({ error: 'Could not save payment instructions.' }, 500) : json({ ok: true })
  }
  if (body.action !== 'review' || typeof body.orderId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId) ||
      !['approve','reject'].includes(body.decision || '')) {
    return json({ error: 'Invalid review action.' }, 400)
  }

  const adminNote = String(body.adminNote || '').trim().slice(0, 1000) || null
  const { data: reviewed, error: reviewError } = await admin.rpc('review_manual_payment', {
    p_order_id: body.orderId,
    p_decision: body.decision,
    p_admin_email: user.email,
    p_admin_note: adminNote
  })

  if (reviewError || !reviewed) {
    const code = reviewError?.code
    if (code === 'P0002') return json({ error: 'Order not found.' }, 404)
    if (code === '23514' || code === '40001') {
      const detail = reviewError?.message || ''
      if (detail.includes('already has an active license')) {
        return json({ error: 'This user already has an active license for this track. Reject this duplicate order instead.' }, 409)
      }
      if (detail.includes('PayMongo checkout orders')) {
        return json({ error: 'PayMongo checkout orders can only be approved by verified PayMongo processing.' }, 409)
      }
      if (detail.includes('not awaiting review')) return json({ error: 'This order is not awaiting review. Refresh the list.' }, 409)
      return json({ error: 'This order changed while being reviewed. Refresh the list and try again.' }, 409)
    }
    console.error('[admin-payment-review] Manual review transaction failed', JSON.stringify({ orderId: body.orderId, code: code || 'unknown' }))
    return json({ error: 'Could not finalize the manual payment review. Please refresh and retry.' }, 500)
  }

  return json(reviewed)
})
