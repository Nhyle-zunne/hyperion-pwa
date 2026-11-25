import { createClient } from 'npm:@supabase/supabase-js@2'

type LicenseTerm = 'week' | 'month' | 'year'
function profileName(user: any): string | null {
  const metadata = user?.user_metadata || {}
  const given = [metadata.given_name, metadata.family_name]
    .filter((value: unknown) => typeof value === 'string' && value.trim()).join(' ')
  const googleNames = (user?.identities || [])
    .filter((identity: any) => identity.provider === 'google')
    .flatMap((identity: any) => [identity.identity_data?.full_name, identity.identity_data?.name])
  const name = [metadata.full_name, metadata.name, given, ...googleNames]
    .find((value: unknown) => typeof value === 'string' && value.trim())
  return typeof name === 'string' ? name.trim() : null
}
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
  let body: { action?: string; orderId?: string; claimId?: string; decision?: string; adminNote?: string; instructions?: string; enabled?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  if (body.action === 'check-admin') return json({ isAdmin: true })
  const admin = createClient(url, service, { auth: { persistSession: false } })
  if (body.action === 'list') {
    // Expire only abandoned intent; receipt-received claims never auto-expire.
    const { error: expiryError } = await admin.from('manual_checkout_claims')
      .update({ status: 'expired', updated_at: new Date().toISOString() })
      .eq('status', 'awaiting_proof')
      .lte('expires_at', new Date().toISOString())
    if (expiryError) return json({ error: 'Could not refresh manual payment statuses.' }, 500)
    // Open claims are never hidden behind a mixed-status "last 200" limit.
    const claimColumns = 'id,user_id,items,total_amount_php,status,created_at,expires_at,proof_received_at,reviewed_at,reviewed_by,admin_note'
    const openClaims = [] as Record<string, unknown>[]
    const pageSize = 200
    for (let offset = 0; offset < 10000; offset += pageSize) {
      const page = await admin.from('manual_checkout_claims').select(claimColumns)
        .in('status', ['awaiting_proof','pending_verification'])
        .order('created_at', { ascending: false })
        .range(offset, offset + pageSize - 1)
      if (page.error) return json({ error: 'Could not load open Messenger claims.' }, 500)
      openClaims.push(...(page.data || []))
      if ((page.data || []).length < pageSize) break
      if (offset + pageSize >= 10000) return json({ error: 'Too many open claims to show safely. Contact an administrator to page the backlog.' }, 503)
    }
    const [ordersResult, alertsResult, recentClaimsResult] = await Promise.all([
      admin.from('orders')
        .select('id,user_id,product_code,track_id,license_term,amount_php,status,manual_claim_id,payment_reference,payment_method,proof_url,customer_note,customer_name,customer_company,customer_school,admin_note,created_at,reviewed_at,paid_at')
        .in('status', ['submitted','pending','paid','failed'])
        .order('created_at', { ascending: false })
        .limit(200),
      admin.from('paymongo_reconciliation_alerts')
        .select('id,checkout_reference,checkout_session_id,paymongo_payment_id,expected_amount_php,observed_amount_minor,observed_currency,reason,created_at')
        .order('created_at', { ascending: false })
        .limit(100),
      admin.from('manual_checkout_claims')
        .select(claimColumns)
        .in('status', ['approved','rejected','expired'])
        .order('created_at', { ascending: false })
        .limit(100)
    ]);
    if (ordersResult.error) return json({ error: 'Could not load payment submissions.' }, 500);
    if (alertsResult.error) return json({ error: 'Could not load PayMongo reconciliation alerts.' }, 500);
    if (recentClaimsResult.error) return json({ error: 'Could not load reviewed manual claims.' }, 500);

    const rows = ordersResult.data || [];
    const claimRows = [...openClaims, ...(recentClaimsResult.data || [])] as { id: string; user_id: string; [key: string]: unknown }[]
    const ids = [...new Set([...rows.map(row => row.user_id), ...claimRows.map(row => row.user_id)])];
    const emails: Record<string,string> = {};
    const customerNames: Record<string,string> = {};
    // One paginated Auth request replaces one getUserById request per order owner.
    // The current dashboard is capped at 200 orders; stop as soon as every distinct
    // owner is found, and retain pagination for accounts beyond the first 1,000.
    let page = 1;
    while (Object.keys(emails).length < ids.length && page <= 10) {
      const { data: usersPage, error: usersError } = await admin.auth.admin.listUsers({
        page,
        perPage: 1000
      });
      if (usersError) return json({ error: 'Could not load payment customer emails.' }, 500);
      const users = usersPage?.users || [];
      for (const customer of users) {
        if (!ids.includes(customer.id)) continue;
        if (customer.email) emails[customer.id] = customer.email;
        const name = profileName(customer);
        if (name) customerNames[customer.id] = name;
      }
      if (users.length < 1000) break;
      page += 1;
    }

    const paidOrderIds = rows.filter(row => row.status === 'paid').map(row => row.id);
    const { data: accessRows, error: accessError } = paidOrderIds.length
      ? await admin.from('entitlements').select('order_id,status,expires_at,granted_at').in('order_id', paidOrderIds)
      : { data: [], error: null };
    if (accessError) return json({ error: 'Could not load license access status.' }, 500);
    const accessByOrder: Record<string, { status: string; expires_at: string | null }> = {};
    for (const access of accessRows || []) {
      const effectiveStatus = access.status === 'revoked' ? 'revoked'
        : access.expires_at && new Date(access.expires_at).getTime() <= Date.now() ? 'expired' : 'active';
      accessByOrder[access.order_id] = { status: effectiveStatus, expires_at: access.expires_at };
    }
    return json({
      orders: rows.map(row => ({
        ...row,
        email: emails[row.user_id] || '(email unavailable)',
        customer_name: row.customer_name || customerNames[row.user_id] || null,
        access_status: row.status !== 'paid' ? 'none' : accessByOrder[row.id]?.status || 'not_current',
        access_expires_at: accessByOrder[row.id]?.expires_at || null
      })),
      claims: claimRows.map(claim => ({
        ...claim, email: emails[claim.user_id] || '(email unavailable)',
        customer_name: customerNames[claim.user_id] || null
      })),
      alerts: alertsResult.data || []
    });
  }
  if (body.action === 'review-claim') {
    if (typeof body.claimId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.claimId) ||
        !['proof_received','approve','reject'].includes(body.decision || '')) {
      return json({ error: 'Invalid claim review action.' }, 400)
    }
    const reviewParams = {
      p_claim_id: body.claimId,
      p_admin_email: user.email,
      p_admin_note: String(body.adminNote || '').trim().slice(0, 1000) || null,
    }
    if (body.decision === 'approve') {
      // One admin approval click covers both internal steps. Do not let the
      // browser bypass the existing database verification and license checks.
      const { data: claim, error: lookupError } = await admin.from('manual_checkout_claims')
        .select('status').eq('id', body.claimId).maybeSingle()
      if (lookupError) return json({ error: 'Could not load this submission. Please retry.' }, 500)
      if (!claim) return json({ error: 'Submission not found.' }, 404)
      if (claim.status === 'awaiting_proof') {
        const { data: receipt, error: receiptError } = await admin.rpc('review_manual_checkout_claim', {
          ...reviewParams, p_action: 'proof_received',
        })
        if (receipt?.status === 'expired') return json({ error: 'This claim expired. Ask the customer to submit a new claim.' }, 409)
        if (receiptError || !receipt || receipt.ok !== true) return json({ error: 'Could not prepare this approval. Refresh and retry.' }, 409)
      }
    }
    const { data, error } = await admin.rpc('review_manual_checkout_claim', {
      ...reviewParams, p_action: body.decision,
    })
    if (error || !data || data.ok !== true) {
      if (data?.status === 'expired') return json({ error: 'This claim expired before proof was recorded. Ask the customer to submit a new claim.' }, 409)
      if (error?.code === 'P0002') return json({ error: 'Submission not found.' }, 404)
      if (error?.code === '23514') return json({ error: 'Submission is no longer eligible for this action. Confirm the actual transfer and refresh the list.' }, 409)
      console.error('[admin-payment-review] Claim review failed', error?.code || 'unknown')
      return json({ error: 'Could not review this submission. Please retry.' }, 500)
    }
    return json(data)
  }
  if (body.action === 'find-claim') {
    if (typeof body.claimId !== 'string' ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.claimId)) {
      return json({ error: 'Enter a complete submission ID.' }, 400)
    }
    const { data: claim, error } = await admin.from('manual_checkout_claims')
      .select('id,user_id,items,total_amount_php,status,created_at,expires_at,proof_received_at,reviewed_at,reviewed_by,admin_note')
      .eq('id',body.claimId).maybeSingle()
    if (error) return json({ error: 'Could not find that submission.' }, 500)
    if (!claim) return json({ error: 'No submission matches that ID.' }, 404)
    const { data: owner, error: ownerError } = await admin.auth.admin.getUserById(claim.user_id)
    if (ownerError) return json({ error: 'Could not resolve the submission account.' }, 500)
    return json({ claim: { ...claim,email:owner?.user?.email || '(email unavailable)',customer_name:profileName(owner?.user) } })
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
  if (body.action === 'set-checkout-availability') {
    if (typeof body.enabled !== 'boolean') return json({ error: 'Expected a checkout enabled or disabled setting.' }, 400)
    const { data, error } = await admin.from('payment_settings')
      .update({ website_checkout_enabled: body.enabled, updated_at: new Date().toISOString() })
      .eq('id', 1)
      .select('website_checkout_enabled,updated_at')
      .single()
    if (error || !data) return json({ error: 'Could not update checkout availability.' }, 500)
    return json({ enabled: data.website_checkout_enabled, updatedAt: data.updated_at })
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
