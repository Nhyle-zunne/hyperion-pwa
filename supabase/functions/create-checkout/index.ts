import { createClient } from 'npm:@supabase/supabase-js@2'

// Compatibility endpoint for older PWA clients. Current website purchases
// use the signed-in QR Ph/bank-transfer checkout and manual verification.
// Never create new hosted-payment sessions here.
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
    status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)

  const url = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  if (!url || !anonKey) return json({ error: 'Sign-in service is temporarily unavailable.' }, 503)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Please sign in first.' }, 401)
  const client = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false },
  })
  const { data: { user }, error } = await client.auth.getUser()
  if (error || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { action?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  if (body.action === 'status') return json({ action: 'status', enabled: false, mode: null, reason: 'manual_only' })
  return json({ error: 'New hosted checkout sessions are retired. Use the manual QR Ph or bank-transfer checkout.' }, 503)
})
