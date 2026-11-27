import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Max-Age': '86400',
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...cors, 'Content-Type': 'application/json' },
})

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed.' }, 405)
  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Sign in to manage your payment requests.' }, 401)
  let body: { claimId?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid payment request.' }, 400) }
  if (typeof body.claimId !== 'string' ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(body.claimId)) {
    return json({ error: 'Invalid payment request.' }, 400)
  }

  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user?.id || !user.email) return json({ error: 'Please sign in again.' }, 401)
  const hasGoogleIdentity = user.identities?.some(identity => identity.provider === 'google') ||
    user.app_metadata?.provider === 'google' ||
    (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.includes('google'))
  if (!hasGoogleIdentity) return json({ error: 'Sign in with Google to manage this request.' }, 403)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('cancel_manual_checkout_claim', {
    p_user_id: user.id, p_claim_id: body.claimId,
  })
  if (error || !data) {
    if (error?.code === 'P0002') return json({ error: 'Payment request not found.' }, 404)
    if (error?.code === '23514') return json({ error: 'This request is already under review or closed. Please contact Hyperion on Messenger.' }, 409)
    if (error?.code === '22023') return json({ error: 'Invalid payment request.' }, 400)
    console.error('[cancel-manual-checkout-claim] Cancellation failed', error?.code || 'unknown')
    return json({ error: 'Could not cancel this request. Please try again.' }, 500)
  }
  return json({ status: data.status, claimId: data.claimId })
})
