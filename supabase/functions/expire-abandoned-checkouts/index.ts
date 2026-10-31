import { createClient } from 'npm:@supabase/supabase-js@2'

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }
  })

type CheckoutRecord = {
  id: string
  user_id: string
  status: string
  payment_method: string
  created_at: string
  paymongo_checkout_session_id: string
  amount_php: number
  currency: string
  customer_name: string | null
  customer_company: string | null
  customer_school: string | null
  product_code?: string
  license_term?: string
  product_codes?: string[]
  license_terms?: string[]
}

type CheckoutSession = {
  id?: string
  attributes?: {
    status?: string
    metadata?: Record<string, unknown>
    reference_number?: string
    payments?: Array<{ id?: string; attributes?: Record<string, any> }>
    billing?: { name?: string | null }
  }
}

const settledPaymentStates = new Set(['failed', 'cancelled', 'expired'])
const inFlightPaymentStates = new Set([
  'pending', 'processing', 'awaiting_next_action', 'requires_action', 'awaiting_payment'
])

function paymentList(session: CheckoutSession) {
  return Array.isArray(session.attributes?.payments) ? session.attributes!.payments! : []
}

function hasInFlightOrUnknownPayment(session: CheckoutSession) {
  return paymentList(session).some(payment => {
    const state = String(payment?.attributes?.status ?? '').toLowerCase()
    return state !== 'paid' && state !== 'succeeded' && !settledPaymentStates.has(state)
  })
}

function paidPayment(session: CheckoutSession) {
  return paymentList(session).find(payment => {
    const state = String(payment?.attributes?.status ?? '').toLowerCase()
    return state === 'paid' || state === 'succeeded'
  }) ?? null
}

