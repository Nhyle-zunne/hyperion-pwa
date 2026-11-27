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
  if (!authorization) return json({ error: 'Please sign in with Google to continue.' }, 401)
  let body: { selection?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid checkout selection.' }, 400) }
  if (typeof body.selection !== 'string' || !body.selection.trim() || body.selection.length > 200) {
    return json({ error: 'Invalid checkout selection.' }, 400)
  }
  const url = Deno.env.get('SUPABASE_URL')!
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')!
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const authClient = createClient(url, anonKey, {
    global: { headers: { Authorization: authorization } }, auth: { persistSession: false },
  })
  const { data: { user }, error: authError } = await authClient.auth.getUser()
  if (authError || !user?.id || !user.email) return json({ error: 'Sign in again to start checkout.' }, 401)
  const hasGoogleIdentity = user.identities?.some(identity => identity.provider === 'google') ||
    user.app_metadata?.provider === 'google' ||
    (Array.isArray(user.app_metadata?.providers) && user.app_metadata.providers.includes('google'))
  if (!hasGoogleIdentity) return json({ error: 'Sign in with your Google account before submitting payment.' }, 403)

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } })
  const { data, error } = await admin.rpc('create_manual_checkout_claim_unique_tracks', {
    p_user_id: user.id, p_selection: body.selection,
  })
  if (error || !data) {
    if (error?.code === '22023') return json({ error: 'Invalid checkout selection. Please choose your tracks again.' }, 400)
    if (error?.message?.includes('Website checkout is disabled')) return json({ error: 'Checkout is temporarily unavailable.' }, 403)
    if (error?.message?.includes('Too many open payment claims')) {
      return json({ error: 'You have three open submissions. Please contact Hyperion on Messenger to resolve them before starting another.' }, 409)
    }
    if (error?.message?.includes('A payment request is already pending')) {
      return json({ error: 'You already have a pending request for this track. Do not pay again. View your payment history instead.' }, 409)
    }
    console.error('[create-manual-checkout-claim] Could not create claim', error?.code || 'unknown')
    return json({ error: 'Could not prepare the payment submission. Please retry.' }, 500)
  }
  return json({ id: data.id, status: data.status, totalAmountPhp: data.total_amount_php })
})
