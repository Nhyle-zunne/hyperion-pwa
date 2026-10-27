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
      entitlements.push(...rows)
      if (rows.length < 1000) break
    }

    const byUser = new Map<string, Map<string, any>>()
    for (const row of entitlements) {
      if (!byUser.has(row.user_id)) byUser.set(row.user_id, new Map())
      const licenses = byUser.get(row.user_id)!
      const previous = licenses.get(row.product_code)
      if (!previous || new Date(row.granted_at).getTime() > new Date(previous.granted_at).getTime()) licenses.set(row.product_code, row)
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
          granted_at: row.granted_at, expires_at: row.expires_at, order_id: row.order_id
        }]
      }))
      return {
        id: account.id,
        email: account.email || '',
        display_name: profileName(account),
        created_at: account.created_at,
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
