import { createClient } from 'npm:@supabase/supabase-js@2'
import {
  BUCKET, MAX_IMAGE_BYTES, mediaObjectPath, validMime, validTrack,
  imageSignatureMatches, sha256, activePaidTrackRows
} from './policy.ts'

const allowedOrigins = new Set([
  'https://hyperionmaritime.org', 'https://www.hyperionmaritime.org',
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173'
])
function cors(req: Request): Record<string,string> {
  const origin = req.headers.get('origin') || ''
  return {
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://hyperionmaritime.org',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Expose-Headers': 'X-Hyperion-Media-SHA256, X-Hyperion-Media-Bytes',
    'Vary': 'Origin'
  }
}
function json(req: Request, data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
  })
}
function validAdminEmail(email: string | undefined): boolean {
  const allowed = (Deno.env.get('ADMIN_EMAILS') || '')
    .split(/[;,\s]+/).map(value => value.trim().toLowerCase()).filter(Boolean)
  return !!email && allowed.includes(email.toLowerCase())
}
async function readVerifiedObject(admin: any, path: string, mime: string, expectedSha: string): Promise<Uint8Array | null> {
  const { data, error } = await admin.storage.from(BUCKET).download(path)
  if (error || !data) return null
  const bytes = new Uint8Array(await data.arrayBuffer())
  if (!validMime(mime) || !imageSignatureMatches(bytes, mime) || await sha256(bytes) !== expectedSha) return null
  return bytes
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'GET' && req.method !== 'POST') return json(req, { error: 'Unsupported media method.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json(req, { error: 'Question images are not configured.' }, 503)
  const authHeader = req.headers.get('Authorization')
  if (!authHeader?.startsWith('Bearer ')) return json(req, { error: 'Sign in to view licensed question media.' }, 401)

  const client = createClient(url, anon, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: { user }, error: authError } = await client.auth.getUser()
  if (authError || !user?.id) return json(req, { error: 'Sign-in expired.' }, 401)

  const admin = createClient(url, service, { auth: { persistSession: false } })
  const isAdmin = validAdminEmail(user.email)

  if (req.method === 'GET') {
    const target = new URL(req.url)
    const track = target.searchParams.get('track')
    const digest = target.searchParams.get('sha256')
    const mime = target.searchParams.get('mime')
    const path = mediaObjectPath(track, digest, mime)
    if (!path || !validTrack(track) || !validMime(mime) || !digest) return json(req, { error: 'Invalid image reference.' }, 400)

    if (!isAdmin) {
      // Service-only function introduced in the active-entitlement migration.
      // Never trust a cached/expired JWT license claim for paid asset delivery.
      const { data, error } = await admin.rpc('get_active_paid_track_entitlements', {
        p_user_id: user.id, p_track_id: track
      })
      if (error) return json(req, { error: 'Licenses could not be verified.' }, 503)
      if (!activePaidTrackRows(data, user.id, track)) return json(req, { error: 'An active track license is required.' }, 403)
    }

    const bytes = await readVerifiedObject(admin, path, mime, digest)
    if (!bytes) return json(req, { error: 'Verified question image not found.' }, 404)
    return new Response(Uint8Array.from(bytes), {
      status: 200,
      headers: {
        ...cors(req),
        'Content-Type': mime,
        'Content-Length': String(bytes.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Hyperion-Media-SHA256': digest,
        'X-Hyperion-Media-Bytes': String(bytes.length)
      }
    })
  }

  if (!isAdmin) return json(req, { error: 'Only a Hyperion administrator can upload question images.' }, 403)
  const declaredLength = Number(req.headers.get('content-length') || 0)
  if (declaredLength > 750000) return json(req, { error: 'Image payload exceeds the limit.' }, 413)

  let body: unknown
  try { body = await req.json() } catch { return json(req, { error: 'Invalid media upload.' }, 400) }
  if (!body || typeof body !== 'object') return json(req, { error: 'Invalid media upload.' }, 400)
  const input = body as Record<string, unknown>
  if (!validTrack(input.track) || !validMime(input.mime) ||
      typeof input.base64 !== 'string' || input.base64.length < 16 ||
      input.base64.length > 700000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(input.base64)) {
    return json(req, { error: 'Unsupported or oversized image data.' }, 400)
  }
  let bytes: Uint8Array
  try { bytes = Uint8Array.from(atob(input.base64), c => c.charCodeAt(0)) }
  catch { return json(req, { error: 'Invalid image encoding.' }, 400) }
  if (bytes.byteLength > MAX_IMAGE_BYTES || !imageSignatureMatches(bytes, input.mime)) {
    return json(req, { error: 'Image must be a valid WebP, PNG or JPEG under 512 KiB.' }, 400)
  }
  const digest = await sha256(bytes)
  const path = mediaObjectPath(input.track, digest, input.mime)!
  // Content-addressed, immutable object. A duplicate upload never replaces a
  // previously published image or changes the meaning of an existing question.
  const { error } = await admin.storage.from(BUCKET).upload(
    path, new Blob([Uint8Array.from(bytes)], { type: input.mime }),
    { contentType: input.mime, cacheControl: '31536000', upsert: false }
  )
  if (error) {
    const duplicate = String((error as { statusCode?: unknown }).statusCode || '') === '409' ||
      String((error as { message?: unknown }).message || '').toLowerCase().includes('already exists')
    if (!duplicate || !await readVerifiedObject(admin, path, input.mime, digest)) {
      return json(req, { error: 'Question image could not be saved to private storage.' }, 503)
    }
  }
  return json(req, { sha256: digest, mime: input.mime, bytes: bytes.byteLength, track: input.track }, 200)
})
