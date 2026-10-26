import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': 'https://hyperionmaritime.org',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Vary': 'Origin',
}

Deno.serve(async req => {
  const origin = req.headers.get('Origin')
  const headers = { ...cors, ...(origin === 'https://hyperionmaritime.org' ? { 'Access-Control-Allow-Origin': origin } : {}) }
  const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...headers, 'Content-Type': 'application/json' } })
  if (req.method === 'OPTIONS') return new Response('ok', { headers })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  if (origin && origin !== 'https://hyperionmaritime.org') return json({ error: 'Origin not allowed.' }, 403)

  const url = Deno.env.get('SUPABASE_URL')
  const anon = Deno.env.get('SUPABASE_ANON_KEY')
  const service = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  if (!url || !anon || !service) return json({ error: 'Account deletion is not configured. Please contact support.' }, 500)

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Please sign in first.' }, 401)
  const userClient = createClient(url, anon, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Your session is invalid or expired. Please sign in again.' }, 401)

  let body: { confirmation?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request.' }, 400) }
  if (body.confirmation !== 'DELETE') return json({ error: 'Please confirm account deletion.' }, 400)

  const admin = createClient(url, service, { auth: { persistSession: false, autoRefreshToken: false } })

  // Remove user-owned entitlements first because they reference orders with RESTRICT.
  const { error: entitlementsError } = await admin.from('entitlements').delete().eq('user_id', user.id)
  if (entitlementsError) return json({ error: 'Could not remove your linked licenses. No account deletion was completed. Please contact support.' }, 500)

  const { error: ordersError } = await admin.from('orders').delete().eq('user_id', user.id)
  if (ordersError) return json({ error: 'Could not remove your payment submissions. Account deletion was not completed. Please contact support.' }, 500)

  const { error: deleteUserError } = await admin.auth.admin.deleteUser(user.id)
  if (deleteUserError) return json({ error: 'Your account data was processed, but the authentication account could not be deleted. Please contact support to complete the request.' }, 500)

  return json({ success: true })
})
