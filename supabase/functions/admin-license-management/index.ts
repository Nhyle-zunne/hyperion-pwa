import { createClient } from 'npm:@supabase/supabase-js@2'

type LicenseTerm = 'week' | 'month' | 'year'
const PRODUCTS = [
  { code: 'oic_nw', track: 'DECK_OIC_NW', name: 'Deck OIC-NW' },
  { code: 'gmdss', track: 'GMDSS_GOC', name: 'GMDSS GOC' },
  { code: 'engine_ew', track: 'ENGINE_OIC_EW', name: 'Engine OIC-EW' },
  { code: 'deck_mgt', track: 'DECK_MGT', name: 'Deck Management' },
  { code: 'engine_mgt', track: 'ENGINE_MGT', name: 'Engine Management' }
] as const
type ProductCode = typeof PRODUCTS[number]['code']
const PRODUCT_MAP = Object.fromEntries(PRODUCTS.map(item => [item.code, item])) as Record<ProductCode, typeof PRODUCTS[number]>
const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}
function cors(req: Request) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ['https://hyperionmaritime.org', 'https://www.hyperionmaritime.org', 'http://localhost:5173', 'http://127.0.0.1:5173']
  return { ...corsHeaders, 'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'https://hyperionmaritime.org' }
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' } })
}
function expiryForTerm(base: Date, term: LicenseTerm) {
  const result = new Date(base)
  if (term === 'week') {
    result.setUTCDate(result.getUTCDate() + 7)
    return result
  }
  if (term === 'month') {
    const day = result.getUTCDate()
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + 1)
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
    result.setUTCDate(Math.min(day, lastDay))
    return result
  }
  const month = result.getUTCMonth()
  const day = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCFullYear(result.getUTCFullYear() + 1)
  result.setUTCMonth(month)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), month + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(day, lastDay))
  return result
}
function effectiveStatus(row: any, now = Date.now()): 'active' | 'expired' | 'revoked' {
  if (row.status === 'revoked') return 'revoked'
  // Every paid license is a fixed term; missing or invalid expiry is not unlimited access.
  if (!row.expires_at) return 'expired'
  const expiry = Date.parse(row.expires_at)
  if (!Number.isFinite(expiry) || expiry <= now) return 'expired'
  return 'active'
}
function profileName(user: any): string | null {
  const metadata = user.user_metadata || {}
  const given = [metadata.given_name, metadata.family_name].filter((value: unknown) => typeof value === 'string' && value.trim()).join(' ')
  const name = [metadata.full_name, metadata.name, given].find((value: unknown) => typeof value === 'string' && value.trim())
  return typeof name === 'string' ? name.trim() : null
}
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json(req, { error: 'License management is not configured.' }, 503)

  const auth = req.headers.get('Authorization')
  if (!auth) return json(req, { error: 'Sign-in required.' }, 401)
  const client = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user?.email) return json(req, { error: 'Please sign in again.' }, 401)
  const allowed = (Deno.env.get('ADMIN_EMAILS') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean)
  if (!allowed.includes(user.email.toLowerCase())) return json(req, { error: 'Admin access denied.' }, 403)

  let body: { action?: string; userId?: string; productCode?: string; term?: string; note?: string }
  try { body = await req.json() } catch { return json(req, { error: 'Invalid request body.' }, 400) }
  const admin = createClient(url, service, { auth: { persistSession: false } })

  if (body.action === 'list') {
    const users: any[] = []
    for (let page = 1; page <= 50; page++) {
      const result = await admin.auth.admin.listUsers({ page, perPage: 1000 })
      if (result.error) return json(req, { error: 'Could not load registered users.' }, 500)
      const pageUsers = result.data.users || []
      users.push(...pageUsers)
      if (pageUsers.length < 1000) break
    }

    const entitlements: any[] = []
    for (let offset = 0; offset < 50000; offset += 1000) {
      const result = await admin.from('entitlements')
        .select('id,user_id,product_code,track_id,order_id,status,license_term,granted_at,expires_at,renewed_at')
        .order('granted_at', { ascending: false })
        .range(offset, offset + 999)
      if (result.error) return json(req, { error: 'Could not load current license statuses.' }, 500)
      const rows = result.data || []
      entitlements.push(...rows.map((row: any) => ({ ...row, source: 'website' })))
      if (rows.length < 1000) break
    }
    for (let offset = 0; ; offset += 1000) {
      const result = await admin.from('google_play_entitlements')
        .select('id,user_id,product_code,track_id,status,granted_at,expires_at,updated_at')
        .order('updated_at', { ascending: false })
        .range(offset, offset + 999)
      if (result.error) return json(req, { error: 'Could not load Google Play license statuses.' }, 500)
      const rows = result.data || []
      entitlements.push(...rows.map((row: any) => ({
        ...row,
        order_id: null,
        license_term: null,
        renewed_at: row.updated_at,
        source: 'google_play'
      })))
      if (rows.length < 1000) break
    }

    // Load last real website activity and payment/admin dependencies in bounded account batches.
    const activityByUser = new Map<string, string>()
    const pendingPaymentUsers = new Set<string>()
    const adminAuditUsers = new Set<string>()
    for (let start = 0; start < users.length; start += 1000) {
      const ids = users.slice(start, start + 1000).map(account => account.id)
      const [activityResult, pendingOrdersResult, failedCheckoutResult, pendingBatchesResult, adminAuditResult] = await Promise.all([
        admin.from('user_activity').select('user_id,last_accessed_at').in('user_id', ids),
        admin.from('orders').select('user_id').in('user_id', ids).in('status', ['pending', 'submitted']).limit(10000),
        admin.from('orders').select('user_id').in('user_id', ids).eq('status', 'failed').eq('payment_method', 'PayMongo Checkout').not('paymongo_checkout_session_id', 'is', null).limit(10000),
        admin.from('checkout_batches').select('user_id').in('user_id', ids).eq('status', 'pending').limit(10000),
        admin.from('license_admin_audit').select('admin_user_id').in('admin_user_id', ids).limit(10000)
      ])
      if (activityResult.error) return json(req, { error: 'Could not load last website activity.' }, 500)
      if (pendingOrdersResult.error || failedCheckoutResult.error || pendingBatchesResult.error) {
        return json(req, { error: 'Could not verify pending payment dependencies.' }, 500)
      }
      if (adminAuditResult.error) return json(req, { error: 'Could not verify admin audit dependencies.' }, 500)
      for (const row of activityResult.data || []) activityByUser.set(row.user_id, row.last_accessed_at)
      for (const row of pendingOrdersResult.data || []) pendingPaymentUsers.add(row.user_id)
      for (const row of failedCheckoutResult.data || []) pendingPaymentUsers.add(row.user_id)
      for (const row of pendingBatchesResult.data || []) pendingPaymentUsers.add(row.user_id)
      for (const row of adminAuditResult.data || []) adminAuditUsers.add(row.admin_user_id)
    }

    const retentionNow = Date.now()
    const dayMs = 24 * 60 * 60 * 1000
    const inactivityMs = 30 * dayMs
    const graceMs = 30 * dayMs
    const freeRetentionMs = inactivityMs + graceMs
    const allowedAdmins = new Set((Deno.env.get('ADMIN_EMAILS') || '').split(',').map(value => value.trim().toLowerCase()).filter(Boolean))

    const byUser = new Map<string, Map<string, any>>()
    for (const row of entitlements) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Map())
      const licenses = byUser.get(row.user_id)!
      const previous = licenses.get(row.product_code)
      if (!previous) {
        licenses.set(row.product_code, row)
        continue
      }
      const previousActive = effectiveStatus(previous, now) === 'active'
      const rowActive = effectiveStatus(row, now) === 'active'
      const allSources = new Set<string>([
        ...String(previous.source || 'website').split('+'),
        ...String(row.source || 'website').split('+')
      ])
      if ((rowActive && !previousActive) ||
          (rowActive === previousActive && Date.parse(row.expires_at || '') > Date.parse(previous.expires_at || ''))) {
        licenses.set(row.product_code, { ...row, source: Array.from(allSources).sort().join('+') })
      } else {
        licenses.set(row.product_code, { ...previous, source: Array.from(allSources).sort().join('+') })
      }
    }
    const now = Date.now()
    const shapedUsers = users.map(account => {
      const recordMap = byUser.get(account.id) || new Map()
      const licenses = Object.fromEntries(PRODUCTS.map(product => {
        const row = recordMap.get(product.code)
        if (!row) return [product.code, {
          product_code: product.code, track_id: product.track, exists: false, status: 'none',
          license_term: null, granted_at: null, expires_at: null, order_id: null
        }]
        return [product.code, {
          product_code: row.product_code, track_id: row.track_id, exists: true,
          status: effectiveStatus(row, now), license_term: row.license_term,
          granted_at: row.granted_at, expires_at: row.expires_at, order_id: row.order_id,
          source: row.source || 'website'
        }]
      }))

      const trackedAccess = activityByUser.get(account.id) || null
      const lastAccessedAt = trackedAccess || account.last_sign_in_at || account.created_at
      const lastAccessSource = trackedAccess ? 'website_activity' : account.last_sign_in_at ? 'last_sign_in_baseline' : 'created_at_baseline'
      const relevantLicenses = Array.from(recordMap.values())
      const hasActiveLicense = relevantLicenses.some(row => effectiveStatus(row, retentionNow) === 'active')
      const latestExpiredAt = relevantLicenses.reduce((latest, row) => {
        if (row.status !== 'active') return latest
        const expiry = Date.parse(row.expires_at || '')
        return Number.isFinite(expiry) && expiry > 0 && expiry <= retentionNow ? Math.max(latest, expiry) : latest
      }, 0)
      const isAdmin = allowedAdmins.has((account.email || '').toLowerCase())
        || account.app_metadata?.role === 'admin'
        || account.app_metadata?.is_admin === true
        || adminAuditUsers.has(account.id)
      let retentionStatus: string
      let retentionDueAt: string | null = null
      if (isAdmin) {
        retentionStatus = adminAuditUsers.has(account.id) && !allowedAdmins.has((account.email || '').toLowerCase()) ? 'admin_audit_hold' : 'admin_protected'
      } else if (hasActiveLicense) {
        retentionStatus = 'active_license_protected'
      } else if (pendingPaymentUsers.has(account.id)) {
        retentionStatus = 'pending_payment_hold'
      } else {
        const lastAccessTime = Date.parse(lastAccessedAt) || Date.parse(account.created_at) || retentionNow
        const inactivityEndsAt = lastAccessTime + inactivityMs
        const freeRetentionDueAt = lastAccessTime + freeRetentionMs
        const renewalGraceDueAt = latestExpiredAt > 0 ? latestExpiredAt + graceMs : 0
        const finalDueAt = Math.max(freeRetentionDueAt, renewalGraceDueAt)
        retentionDueAt = new Date(finalDueAt).toISOString()

        if (finalDueAt <= retentionNow) {
          retentionStatus = 'deletion_due'
        } else if (inactivityEndsAt > retentionNow) {
          retentionStatus = 'free_account_active'
        } else if (renewalGraceDueAt > retentionNow && renewalGraceDueAt >= freeRetentionDueAt) {
          retentionStatus = 'renewal_grace'
        } else {
          retentionStatus = 'free_account_grace'
        }
      }

      return {
        id: account.id,
        email: account.email || '',
        display_name: profileName(account),
        created_at: account.created_at,
        last_accessed_at: lastAccessedAt,
        last_access_source: lastAccessSource,
        retention_status: retentionStatus,
        retention_due_at: retentionDueAt,
        licenses
      }
    }).sort((a, b) => (a.email || '').localeCompare(b.email || ''))

    const auditResult = await admin.from('license_admin_audit')
      .select('id,user_id,product_code,track_id,action,prior_status,new_status,prior_expires_at,new_expires_at,license_term,admin_email,note,created_at')
      .order('created_at', { ascending: false }).limit(50)
    const emailById = new Map(users.map(account => [account.id, account.email || '']))
    const audit = auditResult.error ? [] : (auditResult.data || []).map(row => ({
      ...row, user_email: emailById.get(row.user_id) || '(account unavailable)'
    }))
    return json(req, {
      users: shapedUsers,
      audit,
      auditWarning: auditResult.error ? 'License activity could not be loaded.' : null,
      productCatalog: PRODUCTS
    })
  }

  if (!['grant', 'revoke'].includes(body.action || '')) return json(req, { error: 'Invalid license action.' }, 400)
  if (!body.userId || !uuidPattern.test(body.userId)) return json(req, { error: 'Choose a valid user.' }, 400)
  if (!body.productCode || !PRODUCTS.some(product => product.code === body.productCode)) return json(req, { error: 'Choose a valid track.' }, 400)
  const product = PRODUCT_MAP[body.productCode as ProductCode]
  const userResult = await admin.auth.admin.getUserById(body.userId)
  if (userResult.error || !userResult.data.user) return json(req, { error: 'Account not found.' }, 404)
  const { data: existing, error: existingError } = await admin.from('entitlements')
    .select('id,user_id,product_code,track_id,order_id,status,license_term,granted_at,expires_at,renewed_at')
    .eq('user_id', body.userId).eq('product_code', product.code).maybeSingle()
  if (existingError) return json(req, { error: 'Could not check the current license.' }, 500)
  const priorStatus = existing ? effectiveStatus(existing) : 'none'
  const priorExpiry = existing?.expires_at || null
  const note = String(body.note || '').trim().slice(0, 1000) || null
  const now = new Date()
  const nowIso = now.toISOString()

  if (body.action === 'revoke') {
    const { data: activePlay, error: playError } = await admin.from('google_play_entitlements')
      .select('id,expires_at').eq('user_id', body.userId).eq('product_code', product.code)
      .eq('status', 'active').gt('expires_at', nowIso).limit(1).maybeSingle()
    if (playError) return json(req, { error: 'Could not verify Google Play subscription state.' }, 500)
    if (activePlay) return json(req, { error: 'This track has an active Google Play subscription. Cancel or revoke it through Google Play first; access remains active while Google Play confirms the subscription is entitled.' }, 409)
    if (!existing) return json(req, { error: 'This user has no license record for the selected track.' }, 404)
    if (existing.status === 'revoked') return json(req, { ok: true, alreadyRevoked: true, status: 'revoked' })
    const { error: updateError } = await admin.from('entitlements').update({ status: 'revoked' }).eq('id', existing.id)
    if (updateError) return json(req, { error: 'Could not revoke this license.' }, 500)
    const { error: auditError } = await admin.from('license_admin_audit').insert({
      user_id: body.userId, product_code: product.code, track_id: product.track,
      action: 'revoke', prior_status: priorStatus, new_status: 'revoked',
      prior_expires_at: priorExpiry, new_expires_at: priorExpiry, license_term: existing.license_term,
      admin_user_id: user.id, admin_email: user.email, note
    })
    return json(req, { ok: true, status: 'revoked', warning: auditError ? 'Access was revoked, but the audit record could not be saved.' : null })
  }

  if (!['week', 'month', 'year'].includes(body.term || '')) return json(req, { error: 'Choose a valid license duration.' }, 400)
  const term = body.term as LicenseTerm
  const existingExpiry = existing?.expires_at ? new Date(existing.expires_at) : null
  const canExtend = existing?.status === 'active' && existingExpiry !== null && existingExpiry.getTime() > now.getTime()
  const base = canExtend ? existingExpiry! : now
  const expiresAt = expiryForTerm(base, term)
  const action = canExtend ? 'extend' : 'grant'
  const { error: grantError } = await admin.from('entitlements').upsert({
    user_id: body.userId,
    product_code: product.code,
    track_id: product.track,
    order_id: existing?.order_id || null,
    license_term: term,
    status: 'active',
    granted_at: existing?.granted_at || nowIso,
    renewed_at: nowIso,
    expires_at: expiresAt.toISOString()
  }, { onConflict: 'user_id,product_code' })
  if (grantError) return json(req, { error: 'Could not activate or extend this license.' }, 500)

  const { error: auditError } = await admin.from('license_admin_audit').insert({
    user_id: body.userId, product_code: product.code, track_id: product.track,
    action, prior_status: priorStatus, new_status: 'active',
    prior_expires_at: priorExpiry, new_expires_at: expiresAt.toISOString(), license_term: term,
    admin_user_id: user.id, admin_email: user.email, note
  })
  return json(req, {
    ok: true, status: 'active', action, expiresAt: expiresAt.toISOString(),
    warning: auditError ? 'Access was updated, but the audit record could not be saved.' : null
  })
})
