import { createClient } from 'npm:@supabase/supabase-js@2'

const PACKAGE_NAME = 'com.nhyle.hyperionmaritime'
const BATCH_SIZE = 20
const ALLOWED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED'
])
const PRODUCT_TO_TRACKS: Record<string, Array<{ productCode: string; trackId: string }>> = {
  hyperion_oic_nw_pass: [{ productCode: 'oic_nw', trackId: 'DECK_OIC_NW' }],
  hyperion_gmdss_pass: [{ productCode: 'gmdss', trackId: 'GMDSS_GOC' }],
  hyperion_engine_oic_ew_pass: [{ productCode: 'engine_ew', trackId: 'ENGINE_OIC_EW' }],
  hyperion_deck_mgt_pass: [{ productCode: 'deck_mgt', trackId: 'DECK_MGT' }],
  hyperion_engine_mgt_pass: [{ productCode: 'engine_mgt', trackId: 'ENGINE_MGT' }],
  hyperion_all_access_pass: [
    { productCode: 'oic_nw', trackId: 'DECK_OIC_NW' },
    { productCode: 'gmdss', trackId: 'GMDSS_GOC' },
    { productCode: 'engine_ew', trackId: 'ENGINE_OIC_EW' },
    { productCode: 'deck_mgt', trackId: 'DECK_MGT' },
    { productCode: 'engine_mgt', trackId: 'ENGINE_MGT' }
  ]
}
let cachedGoogleAccessToken: { token: string; expiresAt: number } | null = null

class GooglePlayApiError extends Error {
  constructor(readonly status: number) {
    super('Google Play subscription verification failed.')
  }
}

