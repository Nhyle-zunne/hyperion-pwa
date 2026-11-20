import { publicSubscriptionStatus } from './verification.ts'
import { createRestoreRateLimiter } from './rate-limit.ts'

// This endpoint is intentionally read-only. The BillingClient purchase token proves
// possession of a Play purchase, but never authorizes linking it to a Hyperion user.
// Account-linked entitlements still require the authenticated link function.
const PACKAGE_NAME = 'com.nhyle.hyperionmaritime'
let cachedAccessToken: { value: string; expiresAt: number } | null = null
const restoreRateLimit = createRestoreRateLimiter()

function reply(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
  })
}

async function readBodyLimited(req: Request, maxBytes = 8192) {
  if (Number(req.headers.get('content-length') || 0) > maxBytes) throw new Error('too large')
  const reader = req.body?.getReader()
  if (!reader) return ''
  const parts: Uint8Array[] = []
  let size = 0
  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > maxBytes) {
      await reader.cancel()
      throw new Error('too large')
    }
    parts.push(value)
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const part of parts) {
    bytes.set(part, offset)
    offset += part.byteLength
  }
  return new TextDecoder().decode(bytes)
}

function b64url(data: Uint8Array) {
  let text = ''
  for (const byte of data) text += String.fromCharCode(byte)
  return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function googleAccessToken(refresh = false): Promise<string> {
  if (!refresh && cachedAccessToken && cachedAccessToken.expiresAt > Date.now() + 60_000) {
    return cachedAccessToken.value
  }
  const secret = Deno.env.get('GOOGLE_PLAY_SERVICE_ACCOUNT_JSON')
  if (!secret) throw new Error('Google Play verification not configured')
  const service = JSON.parse(secret) as { client_email?: string; private_key?: string; token_uri?: string }
  if (!service.client_email || !service.private_key) throw new Error('Invalid Google Play credentials')

  const tokenUri = service.token_uri || 'https://oauth2.googleapis.com/token'
  const now = Math.floor(Date.now() / 1000)
  const header = b64url(new TextEncoder().encode(JSON.stringify({ alg: 'RS256', typ: 'JWT' })))
  const claims = b64url(new TextEncoder().encode(JSON.stringify({
    iss: service.client_email,
    scope: 'https://www.googleapis.com/auth/androidpublisher',
    aud: tokenUri,
    iat: now,
    exp: now + 3600
  })))
  const unsigned = `${header}.${claims}`
  const pem = service.private_key.replace(/-----BEGIN PRIVATE KEY-----|-----END PRIVATE KEY-----|\s+/g, '')
  const rawKey = Uint8Array.from(atob(pem), character => character.charCodeAt(0))
  const key = await crypto.subtle.importKey('pkcs8', rawKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'])
  const signature = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned))
  const assertion = `${unsigned}.${b64url(new Uint8Array(signature))}`

  const response = await fetch(tokenUri, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
    signal: AbortSignal.timeout(8000)
  })
  const result = await response.json().catch(() => ({})) as Record<string, unknown>
  if (!response.ok || typeof result.access_token !== 'string') throw new Error('Google Play authorization failed')
  cachedAccessToken = {
    value: result.access_token,
    expiresAt: Date.now() + Math.min(Number(result.expires_in || 3600), 3500) * 1000
  }
  return cachedAccessToken.value
}

async function verifySubscription(purchaseToken: string) {
  const endpoint = 'https://androidpublisher.googleapis.com/androidpublisher/v3/applications/' +
    encodeURIComponent(PACKAGE_NAME) + '/purchases/subscriptionsv2/tokens/' + encodeURIComponent(purchaseToken)
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await googleAccessToken(attempt > 0)
    const response = await fetch(endpoint, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8000)
    })
    if (response.status === 401 && attempt === 0) {
      cachedAccessToken = null
      continue
    }
    if (!response.ok) {
      if (response.status === 400 || response.status === 404) return null
      throw new Error('Google Play verification failed')
    }
    return await response.json() as Record<string, unknown>
  }
  throw new Error('Google Play authorization failed')
}

Deno.serve(async (req: Request) => {
  if (req.method !== 'POST') return reply(405, { error: 'Method not allowed' })
  // Per-source headers may vary by gateway. The independent isolate-wide budget
  // bounds bursts even if a caller spoofs its forwarded address.
  const source = (req.headers.get('cf-connecting-ip') || req.headers.get('x-forwarded-for')?.split(',')[0] || '').trim().slice(0, 64)
  if (!restoreRateLimit.allow(source, Date.now())) return reply(429, { error: 'Too many restore attempts. Please try again shortly.' })
  try {
    let purchaseToken = ''
    try {
      const body = JSON.parse(await readBodyLimited(req)) as Record<string, unknown>
      purchaseToken = typeof body.purchaseToken === 'string' ? body.purchaseToken.trim() : ''
    } catch {
      return reply(400, { error: 'Invalid request' })
    }
    if (purchaseToken.length < 6 || purchaseToken.length > 4096 || purchaseToken.startsWith('mock_sandbox_sub_token_')) {
      return reply(400, { error: 'Invalid purchase token' })
    }

    try {
      const google = await verifySubscription(purchaseToken)
      if (!google) return reply(404, { error: 'Purchase not found' })
      const status = publicSubscriptionStatus(google, Date.now())
      if (!status.items.length) return reply(404, { error: 'Purchase not found' })
      return reply(200, status)
    } catch {
      // No purchase tokens, credential values or Google account metadata in logs/responses.
      console.error('google_play_restore_verification_unavailable')
      return reply(503, { error: 'Google Play verification temporarily unavailable' })
    }
  } finally {
    restoreRateLimit.finish()
  }
})
