import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  matchesObfuscatedHyperionAccount,
  obfuscatedHyperionAccountId
} from './account-binding.ts'

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
async function googleAccessToken(forceRefresh = false) {
  if (!forceRefresh && cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > Date.now() + 60_000) {
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
    // Log provider error metadata only. Never log assertions, tokens, service-account
    // JSON, private keys, or purchase tokens.
    console.error('google_play_oauth_token_exchange_failed', {
      httpStatus: response.status,
      error: typeof body.error === 'string' ? body.error : 'unknown',
      errorDescription: typeof body.error_description === 'string'
        ? body.error_description.slice(0, 180)
        : undefined
    })
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
  const endpoint = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(PACKAGE_NAME) + '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(token)

  let response: Response | null = null
  let payload: Record<string, any> = {}

  // If a service-account key or permissions have just changed, an isolate may still
  // hold a token minted before that change. On 401/403, discard it and retry once.
  for (let attempt = 0; attempt < 2; attempt++) {
    const accessToken = await googleAccessToken(attempt === 1)
    response = await fetch(endpoint, { headers: { Authorization: 'Bearer ' + accessToken } })
    payload = await response.json().catch(() => ({})) as Record<string, any>
    if (response.ok) return payload as {
      subscriptionState?: string
      linkedPurchaseToken?: string
      externalAccountIdentifiers?: { obfuscatedExternalAccountId?: string }
      lineItems?: Array<{ productId?: string; expiryTime?: string }>
    }
    if ((response.status === 401 || response.status === 403) && attempt === 0) {
      cachedGoogleAccessToken = null
      console.warn('google_play_subscription_lookup_retrying_after_auth_error', {
        httpStatus: response.status,
        packageName: PACKAGE_NAME
      })
      continue
    }
    break
  }

  if (!response) throw new Error('Google Play subscription verification failed.')

  if (response.status === 401 || response.status === 403) {
    // Read-only diagnostic probe. This does not grant access or alter any purchase;
    // it determines whether the same service account can read the app's subscription catalog.
    try {
      const accessToken = await googleAccessToken()
      const catalogEndpoint = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
        encodeURIComponent(PACKAGE_NAME) + '/subscriptions?pageSize=1'
      const catalogResponse = await fetch(catalogEndpoint, {
        headers: { Authorization: 'Bearer ' + accessToken }
      })
      const catalogPayload = await catalogResponse.json().catch(() => ({})) as Record<string, any>
      console.error('google_play_catalog_access_probe', {
        httpStatus: catalogResponse.status,
        packageName: PACKAGE_NAME,
        accessible: catalogResponse.ok,
        apiReason: Array.isArray(catalogPayload?.error?.errors)
          && typeof catalogPayload.error.errors[0]?.reason === 'string'
          ? catalogPayload.error.errors[0].reason
          : undefined,
        apiMessage: typeof catalogPayload?.error?.message === 'string'
          ? catalogPayload.error.message.slice(0, 160)
          : undefined
      })
    } catch {
      console.error('google_play_catalog_access_probe_failed', {
        packageName: PACKAGE_NAME,
        reason: 'probe_request_failed'
      })
    }
  }

  // Provider status and error text are safe diagnostics; never include purchase tokens,
  // service-account JSON, private keys, JWT assertions, or OAuth access tokens.
  console.error('google_play_subscription_lookup_failed', {
    httpStatus: response.status,
    packageName: PACKAGE_NAME,
    configuredServiceAccountEmail: (() => {
      try {
        const raw = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
        const email = raw ? JSON.parse(raw).client_email : undefined
        return typeof email === 'string' ? email : '(missing)'
      } catch {
        return '(invalid JSON)'
      }
    })(),
    apiStatus: typeof payload?.error?.status === 'string' ? payload.error.status : undefined,
    apiReason: Array.isArray(payload?.error?.errors)
      && typeof payload.error.errors[0]?.reason === 'string'
      ? payload.error.errors[0].reason
      : undefined,
    apiMessage: typeof payload?.error?.message === 'string'
      ? payload.error.message.slice(0, 180)
      : undefined
  })
  if (response.status === 404 || response.status === 400) throw new Error('Google Play could not verify this purchase token.')
  if (response.status === 401 || response.status === 403) throw new Error('Google Play API access is not authorized. Google API diagnostics were recorded; no entitlement was granted.')
  throw new Error('Google Play subscription verification is temporarily unavailable.')
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

    // For purchases created after account binding was added, the Google Play purchase
    // must belong to the same authenticated Hyperion account attempting to link it.
    // Purchases without this optional field are legacy purchases and retain the existing
    // first-link flow; the unique token-owner check below still prevents reassignment.
    const expectedAccountId = await obfuscatedHyperionAccountId(user.id)
    const observedAccountId = google.externalAccountIdentifiers?.obfuscatedExternalAccountId
    if (!matchesObfuscatedHyperionAccount(observedAccountId, expectedAccountId)) {
      return json(req, {
        error: 'This Google Play subscription was purchased under a different Hyperion account. Sign in with the original account to sync it.'
      }, 409)
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
    const isEntitledNow = recognizedItems.length > 0 && allowedStates.has(google.subscriptionState || '') && maxExpiry > now
    const entitlementExpiry = new Date(maxExpiry).toISOString()
    const tokenHash = await sha256Hex(token)
    const admin = createClient(url, service, { auth: { persistSession: false } })

    const { data: existing, error: lookupError } = await admin.from('google_play_purchase_links')
      .select('id,user_id,subscription_state')
      .eq('purchase_token_sha256', tokenHash)
      .maybeSingle()
    if (lookupError) return json(req, { error: 'Could not check whether this purchase is already linked.' }, 500)
    if (existing && existing.user_id !== user.id) {
      return json(req, { error: 'This Google Play subscription is already linked to another Hyperion account. Contact support if you believe this is incorrect.' }, 409)
    }
    if (existing?.subscription_state === 'SUBSCRIPTION_STATE_REPLACED') {
      return json(req, { error: 'This Google Play purchase token has been replaced. Link the current subscription instead.' }, 409)
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

    if (!recognizedItems.length && !existing && !priorPurchaseLink) {
      return json(req, { error: 'This purchase is not a Hyperion subscription.' }, 409)
    }

    // Build one canonical row per track. The RPC updates the purchase link and
    // all entitlement rows in one database transaction, preserving original
    // granted_at timestamps and preventing partial REST writes from leaving stale access.
    const trackDetails = new Map<string, { productCode: string; expiry: number }>()
    for (const item of recognizedItems) {
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
      status: isEntitledNow && item.expiry > now ? 'active' : 'revoked',
      expires_at: new Date(item.expiry).toISOString()
    }))
    const activeProductIds = isEntitledNow
      ? Array.from(new Set(recognizedItems.filter(item => item.expiry > now).map(item => item.productId)))
      : []

    const { data: syncedLinkId, error: syncError } = await admin.rpc('sync_google_play_subscription_atomic', {
      p_user_id: user.id,
      p_purchase_token: token,
      p_purchase_token_sha256: tokenHash,
      p_product_ids: activeProductIds,
      p_subscription_state: google.subscriptionState || 'SUBSCRIPTION_STATE_UNSPECIFIED',
      p_status: isEntitledNow ? 'active' : 'inactive',
      p_expires_at: entitlementExpiry,
      p_entitlements: entitlementRows,
      p_prior_purchase_link_id: priorPurchaseLink?.id ?? null
    })
    if (syncError) {
      if (String(syncError.message || '').includes('already linked to another user')) {
        return json(req, { error: 'This Google Play subscription is already linked to another Hyperion account. Contact support if you believe this is incorrect.' }, 409)
      }
      throw new Error('Could not atomically reconcile the verified Google Play subscription.')
    }
    if (typeof syncedLinkId !== 'string' || !syncedLinkId) {
      throw new Error('The server did not confirm the Google Play subscription link.')
    }

    return json(req, {
      linked: true,
      active: isEntitledNow,
      productIds: Array.from(new Set(recognizedItems.map(item => item.productId))),
      activeTracks: entitlementRows.filter(item => item.status === 'active').map(item => item.track_id),
      expiresAt: entitlementExpiry
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Play subscription verification failed.'
    console.error('google_play_subscription_link_failed', {
      errorName: error instanceof Error ? error.name : 'UnknownError',
      reason: message.slice(0, 240)
    })
    return json(req, { error: message }, 502)
  }
})
