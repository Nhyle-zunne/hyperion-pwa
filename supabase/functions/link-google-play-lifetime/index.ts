import { createClient } from 'npm:@supabase/supabase-js@2'
import { obfuscatedHyperionAccountId } from '../link-google-play-subscription/account-binding.ts'

const PACKAGE_NAME = 'com.nhyle.hyperionmaritime'
const PRODUCT_CODES: Record<string, string> = {
  hyperion_oic_nw_lifetime: 'oic_nw',
  hyperion_engine_oic_ew_lifetime: 'engine_ew',
  hyperion_gmdss_lifetime: 'gmdss',
  hyperion_deck_mgt_lifetime: 'deck_mgt',
  hyperion_engine_mgt_lifetime: 'engine_mgt'
}
const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Cache-Control': 'no-store, private'
}
const reply = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } })

let cachedGoogleAccessToken: { token: string; expiresAt: number } | null = null
function base64Url(value: Uint8Array) {
  let binary = ''
  for (const b of value) binary += String.fromCharCode(b)
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}
const encode = (value: string) => base64Url(new TextEncoder().encode(value))
function decodePrivateKey(value: string) {
  const encoded = value.replace(/-----BEGIN PRIVATE KEY-----/g, '').replace(/-----END PRIVATE KEY-----/g, '').replace(/\s+/g, '')
  return Uint8Array.from(atob(encoded), c => c.charCodeAt(0))
}

async function googleAccessToken() {
  if (cachedGoogleAccessToken && cachedGoogleAccessToken.expiresAt > Date.now() + 60_000)
    return cachedGoogleAccessToken.token
  const secret = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
  if (!secret) throw new Error('Google Play API credentials are not configured.')
  const account = JSON.parse(secret) as { client_email?: string; private_key?: string; token_uri?: string }
  if (!account.client_email || !account.private_key)
    throw new Error('Google Play service-account credentials are incomplete.')
  const tokenUri = account.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const unsigned = encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    encode(JSON.stringify({
      iss: account.client_email,
      aud: tokenUri,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      iat: now,
      exp: now + 3600
    }))
  const privateKey = await crypto.subtle.importKey(
    'pkcs8', decodePrivateKey(account.private_key),
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  )
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', privateKey, new TextEncoder().encode(unsigned))
  const assertion = unsigned + '.' + base64Url(new Uint8Array(signature))
  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion
    }),
    signal: AbortSignal.timeout(8_000)
  })
  const result = await response.json().catch(() => ({}))
  if (!response.ok || typeof result.access_token !== 'string')
    throw new Error('Google Play API authentication failed.')
  cachedGoogleAccessToken = {
    token: result.access_token,
    expiresAt: Date.now() + Math.min(Number(result.expires_in || 3600), 3500) * 1000
  }
  return cachedGoogleAccessToken.token
}

async function readVerifiedPurchase(token: string) {
  const googleToken = await googleAccessToken()
  const endpoint = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(PACKAGE_NAME) + '/purchases/productsv2/tokens/' + encodeURIComponent(token)
  const response = await fetch(endpoint, {
    headers: { Authorization: 'Bearer ' + googleToken },
    signal: AbortSignal.timeout(8_000)
  })
  if (!response.ok) {
    if (response.status === 400 || response.status === 404)
      throw new Error('Google Play could not verify this one-time purchase.')
    throw new Error('Google Play purchase verification is temporarily unavailable.')
  }
  return response.json()
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return Array.from(new Uint8Array(bytes), b => b.toString(16).padStart(2, '0')).join('')
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS })
  if (req.method !== 'POST') return reply({ error: 'Method not allowed.' }, 405)
  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return reply({ error: 'Lifetime verification is unavailable.' }, 503)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return reply({ error: 'Sign in to your Hyperion account first.' }, 401)
  const client = createClient(url, anon, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false }
  })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user) return reply({ error: 'Sign in again to verify this purchase.' }, 401)

  let body: { action?: unknown; productId?: unknown; purchaseToken?: unknown }
  try { body = await req.json() } catch { return reply({ error: 'Invalid request.' }, 400) }
  // Explicitly inactive until Play Console non-consumables, Google Play RTDN
  // and voided-purchase delivery have been configured and verified by the owner.
  const enabled = Deno.env.get('GOOGLE_PLAY_LIFETIME_ENABLED') === 'true' &&
    Boolean(Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')) &&
    Boolean(Deno.env.get('GOOGLE_PLAY_PUBSUB_AUDIENCE')) &&
    Boolean(Deno.env.get('GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL'))
  if (body.action === 'status') return reply({ enabled })
  if (body.action !== 'link') return reply({ error: 'Unsupported action.' }, 400)
  if (!enabled) return reply({ error: 'Google Play Lifetime products are not enabled yet.' }, 503)
  const productId = typeof body.productId === 'string' ? body.productId.trim() : ''
  const productCode = PRODUCT_CODES[productId]
  const token = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : ''
  if (!productCode || token.length < 6 || token.length > 4096 ||
      token.startsWith('mock_sandbox_')) {
    return reply({ error: 'Invalid Google Play Lifetime product or purchase.' }, 400)
  }
  try {
    // Never trust the Android Purchase state or product ID as proof of access.
    const google = await readVerifiedPurchase(token)
    const expectedAccountId = await obfuscatedHyperionAccountId(user.id)
    if (typeof google?.obfuscatedExternalAccountId !== 'string' ||
        google.obfuscatedExternalAccountId !== expectedAccountId) {
      return reply({ error: 'This purchase belongs to a different Hyperion account.' }, 409)
    }
    const items = google?.productLineItem
    const item = Array.isArray(items) && items.length === 1 ? items[0] : null
    if (google?.purchaseStateContext?.purchaseState !== 'PURCHASED' ||
        typeof google?.purchaseCompletionTime !== 'string' ||
        !item || item.productId !== productId ||
        item.productOfferDetails?.rentOfferDetails ||
        (item.productOfferDetails?.quantity != null && item.productOfferDetails.quantity !== 1) ||
        (item.productOfferDetails?.refundableQuantity != null && item.productOfferDetails.refundableQuantity < 1)) {
      return reply({ error: 'Google Play has not confirmed this non-consumable purchase.' }, 409)
    }
    const admin = createClient(url, service, { auth: { persistSession: false } })
    const { data, error } = await admin.rpc('link_verified_google_play_lifetime', {
      p_user_id: user.id,
      p_product_code: productCode,
      p_purchase_ref_sha256: await sha256Hex(token)
    })
    if (error) {
      if (error.code === '23505') return reply({ error: 'This Google Play purchase is linked to another account or track.' }, 409)
      throw new Error('Could not securely store this verified purchase.')
    }
    if (data !== true) return reply({ error: 'This Google Play purchase has already been voided.' }, 409)
    return reply({ linked: true, active: true, productCode })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Google Play verification failed.'
    console.warn('google_play_lifetime_link_failed', { reason: message.slice(0, 110) })
    return reply({ error: message }, 503)
  }
})
