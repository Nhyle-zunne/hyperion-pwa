import { createClient } from 'npm:@supabase/supabase-js@2'
import { isAcceptedStoredPrice } from '../_shared/paymentPrices.mjs'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const products = {
  oic_nw: { track: 'DECK_OIC_NW', name: 'Deck OIC-NW' },
  gmdss: { track: 'GMDSS_GOC', name: 'GMDSS GOC' },
  engine_ew: { track: 'ENGINE_OIC_EW', name: 'Engine OIC-EW' },
  deck_mgt: { track: 'DECK_MGT', name: 'Deck Management' },
  engine_mgt: { track: 'ENGINE_MGT', name: 'Engine Management' }
} as const
type ProductCode = keyof typeof products
type LicenseTerm = 'week' | 'month' | 'year'

function expiryForTerm(base: Date, term: LicenseTerm) {
  const result = new Date(base)
  if (term === 'week') {
    result.setUTCDate(result.getUTCDate() + 7)
    return result
  }
  if (term === 'month') {
    const originalDay = result.getUTCDate()
    result.setUTCDate(1)
    result.setUTCMonth(result.getUTCMonth() + 1)
    const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate()
    result.setUTCDate(Math.min(originalDay, lastDay))
    return result
  }
  const originalMonth = result.getUTCMonth()
  const originalDay = result.getUTCDate()
  result.setUTCDate(1)
  result.setUTCFullYear(result.getUTCFullYear() + 1)
  result.setUTCMonth(originalMonth)
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), originalMonth + 1, 0)).getUTCDate()
  result.setUTCDate(Math.min(originalDay, lastDay))
  return result
}

function profileName(user: any) {
  const metadata = user.user_metadata ?? {}
  const given = [metadata.given_name, metadata.family_name]
    .filter((value: unknown) => typeof value === 'string' && value.trim().length > 0).join(' ')
  return [metadata.full_name, metadata.name, given]
    .find((value: unknown) => typeof value === 'string' && value.trim().length > 0) || null
}

async function readCheckout(paymongoKey: string, sessionId: string) {
  const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(sessionId)}`, {
    headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}` },
    signal: AbortSignal.timeout(8000)
  })
  const result = await response.json()
  return { response, session: result?.data, message: result?.errors?.[0]?.detail }
}

async function grantOrder(admin: any, order: any) {
  const { data: existing, error: lookupError } = await admin.from('entitlements')
    .select('order_id,status,expires_at')
    .eq('user_id', order.user_id).eq('product_code', order.product_code).maybeSingle()
  if (lookupError) throw new Error('Could not check current entitlement')

  if (existing?.order_id === order.id && existing.status === 'active' && existing.expires_at) {
    return new Date(existing.expires_at).toISOString()
  }

  const now = new Date()
  const oldExpiry = existing?.status === 'active' && existing.expires_at ? new Date(existing.expires_at) : null
  const base = oldExpiry && oldExpiry.getTime() > now.getTime() ? oldExpiry : now
  const term: LicenseTerm = order.license_term === 'week' || order.license_term === 'month' ? order.license_term : 'year'
  const expiresAt = expiryForTerm(base, term)
  const { error: grantError } = await admin.from('entitlements').upsert({
    user_id: order.user_id,
    product_code: order.product_code,
    track_id: order.track_id,
    order_id: order.id,
    license_term: term,
    status: 'active',
    granted_at: now.toISOString(),
    renewed_at: now.toISOString(),
    expires_at: expiresAt.toISOString()
  }, { onConflict: 'user_id,product_code' })
  if (grantError) throw new Error('Could not grant entitlement')
  return expiresAt.toISOString()
}