function metadataMatches(record: CheckoutRecord, session: CheckoutSession, isBatch: boolean) {
  const attrs = session.attributes
  const meta = attrs?.metadata
  if (!attrs || !meta || session.id !== record.paymongo_checkout_session_id) return false

  if (isBatch) {
    const codes = record.product_codes ?? []
    const terms = record.license_terms ?? []
    const metaCodes = typeof meta.product_codes === 'string' ? meta.product_codes.split(',').filter(Boolean) : []
    const expectedTerms = codes.map((code, i) => code + ':' + (terms[i] ?? 'year')).sort().join(',')
    const metaTerms = typeof meta.product_terms === 'string' ? meta.product_terms.split(',').filter(Boolean).sort().join(',') : ''

    return (meta.batch_id === record.id || meta.order_id === record.id)
      && meta.user_id === record.user_id
      && metaCodes.slice().sort().join(',') === codes.slice().sort().join(',')
      && (metaTerms ? metaTerms === expectedTerms : terms.every(term => term === 'year'))
      && (attrs.reference_number === undefined || attrs.reference_number === record.id)
  }

  return meta.order_id === record.id
    && meta.user_id === record.user_id
    && meta.product_code === record.product_code
    && (!meta.license_term || meta.license_term === (record.license_term ?? 'year'))
    && (attrs.reference_number === undefined || attrs.reference_number === record.id)
}

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paymongoKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  const expectedLiveMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  const keyMatchesMode = Boolean(paymongoKey && (
    (expectedLiveMode === 'true' && paymongoKey.startsWith('sk_live_')) ||
    (expectedLiveMode === 'false' && paymongoKey.startsWith('sk_test_'))
  ))
  if (!supabaseUrl || !serviceKey || !paymongoKey || !keyMatchesMode) {
    console.error('[expire-abandoned-checkouts] Required payment configuration is missing or inconsistent')
    return json({ error: 'Scheduled payment cleanup is not configured safely.' }, 503)
  }

  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { autoRefreshToken: false, persistSession: false }
  })
  const providedToken = req.headers.get('x-hyperion-cron-token') ?? ''
  const tokenCheck = await admin.rpc('verify_abandoned_checkout_cron_token', {
    p_token: providedToken
  })
  if (tokenCheck.error || tokenCheck.data !== true) return json({ error: 'Unauthorized scheduled job.' }, 401)

  const basicAuth = 'Basic ' + btoa(paymongoKey + ':')
  const cutoff = new Date(Date.now() - 12 * 60 * 60 * 1000).toISOString()
  const summary = { checked: 0, failed: 0, paidFinalized: 0, processing: 0, deferred: 0 }

  async function readSession(sessionId: string): Promise<CheckoutSession | null> {
    try {
      const response = await fetch('https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(sessionId), {
        headers: { Authorization: basicAuth, Accept: 'application/json' }
      })
      if (!response.ok) {
        console.warn('[expire-abandoned-checkouts] PayMongo lookup deferred', JSON.stringify({ httpStatus: response.status }))
        return null
      }
      const payload = await response.json()
      return payload?.data && typeof payload.data === 'object' ? payload.data as CheckoutSession : null
    } catch {
      console.warn('[expire-abandoned-checkouts] PayMongo lookup failed; checkout remains pending')
      return null
    }
  }

  async function finalizePaid(record: CheckoutRecord, session: CheckoutSession, isBatch: boolean) {
    const payment = paidPayment(session)
    if (!payment?.id || !payment.attributes) return false
    const attrs = payment.attributes
    if (attrs.currency !== 'PHP' || Number(attrs.amount) !== Number(record.amount_php) * 100) {
      console.error('[expire-abandoned-checkouts] Paid amount/currency mismatch; order deferred for reconciliation')
      return false
    }

    const source = attrs?.source?.type || attrs?.source?.attributes?.type || 'Checkout'
    const result = await admin.rpc('finalize_paymongo_checkout', {
      p_checkout_reference: record.id,
      p_checkout_session_id: record.paymongo_checkout_session_id,
      p_payment_id: payment.id,
      p_payment_method: 'PayMongo · ' + String(source).slice(0, 80),
      p_currency: attrs.currency,
      p_amount_minor: Number(attrs.amount),
      p_customer_name: record.customer_name || session.attributes?.billing?.name || attrs?.billing?.name || null,
      p_customer_company: record.customer_company,
      p_customer_school: record.customer_school
    })
    if (result.error || !result.data || result.data.status !== 'paid') {
      console.error('[expire-abandoned-checkouts] Verified payment requires reconciliation', JSON.stringify({ isBatch, status: result.data?.status ?? 'rpc_error', code: result.error?.code ?? null }))
      return false
    }
    return true
  }

  async function markFailed(record: CheckoutRecord, isBatch: boolean) {
    const result = await admin.rpc('mark_abandoned_paymongo_checkout_failed', {
      p_checkout_reference: record.id,
      p_checkout_session_id: record.paymongo_checkout_session_id,
      p_is_batch: isBatch
    })
    if (result.error) {
      console.error('[expire-abandoned-checkouts] Failed to update expired checkout', JSON.stringify({ isBatch, code: result.error.code }))
      return false
    }
    if (result.data?.status === 'failed') return true
    if (result.data?.status === 'already_paid') {
      console.info('[expire-abandoned-checkouts] Checkout became paid during cleanup; preserved paid status')
      return false
    }
    return false
  }

  async function processCheckout(record: CheckoutRecord, isBatch: boolean) {
    summary.checked += 1
    const session = await readSession(record.paymongo_checkout_session_id)
    if (!session) {
      summary.deferred += 1
      return
    }
    if (!metadataMatches(record, session, isBatch)) {
      console.error('[expire-abandoned-checkouts] Checkout metadata mismatch; left order unchanged', JSON.stringify({ isBatch }))
      summary.deferred += 1
      return
    }

    if (paidPayment(session)) {
      if (await finalizePaid(record, session, isBatch)) summary.paidFinalized += 1
      else summary.deferred += 1
      return
    }

    if (hasInFlightOrUnknownPayment(session)) {
      summary.processing += 1
      return
    }

    let current = session
    const providerStatus = String(current.attributes?.status ?? '').toLowerCase()
    if (providerStatus === 'active') {
      try {
        await fetch('https://api.paymongo.com/v1/checkout_sessions/' + encodeURIComponent(record.paymongo_checkout_session_id) + '/expire', {
          method: 'POST',
          headers: { Authorization: basicAuth, Accept: 'application/json' }
        })
      } catch {
        // Always re-read the provider state before deciding whether the local order can fail.
      }
      const latest = await readSession(record.paymongo_checkout_session_id)
      if (!latest || !metadataMatches(record, latest, isBatch)) {
        summary.deferred += 1
        return
      }
      current = latest
      if (paidPayment(current)) {
        if (await finalizePaid(record, current, isBatch)) summary.paidFinalized += 1
        else summary.deferred += 1
        return
      }
      if (hasInFlightOrUnknownPayment(current)) {
        summary.processing += 1
        return
      }
    }

    // Do not infer abandonment from age alone. Fail only after PayMongo confirms
    // the session expired and no payment is in flight or has succeeded.
    if (String(current.attributes?.status ?? '').toLowerCase() !== 'expired') {
      summary.deferred += 1
      return
    }
    if (await markFailed(record, isBatch)) summary.failed += 1
    else summary.deferred += 1
  }

  try {
    const [batchResult, orderResult] = await Promise.all([
      admin.from('checkout_batches')
        .select('id,user_id,status,payment_method,created_at,paymongo_checkout_session_id,amount_php,currency,customer_name,customer_company,customer_school,product_codes,license_terms')
        .eq('status', 'pending')
        .eq('payment_method', 'PayMongo Checkout')
        .lt('created_at', cutoff)
        .not('paymongo_checkout_session_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(25),
      admin.from('orders')
        .select('id,user_id,status,payment_method,created_at,paymongo_checkout_session_id,amount_php,currency,customer_name,customer_company,customer_school,product_code,license_term')
        .eq('status', 'pending')
        .eq('payment_method', 'PayMongo Checkout')
        .is('checkout_batch_id', null)
        .lt('created_at', cutoff)
        .not('paymongo_checkout_session_id', 'is', null)
        .order('created_at', { ascending: true })
        .limit(25)
    ])
    if (batchResult.error || orderResult.error) {
      console.error('[expire-abandoned-checkouts] Could not query pending checkouts', JSON.stringify({
        batches: batchResult.error?.code ?? null,
        orders: orderResult.error?.code ?? null
      }))
      return json({ error: 'Could not load pending checkouts.', summary }, 500)
    }

    for (const batch of (batchResult.data ?? []) as CheckoutRecord[]) {
      await processCheckout(batch, true)
    }
    for (const order of (orderResult.data ?? []) as CheckoutRecord[]) {
      await processCheckout(order, false)
    }

    // Successful empty/normal cleanup is intentionally quiet. Failures, PayMongo
  // uncertainty, and payment races above retain their warning/error logs.
    return json({ status: 'ok', cutoff, summary })
  } catch {
    console.error('[expire-abandoned-checkouts] Cleanup interrupted')
    return json({ error: 'Scheduled cleanup was interrupted.', summary }, 500)
  }
})
