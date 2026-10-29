import { createClient } from 'npm:@supabase/supabase-js@2'

const CORS = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}
const PACKAGE_NAME = 'com.nhyle.hyperionmaritime'
const TRACKS = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
} as const
const PRODUCT_TO_TRACKS: Record<string, Array<{ productCode: keyof typeof TRACKS; trackId: string }>> = {
  hyperion_oic_nw_pass: [{ productCode: 'oic_nw', trackId: TRACKS.oic_nw }],
  hyperion_gmdss_pass: [{ productCode: 'gmdss', trackId: TRACKS.gmdss }],
  hyperion_engine_oic_ew_pass: [{ productCode: 'engine_ew', trackId: TRACKS.engine_ew }],
  hyperion_deck_mgt_pass: [{ productCode: 'deck_mgt', trackId: TRACKS.deck_mgt }],
  hyperion_engine_mgt_pass: [{ productCode: 'engine_mgt', trackId: TRACKS.engine_mgt }],
  hyperion_all_access_pass: [
    { productCode: 'oic_nw', trackId: TRACKS.oic_nw },
    { productCode: 'gmdss', trackId: TRACKS.gmdss },
    { productCode: 'engine_ew', trackId: TRACKS.engine_ew },
    { productCode: 'deck_mgt', trackId: TRACKS.deck_mgt },
    { productCode: 'engine_mgt', trackId: TRACKS.engine_mgt }
  ]
}
const allowedStates = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED'
])
let cachedGoogleAccessToken: { token: string; expiresAt: number } | null = null

