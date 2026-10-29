import { createClient } from 'npm:@supabase/supabase-js@2'
import { createRemoteJWKSet, jwtVerify } from 'npm:jose@6.2.13'

const PACKAGE_NAME = 'com.nhyle.hyperionmaritime'
const GOOGLE_JWKS = createRemoteJWKSet(new URL('https://www.googleapis.com/oauth2/v3/certs'))
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
const ALLOWED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED'
])
let cachedGoogleAccessToken: { token: string; expiresAt: number } | null = null

class GooglePlayApiError extends Error {
  constructor(readonly status: number) {
    super('Google Play subscription verification failed.')
  }
}
class PayloadTooLargeError extends Error {}

function respond(status: number, body?: unknown) {
  const headers: Record<string, string> = { 'Cache-Control': 'no-store, private' }
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  return new Response(body === undefined ? null : JSON.stringify(body), { status, headers })
}
async function readLimitedBody(req: Request, maxBytes = 128 * 1024): Promise<string> {
  const declared = req.headers.get('content-length')
  if (declared && /^\d+$/.test(declared) && Number(declared) > maxBytes) {
    throw new PayloadTooLargeError()
  }
  const reader = req.body?.getReader()
  if (!reader) return ''
  const chunks: Uint8Array[] = []
  let total = 0
  while (true) {
    const next = await reader.read()
    if (next.done) break
    total += next.value.byteLength
    if (total > maxBytes) {
      await reader.cancel()
      throw new PayloadTooLargeError()
    }
    chunks.push(next.value)
  }
  const bytes = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.byteLength
  }
  return new TextDecoder().decode(bytes)
}
function decodePubSubData(value: string): string {
  if (!value || value.length > 128 * 1024) throw new Error('Invalid Pub/Sub message data.')
  const normalized = value.replace(/-/g, '+').replace(/_/g, '/')
  const padded = normalized + '='.repeat((4 - normalized.length % 4) % 4)
  const binary = atob(padded)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return new TextDecoder().decode(bytes)
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
async function validatePushIdentity(
  req: Request,
  audience: string,
  expectedEmail: string
): Promise<{ valid: boolean; reason?: string }> {
  const header = req.headers.get('Authorization') || ''
  const match = header.match(/^Bearer\s+([^\s]+)$/i)
  if (!match) return { valid: false, reason: 'missing_bearer_token' }
  try {
    const { payload } = await jwtVerify(match[1], GOOGLE_JWKS, {
      issuer: ['https://accounts.google.com', 'accounts.google.com'],
      audience,
      algorithms: ['RS256']
    })
    if (payload.email !== expectedEmail) {
      // Both values are service-account identifiers, not credentials. Logging
      // them helps diagnose an OIDC configuration mismatch without logging the JWT.
      console.warn('google_play_rtdn_email_mismatch', {
        actualServiceAccountEmail: typeof payload.email === 'string' ? payload.email : '(missing)',
        configuredExpectedEmail: expectedEmail,
        trimmedCaseInsensitiveMatch: typeof payload.email === 'string'
          && payload.email.trim().toLowerCase() === expectedEmail.trim().toLowerCase()
      })
      return { valid: false, reason: 'service_account_email_mismatch' }
    }
    if (payload.email_verified !== true) {
      return { valid: false, reason: 'service_account_email_not_verified' }
    }
    return { valid: true }
  } catch (error) {
    const details = error && typeof error === 'object'
      ? error as { name?: unknown; code?: unknown; claim?: unknown }
      : {}
    const claim = typeof details.claim === 'string' ? details.claim : ''
    const code = typeof details.code === 'string' ? details.code : ''
    const name = typeof details.name === 'string' ? details.name : ''
    const reason = claim
      ? `jwt_claim_${claim}_failed`
      : code
        ? `jwt_verification_${code}`
        : name
          ? `jwt_verification_${name}`
          : 'jwt_verification_failed'
    return { valid: false, reason }
  }
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
    lineItems?: Array<{ productId?: string; expiryTime?: string }>
  }
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return respond(405, { error: 'Method not allowed.' })
  const url = Deno.env.get('SUPABASE_URL')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const audience = Deno.env.get('GOOGLE_PLAY_PUBSUB_AUDIENCE')
  const expectedEmail = Deno.env.get('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL')
  if (!url || !service || !audience || !expectedEmail) {
    return respond(503, { error: 'Google Play RTDN endpoint is not configured.' })
  }
  const identity = await validatePushIdentity(req, audience, expectedEmail)
  if (!identity.valid) {
    // Log only a categorized failure reason; never log the bearer token or private claims.
    console.warn('google_play_rtdn_auth_rejected', { reason: identity.reason || 'unknown' })
    return respond(401, { error: 'Unauthorized Pub/Sub push request.' })
  }

  let envelope: any
  try {
    envelope = JSON.parse(await readLimitedBody(req))
  } catch (error) {
    if (error instanceof PayloadTooLargeError) return respond(413, { error: 'Pub/Sub request is too large.' })
    return respond(400, { error: 'Invalid Pub/Sub request body.' })
  }
  const encodedData = envelope?.message?.data
  if (typeof encodedData !== 'string') return respond(400, { error: 'Missing Pub/Sub message data.' })

  let notification: any
  try { notification = JSON.parse(decodePubSubData(encodedData)) } catch {
    return respond(400, { error: 'Invalid Google Play notification payload.' })
  }

  // Pub/Sub test messages and unrelated apps should be acknowledged, not retried forever.
  if (notification?.testNotification || notification?.packageName !== PACKAGE_NAME) return respond(204)
  const token = notification?.subscriptionNotification?.purchaseToken
  const notificationType = typeof notification?.subscriptionNotification?.notificationType === 'number'
    ? notification.subscriptionNotification.notificationType
    : null
  if (typeof token !== 'string' || token.length === 0 || token.length > 4096) {
    console.info('google_play_rtdn_ignored_notification_without_purchase_token', { notificationType })
    return respond(204)
  }

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const tokenHash = await sha256Hex(token)
  const { data: link, error: lookupError } = await admin.from('google_play_purchase_links')
    .select('id,user_id,subscription_state')
    .eq('purchase_token_sha256', tokenHash)
    .maybeSingle()
  if (lookupError) return respond(503, { error: 'Could not look up the linked Google Play subscription.' })
  // Do not associate an RTDN token with an account. Unknown tokens are safely
  // acknowledged; the authenticated Android client must establish ownership.
  if (!link) {
    console.info('google_play_rtdn_ignored_unlinked_token', { notificationType })
    return respond(204)
  }
  // Once a verified replacement has retired a predecessor token, late RTDN
  // notifications must never reactivate the predecessor's grants.
  if (link.subscription_state === 'SUBSCRIPTION_STATE_REPLACED') {
    console.info('google_play_rtdn_ignored_replaced_token', { notificationType })
    return respond(204)
  }

  let google: Awaited<ReturnType<typeof readGoogleSubscription>>
  try {
    google = await readGoogleSubscription(token)
  } catch (error) {
    if (error instanceof GooglePlayApiError && (error.status === 400 || error.status === 404)) {
      const nowIso = new Date().toISOString()
      const { error: revokeError } = await admin.rpc('sync_google_play_subscription_atomic', {
        p_user_id: link.user_id,
        p_purchase_token: token,
        p_purchase_token_sha256: tokenHash,
        p_product_ids: [],
        p_subscription_state: 'SUBSCRIPTION_STATE_EXPIRED',
        p_status: 'inactive',
        p_expires_at: nowIso,
        p_entitlements: [],
        p_prior_purchase_link_id: null
      })
      if (revokeError) {
        console.error('google_play_rtdn_expiry_revoke_failed', {
          notificationType,
          httpStatus: error.status
        })
        return respond(503, { error: 'Could not revoke an unverifiable Google Play subscription.' })
      }
      console.info('google_play_rtdn_revoked_after_unverifiable_token', {
        notificationType,
        httpStatus: error.status
      })
      return respond(204)
    }
    return respond(503, { error: 'Google Play subscription verification is temporarily unavailable.' })
  }

  const now = Date.now()
  const lineItems = Array.isArray(google.lineItems) ? google.lineItems : []
  const recognizedItems = lineItems.flatMap(item => {
    const productId = typeof item.productId === 'string' ? item.productId : ''
    const mapped = PRODUCT_TO_TRACKS[productId]
    const expiry = typeof item.expiryTime === 'string' ? Date.parse(item.expiryTime) : NaN
    if (!mapped || !Number.isFinite(expiry)) return []
    return [{ productId, tracks: mapped, expiry }]
  })
  const maxExpiry = recognizedItems.length ? Math.max(...recognizedItems.map(item => item.expiry)) : now
  const isEntitledNow = recognizedItems.length > 0 && ALLOWED_STATES.has(google.subscriptionState || '') && maxExpiry > now
  const entitlementExpiry = new Date(maxExpiry).toISOString()
  const productIds = isEntitledNow
    ? Array.from(new Set(recognizedItems.filter(item => item.expiry > now).map(item => item.productId)))
    : []
  const trackDetails = new Map<string, { productCode: string; expiry: number }>()
  for (const item of recognizedItems) {
    for (const track of item.tracks) {
      const current = trackDetails.get(track.trackId)
      if (!current || item.expiry > current.expiry) {
        trackDetails.set(track.trackId, { productCode: track.productCode, expiry: item.expiry })
      }
    }
  }
  const entitlements = Array.from(trackDetails.entries()).map(([trackId, item]) => ({
    product_code: item.productCode,
    track_id: trackId,
    status: isEntitledNow && item.expiry > now ? 'active' : 'revoked',
    expires_at: new Date(item.expiry).toISOString()
  }))
  const { error: syncError } = await admin.rpc('sync_google_play_subscription_atomic', {
    p_user_id: link.user_id,
    p_purchase_token: token,
    p_purchase_token_sha256: tokenHash,
    p_product_ids: productIds,
    p_subscription_state: google.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED',
    p_status: isEntitledNow ? 'active' : 'inactive',
    p_expires_at: entitlementExpiry,
    p_entitlements: entitlements,
    p_prior_purchase_link_id: null
  })
  if (syncError) {
    console.error('google_play_rtdn_atomic_reconcile_failed', {
      notificationType,
      subscriptionState: google.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED'
    })
    return respond(503, { error: 'Could not reconcile the verified Google Play subscription.' })
  }
  // Safe aggregate diagnostics only: never log purchase tokens, token hashes, or user IDs.
  console.info('google_play_rtdn_subscription_reconciled', {
    notificationType,
    subscriptionState: google.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED',
    active: isEntitledNow,
    productCount: productIds.length,
    entitlementCount: entitlements.length
  })
  return respond(204)
})
