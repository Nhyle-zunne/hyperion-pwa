import { createClient } from 'npm:@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin'
}
const allowedOrigins = new Set([
  'https://hyperionmaritime.org',
  'https://www.hyperionmaritime.org',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
])
function cors(req: Request) {
  const origin = req.headers.get('Origin') || ''
  return {
    ...corsHeaders,
    'Access-Control-Allow-Origin': allowedOrigins.has(origin) ? origin : 'https://hyperionmaritime.org'
  }
}
function json(req: Request, body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors(req), 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' }
  })
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors(req) })
  if (req.method !== 'POST') return json(req, { error: 'Method not allowed.' }, 405)
  const origin = req.headers.get('Origin')
  if (origin && !allowedOrigins.has(origin)) return json(req, { error: 'Origin not allowed.' }, 403)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json(req, { error: 'Activity tracking is temporarily unavailable.' }, 503)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json(req, { error: 'Sign-in required.' }, 401)

  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false }
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json(req, { error: 'Please sign in again.' }, 401)

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })
  const now = Date.now()
  const { data: existing, error: readError } = await admin.from('user_activity')
    .select('last_accessed_at')
    .eq('user_id', user.id)
    .maybeSingle()
  if (readError) return json(req, { error: 'Could not record account activity.' }, 500)

  // Limit writes while still updating the record if an active browser/PWA is revisited later.
  const last = existing?.last_accessed_at ? Date.parse(existing.last_accessed_at) : 0
  if (Number.isFinite(last) && now - last < 15 * 60 * 1000) {
    return json(req, { ok: true, updated: false, lastAccessedAt: existing.last_accessed_at })
  }

  const timestamp = new Date(now).toISOString()
  const { error: upsertError } = await admin.from('user_activity').upsert({
    user_id: user.id,
    last_accessed_at: timestamp,
    updated_at: timestamp
  }, { onConflict: 'user_id' })
  if (upsertError) return json(req, { error: 'Could not record account activity.' }, 500)

  return json(req, { ok: true, updated: true, lastAccessedAt: timestamp })
})