function json(req: Request, body: unknown, status = 200) {
  const origin = req.headers.get('Origin') || ''
  const allowed = ['https://hyperionmaritime.org', 'https://www.hyperionmaritime.org', 'http://localhost:5173', 'http://127.0.0.1:5173']
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...CORS,
      'Access-Control-Allow-Origin': allowed.includes(origin) ? origin : 'https://hyperionmaritime.org',
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, private'
    }
  })
}
function base64Url(bytes: Uint8Array) {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
function encodeText(value: string) {
  return base64Url(new TextEncoder().encode(value))
}
function pemBytes(pem: string) {
  const body = pem.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  const binary = atob(body)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i)
  return out
}
async function googleAccessToken() {
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedGoogleAccessToken.token
  }
  const secret = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
  if (!secret) throw new Error('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON is not configured.')
  let account: { client_email?: string; private_key?: string; token_uri?: string }
  try { account = JSON.parse(secret) } catch { throw new Error('Google Play service-account JSON is invalid.') }
  if (!account.client_email || !account.private_key) throw new Error('Google Play service-account JSON is missing required fields.')
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const header = encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const claims = encodeText(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  }))
  const unsigned = header + '.' + claims
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const assertion = unsigned + '.' + base64Url(new Uint8Array(signature))
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new Error('Google Play API authentication failed. Check service-account access and credentials.')
  }
  cachedGoogleAccessToken = { token: body.access_token, expiresAt: Date.now() + Math.min(Number(body.expires_in || 3600), 3500) * 1000 }
  return cachedGoogleAccessToken.token
}
async function sha256Hex(value: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(digest), b => b.toString(16).padStart(2, '0')).join('')
}
async function readGoogleSubscription(token: string) {
  const accessToken = await googleAccessToken()
  const endpoint = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(PACKAGE_NAME) + '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(token)
  const response = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + accessToken } })
  const payload = await response.json().catch(() => ({}))
  if (!response.ok) {
    if (response.status === 404 || response.status === 400) throw new Error('Google Play could not verify this purchase token.')
    if (response.status === 401 || response.status === 403) throw new Error('Google Play API access is not authorized. Check Play Console API access and service-account permissions.')
    throw new Error('Google Play subscription verification is temporarily unavailable.')
  }
  return payload as {
    subscriptionState?: string
    linkedPurchaseToken?: string
    lineItems?: Array<{ productId?: string; expiryTime?: string }>
  }
}
async function upsertPlayEntitlement(admin: any, linkId: string, userId: string, productCode: string, trackId: string, status: 'active' | 'revoked', expiresAt: string) {
  const { error } = await admin.from('google_play_entitlements').upsert({
    user_id: userId,
    purchase_link_id: linkId,
    product_code: productCode,
    track_id: trackId,
    status,
    granted_at: new Date().toISOString(),
    expires_at: expiresAt,
    updated_at: new Date().toISOString()
  }, { onConflict: 'purchase_link_id,track_id' })
  if (error) throw new Error('Could not save the verified Google Play entitlement.')
}
Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return json(req, { ok: true })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json(req, { error: 'License sync is not configured.' }, 503)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json(req, { error: 'Please sign in first.' }, 401)
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json(req, { error: 'Your Hyperion session is invalid. Please sign in again.' }, 401)

  let body: { purchaseToken?: unknown }
  try { body = await req.json() } catch { return json(req, { error: 'Invalid request body.' }, 400) }
  const token = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : ''
  if (!token || token.length > 4096 || token.startsWith('mock_sandbox_sub_token_')) {
    return json(req, { error: 'This Google Play purchase cannot be linked.' }, 400)
  }

  try {
    const google = await readGoogleSubscription(token)
    const now = Date.now()
    const lineItems = Array.isArray(google.lineItems) ? google.lineItems : []
    const recognizedItems = lineItems.flatMap(item => {
      const productId = typeof item.productId === 'string' ? item.productId : ''
      const mapped = PRODUCT_TO_TRACKS[productId]
      const expiry = typeof item.expiryTime === 'string' ? Date.parse(item.expiryTime) : NaN
      if (!mapped || !Number.isFinite(expiry)) return []
      return [{ productId, tracks: mapped, expiry }]
    })
    if (!recognizedItems.length) return json(req, { error: 'This purchase is not a Hyperion subscription.' }, 409)

    const maxExpiry = Math.max(...recognizedItems.map(item => item.expiry))
    const isEntitledNow = allowedStates.has(google.subscriptionState || '') && maxExpiry > now
    const entitlementExpiry = new Date(maxExpiry).toISOString()
    const tokenHash = await sha256Hex(token)
    const admin = createClient(url, service, { auth: { persistSession: false } })

    const { data: existing, error: lookupError } = await admin.from('google_play_purchase_links')
      .select('id,user_id')
      .eq('purchase_token_sha256', tokenHash)
      .maybeSingle()
    if (lookupError) return json(req, { error: 'Could not check whether this purchase is already linked.' }, 500)
    if (existing && existing.user_id !== user.id) {
      return json(req, { error: 'This Google Play subscription is already linked to another Hyperion account. Contact support if you believe this is incorrect.' }, 409)
    }

    // Validate the verified replacement relationship before writing anything. A token
    // replacement must never let one Hyperion account revoke another account's grant.
    let priorPurchaseLink: { id: string; user_id: string } | null = null
    if (google.linkedPurchaseToken) {
      const priorHash = await sha256Hex(google.linkedPurchaseToken)
      const { data: prior, error: priorLookupError } = await admin.from('google_play_purchase_links')
        .select('id,user_id')
        .eq('purchase_token_sha256', priorHash)
        .maybeSingle()
      if (priorLookupError) return json(req, { error: 'Could not validate the previous subscription link.' }, 500)
      if (prior && prior.user_id !== user.id) {
        return json(req, { error: 'This replacement subscription is associated with a different Hyperion account. Contact support to resolve the account link.' }, 409)
      }
      priorPurchaseLink = prior
    }

    let linkId: string
    const nowIso = new Date(now).toISOString()
    const linkRecord = {
      user_id: user.id,
      purchase_token: token,
      purchase_token_sha256: tokenHash,
      product_ids: Array.from(new Set(recognizedItems.map(item => item.productId))),
      subscription_state: google.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED',
      status: isEntitledNow ? 'active' : 'inactive',
      expires_at: entitlementExpiry,
      last_verified_at: nowIso,
      updated_at: nowIso
    }
    if (existing) {
      const { error } = await admin.from('google_play_purchase_links').update(linkRecord).eq('id', existing.id).eq('user_id', user.id)
      if (error) return json(req, { error: 'Could not update the verified subscription link.' }, 500)
      linkId = existing.id
    } else {
      const { data: inserted, error } = await admin.from('google_play_purchase_links').insert(linkRecord).select('id').single()
      if (error) {
        // In a concurrent cross-account link attempt, only the first account may claim the unique token.
        const { data: raced } = await admin.from('google_play_purchase_links').select('id,user_id').eq('purchase_token_sha256', tokenHash).maybeSingle()
        if (!raced || raced.user_id !== user.id) {
          return json(req, { error: 'This Google Play subscription could not be linked to this account.' }, 409)
        }
        const { error: updateError } = await admin.from('google_play_purchase_links').update(linkRecord).eq('id', raced.id).eq('user_id', user.id)
        if (updateError) return json(req, { error: 'Could not update the verified subscription link.' }, 500)
        linkId = raced.id
      } else {
        linkId = inserted.id
      }
    }

    // Replacements must not leave the previous token's entitlement active.
    // Ownership was checked above before this request wrote any records.
    if (priorPurchaseLink?.id && priorPurchaseLink.id !== linkId) {
      const { error: priorUpdateError } = await admin.from('google_play_purchase_links').update({
        status: 'inactive',
        updated_at: nowIso,
        last_verified_at: nowIso
      }).eq('id', priorPurchaseLink.id).eq('user_id', user.id)
      if (priorUpdateError) return json(req, { error: 'Could not retire the previous subscription token.' }, 500)
      const { error: priorEntitlementError } = await admin.from('google_play_entitlements')
        .update({ status: 'revoked', updated_at: nowIso })
        .eq('purchase_link_id', priorPurchaseLink.id).eq('user_id', user.id)
      if (priorEntitlementError) return json(req, { error: 'Could not retire the previous subscription entitlements.' }, 500)
    }

    for (const item of recognizedItems) {
      for (const track of item.tracks) {
        await upsertPlayEntitlement(
          admin,
          linkId,
          user.id,
          track.productCode,
          track.trackId,
          isEntitledNow && item.expiry > now ? 'active' : 'revoked',
          new Date(item.expiry).toISOString()
        )
      }
    }

    // If Google reports a different product set for this same token, retire stale
    // track grants rather than leaving a previous product's access active.
    const currentTrackIds = new Set(recognizedItems.flatMap(item => item.tracks.map(track => track.trackId)))
    const { data: existingEntitlements, error: existingEntitlementsError } = await admin.from('google_play_entitlements')
      .select('track_id')
      .eq('purchase_link_id', linkId)
      .eq('user_id', user.id)
    if (existingEntitlementsError) return json(req, { error: 'Could not reconcile the subscription tracks.' }, 500)
    const staleTrackIds = Array.from(new Set((existingEntitlements || [])
      .map((row: { track_id: string }) => row.track_id)
      .filter((trackId: string) => !currentTrackIds.has(trackId))))
    for (const staleTrackId of staleTrackIds) {
      const { error: staleUpdateError } = await admin.from('google_play_entitlements')
        .update({ status: 'revoked', updated_at: nowIso })
        .eq('purchase_link_id', linkId)
        .eq('user_id', user.id)
        .eq('track_id', staleTrackId)
      if (staleUpdateError) return json(req, { error: 'Could not reconcile the subscription tracks.' }, 500)
    }

    return json(req, {
      linked: true,
      active: isEntitledNow,
      productIds: Array.from(new Set(recognizedItems.map(item => item.productId))),
      activeTracks: isEntitledNow
        ? Array.from(new Set(recognizedItems.filter(item => item.expiry > now).flatMap(item => item.tracks.map(track => track.trackId))))
        : [],
      expiresAt: entitlementExpiry
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Play subscription verification failed.'
    return json(req, { error: message }, 502)
  }
})