function respond(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
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
  if (!secret) throw new Error('Google Play API credentials are not configured.')
  let account: { client_email?: string; private_key?: string; token_uri?: string }
  try { account = JSON.parse(secret) } catch { throw new Error('Google Play service-account JSON is invalid.') }
  if (!account.client_email || !account.private_key) throw new Error('Google Play service-account JSON is missing required fields.')
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const unsigned = encodeText(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' + encodeText(JSON.stringify({
    iss: account.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  }))
  const key = await crypto.subtle.importKey(
    'pkcs8',
    pemBytes(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: unsigned + '.' + base64Url(new Uint8Array(signature))
    })
  })
  const body = await response.json().catch(() => ({}))
  if (!response.ok || typeof body.access_token !== 'string') {
    throw new Error('Google Play API authentication failed. Check service-account access and credentials.')
  }
  cachedGoogleAccessToken = {
    token: body.access_token,
    expiresAt: Date.now() + Math.min(Number(body.expires_in || 3600), 3500) * 1000
  }
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
  if (!response.ok) throw new GooglePlayApiError(response.status)
  return await response.json() as {
    subscriptionState?: string
    linkedPurchaseToken?: string
    lineItems?: Array<{ productId?: string; expiryTime?: string }>
  }
}
function recognizedItems(google: Awaited<ReturnType<typeof readGoogleSubscription>>) {
  const lineItems = Array.isArray(google.lineItems) ? google.lineItems : []
  return lineItems.flatMap(item => {
    const productId = typeof item.productId === 'string' ? item.productId : ''
    const tracks = PRODUCT_TO_TRACKS[productId]
    const expiry = typeof item.expiryTime === 'string' ? Date.parse(item.expiryTime) : NaN
    if (!tracks || !Number.isFinite(expiry)) return []
    return [{ productId, tracks, expiry }]
  })
}
function inactiveUpdate(nowIso: string) {
  return {
    status: 'inactive',
    product_ids: [],
    subscription_state: 'SUBSCRIPTION_STATE_UNSPECIFIED',
    expires_at: nowIso
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return respond(405, { error: 'Method not allowed.' })
  const url = Deno.env.get('SUPABASE_URL')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !service) return respond(503, { error: 'Google Play reconciliation is not configured.' })

  const suppliedCronToken = req.headers.get('x-hyperion-google-play-reconcile-token') || ''
  if (suppliedCronToken.length < 48 || suppliedCronToken.length > 256) {
    return respond(401, { error: 'Unauthorized reconciliation request.' })
  }
  const admin = createClient(url, service, { auth: { persistSession: false } })
  const { data: cronAuthorized, error: cronAuthorizationError } = await admin.rpc(
    'verify_google_play_reconciliation_cron_token',
    { p_token: suppliedCronToken }
  )
  if (cronAuthorizationError) return respond(503, { error: 'Reconciliation authorization is not configured.' })
  if (cronAuthorized !== true) return respond(401, { error: 'Unauthorized reconciliation request.' })

  const { data: links, error: linkQueryError } = await admin.from('google_play_purchase_links')
    .select('id,user_id,purchase_token,purchase_token_sha256,subscription_state')
    .neq('subscription_state', 'SUBSCRIPTION_STATE_REPLACED')
    .order('last_reconciliation_attempt_at', { ascending: true })
    .order('id', { ascending: true })
    .limit(BATCH_SIZE)
  if (linkQueryError) return respond(503, { error: 'Could not load Google Play subscriptions for reconciliation.' })

  const stats = { processed: 0, verified: 0, revoked: 0, failed: 0 }
  for (const link of links ?? []) {
    stats.processed++
    const attemptAt = new Date().toISOString()
    const { error: attemptError } = await admin.from('google_play_purchase_links')
      .update({ last_reconciliation_attempt_at: attemptAt })
      .eq('id', link.id)
      .eq('user_id', link.user_id)
    if (attemptError) {
      stats.failed++
      continue
    }

    let tokenHash: string
    try {
      tokenHash = await sha256Hex(link.purchase_token)
    } catch {
      stats.failed++
      continue
    }
    if (tokenHash !== link.purchase_token_sha256) {
      const { error } = await admin.from('google_play_purchase_links')
        .update(inactiveUpdate(attemptAt))
        .eq('id', link.id)
        .eq('user_id', link.user_id)
      if (error) stats.failed++
      else stats.revoked++
      continue
    }

    let google: Awaited<ReturnType<typeof readGoogleSubscription>>
    try {
      google = await readGoogleSubscription(link.purchase_token)
    } catch (error) {
      if (error instanceof GooglePlayApiError && (error.status === 400 || error.status === 404)) {
        const { error: revokeError } = await admin.rpc('sync_google_play_subscription_atomic', {
          p_user_id: link.user_id,
          p_purchase_token: link.purchase_token,
          p_purchase_token_sha256: tokenHash,
          p_product_ids: [],
          p_subscription_state: 'SUBSCRIPTION_STATE_EXPIRED',
          p_status: 'inactive',
          p_expires_at: attemptAt,
          p_entitlements: [],
          p_prior_purchase_link_id: null
        })
        if (revokeError) stats.failed++
        else stats.revoked++
      } else {
        stats.failed++
      }
      continue
    }

    const now = Date.now()
    const items = recognizedItems(google)
    const maxExpiry = items.length ? Math.max(...items.map(item => item.expiry)) : now
    const subscriptionState = google.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED'
    const entitledNow = items.length > 0 && ALLOWED_STATES.has(subscriptionState) && maxExpiry > now
    const productIds = entitledNow
      ? Array.from(new Set(items.filter(item => item.expiry > now).map(item => item.productId)))
      : []
    const trackDetails = new Map<string, { productCode: string; expiry: number }>()
    for (const item of items) {
      for (const track of item.tracks) {
        const current = trackDetails.get(track.trackId)
        if (!current || item.expiry > current.expiry) {
          trackDetails.set(track.trackId, { productCode: track.productCode, expiry: item.expiry })
        }
      }
    }
    const entitlementRows = Array.from(trackDetails.entries()).map(([trackId, item]) => ({
      product_code: item.productCode,
      track_id: trackId,
      status: entitledNow && item.expiry > now ? 'active' : 'revoked',
      expires_at: new Date(item.expiry).toISOString()
    }))

    let priorPurchaseLinkId: string | null = null
    if (google.linkedPurchaseToken) {
      const linkedHash = await sha256Hex(google.linkedPurchaseToken)
      if (linkedHash !== tokenHash) {
        const { data: priorLink, error: priorLookupError } = await admin.from('google_play_purchase_links')
          .select('id,user_id')
          .eq('purchase_token_sha256', linkedHash)
          .maybeSingle()
        if (priorLookupError) {
          stats.failed++
          continue
        }
        if (priorLink && priorLink.user_id !== link.user_id) {
          const { error: disableError } = await admin.from('google_play_purchase_links')
            .update(inactiveUpdate(attemptAt))
            .eq('id', link.id)
            .eq('user_id', link.user_id)
          if (disableError) stats.failed++
          else {
            stats.failed++
            stats.revoked++
          }
          continue
        }
        if (priorLink && priorLink.id !== link.id) priorPurchaseLinkId = priorLink.id
      }
    }

    const { error: syncError } = await admin.rpc('sync_google_play_subscription_atomic', {
      p_user_id: link.user_id,
      p_purchase_token: link.purchase_token,
      p_purchase_token_sha256: tokenHash,
      p_product_ids: productIds,
      p_subscription_state: subscriptionState,
      p_status: entitledNow ? 'active' : 'inactive',
      p_expires_at: new Date(maxExpiry).toISOString(),
      p_entitlements: entitlementRows,
      p_prior_purchase_link_id: priorPurchaseLinkId
    })
    if (syncError) {
      stats.failed++
      continue
    }
    if (entitledNow) stats.verified++
    else stats.revoked++
  }

  // Aggregate-only logging avoids leaking purchase tokens, user IDs, or subscription data.
  if (stats.failed > 0) console.warn('Google Play reconciliation completed with per-token failures.', stats)
  return respond(200, {
    ok: stats.failed === 0,
    ...stats,
    batchSize: BATCH_SIZE,
    moreMayRemain: (links ?? []).length === BATCH_SIZE
  })
})