// Warm-worker optimization only: database finalization remains authoritative
// across workers and webhook deliveries. Authentication is never cached.
const activeVerifications = new Map<string, Promise<Response>>()
const pendingVerifications = new Map<string, { until: number; response: Response }>()
const MAX_VERIFICATION_ENTRIES = 128
async function verifyOnce(key: string, work: () => Promise<Response>): Promise<Response> {
  const now = performance.now()
  for (const [key, entry] of pendingVerifications) if (entry.until <= now) pendingVerifications.delete(key)
  const pending = pendingVerifications.get(key)
  if (pending) return pending.response.clone()
  const active = activeVerifications.get(key)
  if (active) return (await active).clone()
  // Keep memory bounded without rejecting an otherwise valid payment check.
  if (activeVerifications.size >= MAX_VERIFICATION_ENTRIES) return work()
  const operation = (async () => {
    const response = await work()
    if (response.status === 200) {
      const result = await response.clone().json().catch(() => null)
      // Only a fully validated pending result may briefly absorb repeated reads.
      // Paid/error responses are never retained; delayed webhooks stay authoritative.
      if (result?.status === 'pending') {
        if (pendingVerifications.size >= MAX_VERIFICATION_ENTRIES) {
          pendingVerifications.delete(pendingVerifications.keys().next().value!)
        }
        pendingVerifications.set(key, { until: performance.now() + 2000, response })
      }
    }
    return response
  })()
  activeVerifications.set(key, operation)
  try { return (await operation).clone() }
  finally { if (activeVerifications.get(key) === operation) activeVerifications.delete(key) }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store, private' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paymongoKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  const expectedMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Payment service is not configured.' }, 503)
  if (!paymongoKey || (expectedMode !== 'true' && expectedMode !== 'false')) return json({ error: 'PayMongo checkout verification is not configured yet.' }, 503)
  if ((expectedMode === 'true' && !paymongoKey.startsWith('sk_live_')) || (expectedMode === 'false' && !paymongoKey.startsWith('sk_test_'))) {
    return json({ error: 'The PayMongo API key does not match the configured test/live mode.' }, 503)
  }

  const authorization = req.headers.get('Authorization')
  if (!authorization) return json({ error: 'Please sign in first.' }, 401)
  const userClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authorization } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: authError } = await userClient.auth.getUser()
  if (authError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { orderId?: string }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  if (!body.orderId || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.orderId)) {
    return json({ error: 'Invalid checkout order.' }, 400)
  }

  // Fresh auth and request validation above precede every cache/coalescing lookup.
  return verifyOnce(`${user.id}:${body.orderId}:${expectedMode}`, async () => {
    const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

    // Basket checkout: one PayMongo session, one child order and entitlement per selected track.
    const { data: batch, error: batchError } = await admin.from('checkout_batches').select('id,user_id,product_codes,license_terms,amount_php,status,payment_method,paymongo_checkout_session_id,customer_name,customer_company,customer_school')
      .eq('id', body.orderId).eq('user_id', user.id).maybeSingle()
    if (batchError) return json({ error: 'Could not look up your basket checkout.' }, 500)
    if (batch) {
      const codes = (batch.product_codes ?? []) as string[]
      const batchTerms = (batch.license_terms ?? codes.map(() => 'year')) as string[]
      const trackedBatchMethod = batch.payment_method === 'PayMongo Checkout' ||
        (batch.status === 'paid' && typeof batch.payment_method === 'string' && batch.payment_method.startsWith('PayMongo ·'))
      if (!trackedBatchMethod || !batch.paymongo_checkout_session_id || !Array.isArray(batch.product_codes) || !codes.length ||
          codes.length > Object.keys(products).length || codes.some(code => !(code in products)) ||
          new Set(codes).size !== codes.length || batchTerms.length !== codes.length ||
          batchTerms.some(term => term !== 'week' && term !== 'month' && term !== 'year')) {
        return json({ error: 'This basket contains invalid product information. Contact Hyperion support.' }, 409)
      }
      if (batch.status === 'paid') {
        return json({ status: 'paid', orderId: batch.id, productCodes: codes, totalPhp: batch.amount_php })
      }
      if (!['pending', 'failed', 'cancelled'].includes(batch.status) || !batch.paymongo_checkout_session_id) {
        return json({ error: 'This basket checkout is no longer pending.' }, 409)
      }

      const { data: childOrders, error: childError } = await admin.from('orders').select('product_code,track_id,currency,license_term,amount_php')
        .eq('checkout_batch_id', batch.id).eq('user_id', user.id)
      if (childError || !childOrders) return json({ error: 'Could not load the products in this basket.' }, 500)
      const childCodes = childOrders.map((order: any) => order.product_code).sort()
      const expectedCodes = [...codes].sort()
      const childTotal = childOrders.reduce((sum: number, order: any) => sum + Number(order.amount_php), 0)
      const termByCode = Object.fromEntries(codes.map((code, index) => [code, batchTerms[index]])) as Record<string, LicenseTerm>
      if (childOrders.length !== codes.length || childCodes.some((code: string, i: number) => code !== expectedCodes[i]) ||
          childOrders.some((order: any) => order.track_id !== (products as any)[order.product_code]?.track || order.currency !== 'PHP' ||
            order.license_term !== termByCode[order.product_code] || !isAcceptedStoredPrice(order.product_code, termByCode[order.product_code], Number(order.amount_php))) ||
          childTotal !== batch.amount_php) {
        return json({ error: 'The basket order does not match its stored products and total. No license was granted.' }, 409)
      }

      let response: Response, checkoutSession: any
      try {
        const result = await readCheckout(paymongoKey, batch.paymongo_checkout_session_id)
        response = result.response
        checkoutSession = result.session
      } catch {
        return json({ error: 'Could not verify the payment with PayMongo. Refresh status shortly.' }, 502)
      }
      if (!response.ok) return json({ error: 'PayMongo could not verify this basket checkout. Please try again.' }, 502)
      const attributes = checkoutSession?.attributes
      const sortedMetadataCodes = typeof attributes?.metadata?.product_codes === 'string'
        ? attributes.metadata.product_codes.split(',').filter(Boolean).sort()
        : []
      const expectedMetadataTerms = codes.map((code, index) => `${code}:${batchTerms[index]}`).sort().join(',')
      const metadataTerms = typeof attributes?.metadata?.product_terms === 'string' ? attributes.metadata.product_terms.split(',').sort().join(',') : ''
      if (checkoutSession?.id !== batch.paymongo_checkout_session_id ||
          attributes?.livemode !== (expectedMode === 'true') ||
          attributes?.reference_number !== batch.id ||
          (attributes?.metadata?.batch_id !== batch.id && attributes?.metadata?.order_id !== batch.id) ||
          attributes?.metadata?.user_id !== user.id ||
          sortedMetadataCodes.join(',') !== expectedCodes.join(',') ||
          (metadataTerms ? metadataTerms !== expectedMetadataTerms : batchTerms.some(term => term !== 'year'))) {
        return json({ error: 'PayMongo details did not match this basket. No license was granted.' }, 409)
      }

      const payments = Array.isArray(attributes?.payments) ? attributes.payments : []
      const paidPayment = payments.find((payment: any) => payment?.attributes?.status === 'paid')
      if (!paidPayment) {
        return json({ status: 'pending', orderId: batch.id, productCodes: codes, message: 'PayMongo has not confirmed this basket as paid yet.' })
      }
      const paymentAttrs = paidPayment.attributes
      if (paymentAttrs?.currency !== 'PHP' || Number(paymentAttrs?.amount) !== Number(batch.amount_php) * 100) {
        return json({ error: 'The confirmed payment total or currency does not match this basket. No license was granted.' }, 409)
      }

      const profile = user.user_metadata ?? {}
      const fallbackName = profileName(user) || attributes?.billing?.name || paymentAttrs?.billing?.name || batch.customer_name || null
      const fallbackCompany = typeof profile.company === 'string' && profile.company.trim() ? profile.company : batch.customer_company || null
      const fallbackSchool = typeof profile.school === 'string' && profile.school.trim() ? profile.school : batch.customer_school || null
      const source = paymentAttrs?.source?.type || paymentAttrs?.source?.attributes?.type || 'Checkout'
      const { data: finalized, error: finalizeError } = await admin.rpc('finalize_paymongo_checkout', {
        p_checkout_reference: batch.id,
        p_checkout_session_id: batch.paymongo_checkout_session_id,
        p_payment_id: paidPayment.id,
        p_payment_method: `PayMongo · ${String(source).slice(0, 80)}`,
        p_currency: paymentAttrs?.currency,
        p_amount_minor: Number(paymentAttrs?.amount),
        p_customer_name: fallbackName,
        p_customer_company: fallbackCompany,
        p_customer_school: fallbackSchool
      })
      if (finalizeError || !finalized) {
        console.error('[verify-checkout] Atomic basket finalization failed', JSON.stringify({ orderId: batch.id, code: finalizeError?.code || 'no_result' }))
        return json({ error: 'PayMongo confirmed payment, but Hyperion could not finalize the basket. Please refresh status or contact support with your order ID.' }, 500)
      }
      if (finalized.status === 'reconciliation_required') {
        return json({ error: 'PayMongo confirmed payment, but this payment needs reconciliation. Contact Hyperion support with your order ID.' }, 409)
      }
      if (finalized.duplicatePayment) {
        console.error('[verify-checkout] Additional paid transaction needs reconciliation', JSON.stringify({ orderId: batch.id, paymentId: paidPayment.id }))
      }
      return json(finalized)
    }

    // Backward-compatible path for checkouts created before basket checkout was introduced.
    const { data: order, error: orderError } = await admin.from('orders')
      .select('id,user_id,product_code,track_id,license_term,amount_php,currency,status,payment_method,paymongo_checkout_session_id,customer_name,customer_company,customer_school').eq('id', body.orderId).eq('user_id', user.id).maybeSingle()
    if (orderError || !order) return json({ error: 'Checkout order not found for your account.' }, 404)
    const trackedOrderMethod = order.payment_method === 'PayMongo Checkout' ||
      (order.status === 'paid' && typeof order.payment_method === 'string' && order.payment_method.startsWith('PayMongo ·'))
    if (!trackedOrderMethod || !order.paymongo_checkout_session_id) {
      return json({ error: 'This order is not a tracked PayMongo checkout.' }, 409)
    }
    if (order.status === 'paid') {
      return json({ status: 'paid', orderId: order.id, productCode: order.product_code, trackId: order.track_id, productCodes: [order.product_code] })
    }
    if (!['pending', 'failed', 'cancelled'].includes(order.status)) return json({ error: 'This checkout order is no longer pending.' }, 409)
    if (!products[order.product_code as ProductCode] || products[order.product_code as ProductCode].track !== order.track_id || order.currency !== 'PHP') {
      return json({ error: 'The order product or currency does not match Hyperion’s product catalogue.' }, 409)
    }

    let response: Response, checkoutSession: any
    try {
      const result = await readCheckout(paymongoKey, order.paymongo_checkout_session_id)
      response = result.response
      checkoutSession = result.session
    } catch {
      return json({ error: 'Could not verify the payment with PayMongo. Refresh status shortly.' }, 502)
    }
    if (!response.ok) return json({ error: 'PayMongo could not verify this checkout. Check the API key and try refreshing status.' }, 502)

    const attributes = checkoutSession?.attributes
    if (checkoutSession?.id !== order.paymongo_checkout_session_id ||
        attributes?.livemode !== (expectedMode === 'true') ||
        attributes?.reference_number !== order.id ||
        attributes?.metadata?.order_id !== order.id ||
        attributes?.metadata?.user_id !== order.user_id ||
        attributes?.metadata?.product_code !== order.product_code ||
        (attributes?.metadata?.license_term && attributes.metadata.license_term !== (order.license_term || 'year'))) {
      return json({ error: 'PayMongo checkout details did not match this order. No license was granted.' }, 409)
    }
    const payments = Array.isArray(attributes?.payments) ? attributes.payments : []
    const paidPayment = payments.find((payment: any) => payment?.attributes?.status === 'paid')
    if (!paidPayment) return json({ status: 'pending', orderId: order.id, productCode: order.product_code, message: 'PayMongo has not confirmed a paid transaction for this checkout yet.' })
    const orderTerm: LicenseTerm = order.license_term === 'week' || order.license_term === 'month' ? order.license_term : 'year'
    if (!isAcceptedStoredPrice(order.product_code, orderTerm, Number(order.amount_php)) ||
        paidPayment.attributes?.currency !== 'PHP' || Number(paidPayment.attributes?.amount) !== Number(order.amount_php) * 100) {
      return json({ error: 'The confirmed payment amount or currency does not match this order. No license was granted.' }, 409)
    }

    const source = paidPayment.attributes?.source?.type || paidPayment.attributes?.source?.attributes?.type || 'Checkout'
    const billingName = attributes?.billing?.name || paidPayment.attributes?.billing?.name || null
    const metadata = user.user_metadata ?? {}
    const customerCompany = typeof metadata.company === 'string' && metadata.company.trim() ? metadata.company : order.customer_company || null
    const customerSchool = typeof metadata.school === 'string' && metadata.school.trim() ? metadata.school : order.customer_school || null
    const { data: finalized, error: finalizeError } = await admin.rpc('finalize_paymongo_checkout', {
      p_checkout_reference: order.id,
      p_checkout_session_id: order.paymongo_checkout_session_id,
      p_payment_id: paidPayment.id,
      p_payment_method: `PayMongo · ${String(source).slice(0, 80)}`,
      p_currency: paidPayment.attributes?.currency,
      p_amount_minor: Number(paidPayment.attributes?.amount),
      p_customer_name: order.customer_name || profileName(user) || billingName,
      p_customer_company: customerCompany,
      p_customer_school: customerSchool
    })
    if (finalizeError || !finalized) {
      console.error('[verify-checkout] Atomic order finalization failed', JSON.stringify({ orderId: order.id, code: finalizeError?.code || 'no_result' }))
      return json({ error: 'Payment was confirmed, but Hyperion could not finalize the license. Please refresh status or contact support with your order ID.' }, 500)
    }
    if (finalized.status === 'reconciliation_required') {
      return json({ error: 'PayMongo confirmed payment, but this payment needs reconciliation. Contact Hyperion support with your order ID.' }, 409)
    }
    if (finalized.duplicatePayment) {
      console.error('[verify-checkout] Additional paid transaction needs reconciliation', JSON.stringify({ orderId: order.id, paymentId: paidPayment.id }))
    }
    return json(finalized)
  })
})
