import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS'
}

const productOrder = ['oic_nw', 'gmdss', 'engine_ew', 'deck_mgt', 'engine_mgt'] as const
const products = {
  oic_nw: { env: 'PRICE_DECK_OIC_NW_PHP', name: 'Hyperion Deck OIC-NW', track: 'DECK_OIC_NW' },
  gmdss: { env: 'PRICE_GMDSS_PHP', name: 'Hyperion GMDSS GOC', track: 'GMDSS_GOC' },
  engine_ew: { env: 'PRICE_ENGINE_EW_PHP', name: 'Hyperion Engine OIC-EW', track: 'ENGINE_OIC_EW' },
  deck_mgt: { env: 'PRICE_DECK_MGT_PHP', name: 'Hyperion Deck Management', track: 'DECK_MGT' },
  engine_mgt: { env: 'PRICE_ENGINE_MGT_PHP', name: 'Hyperion Engine Management', track: 'ENGINE_MGT' },
} as const

function profileFor(user: any) {
  const metadata = user.user_metadata ?? {}
  const identityNames = (user.identities ?? [])
    .filter((identity: any) => identity.provider === 'google')
    .map((identity: any) => {
      const identityData = identity.identity_data as Record<string, unknown> | null
      return identityData?.full_name ?? identityData?.name
    })
  const metadataGivenName = [metadata.given_name, metadata.family_name]
    .filter((value: unknown) => typeof value === 'string' && value.trim().length > 0)
    .join(' ')
  const emailName = (user.email?.split('@')[0] ?? '').replace(/[._+-]+/g, ' ').replace(/\s+/g, ' ').trim()
    .replace(/\b\w/g, (letter: string) => letter.toUpperCase())
  const customerName = [
    metadata.full_name, metadata.name, metadataGivenName, ...identityNames, emailName
  ].find((value: unknown) => typeof value === 'string' && value.trim().length > 0)?.trim().slice(0, 160) ?? null
  return {
    customerName,
    customerCompany: typeof metadata.company === 'string' ? metadata.company.trim().slice(0, 160) : null,
    customerSchool: typeof metadata.school === 'string' ? metadata.school.trim().slice(0, 160) : null,
  }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)

  const supabaseUrl = Deno.env.get('SUPABASE_URL')
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY')
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const paymongoKey = Deno.env.get('PAYMONGO_SECRET_KEY')
  const checkoutEnabled = Deno.env.get('PAYMONGO_CHECKOUT_ENABLED') === 'true'
  const expectedLiveMode = Deno.env.get('PAYMONGO_EXPECT_LIVEMODE')
  if (!supabaseUrl || !anonKey || !serviceKey) return json({ error: 'Payment service is not configured. Contact Hyperion support.' }, 503)
  if (!checkoutEnabled) return json({ error: 'PayMongo checkout is not enabled yet. Please use manual payment for now.' }, 503)
  if (!paymongoKey || (expectedLiveMode !== 'true' && expectedLiveMode !== 'false')) return json({ error: 'PayMongo checkout is not fully configured yet. Please use manual payment for now.' }, 503)
  if ((expectedLiveMode === 'true' && !paymongoKey.startsWith('sk_live_')) || (expectedLiveMode === 'false' && !paymongoKey.startsWith('sk_test_'))) {
    return json({ error: 'The PayMongo key does not match the configured payment mode. Please contact Hyperion support.' }, 503)
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) return json({ error: 'Please sign in first.' }, 401)
  const authClient = createClient(supabaseUrl, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false }
  })
  const { data: { user }, error: userError } = await authClient.auth.getUser()
  if (userError || !user) return json({ error: 'Your session is invalid. Please sign in again.' }, 401)

  let body: { productCode?: string; productCodes?: unknown }
  try { body = await req.json() } catch { return json({ error: 'Invalid request body.' }, 400) }
  const inputCodes = Array.isArray(body.productCodes)
    ? body.productCodes
    : body.productCode ? [body.productCode] : []
  if (!inputCodes.length || inputCodes.some((code: unknown) => typeof code !== 'string' || !productOrder.includes(code as typeof productOrder[number]))) {
    return json({ error: 'Select at least one valid reviewer track.' }, 400)
  }
  const codes = productOrder.filter(code => inputCodes.includes(code))
  if (codes.length !== inputCodes.length || codes.length > productOrder.length) {
    return json({ error: 'Your basket contains duplicate or invalid products. Please review it and try again.' }, 400)
  }

  const profile = profileFor(user)
  const productPrices: Record<string, number> = {}
  for (const code of codes) {
    const price = Number(Deno.env.get(products[code].env))
    if (!Number.isSafeInteger(price) || price <= 0) {
      return json({ error: `Price for ${code} is not configured. Please contact Hyperion support.` }, 503)
    }
    productPrices[code] = price
  }
  const totalPrice = codes.reduce((sum, code) => sum + productPrices[code], 0)

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false } })

  // Preserve compatibility with an older single-track checkout already created before
  // basket checkout was introduced. Never open a second charge for that same product.
  if (codes.length === 1) {
    const code = codes[0]
    const { data: legacyOrder, error: legacyError } = await admin.from('orders')
      .select('id,paymongo_checkout_session_id')
      .eq('user_id', user.id).eq('product_code', code).eq('status', 'pending')
      .eq('payment_method', 'PayMongo Checkout').is('checkout_batch_id', null)
      .not('paymongo_checkout_session_id', 'is', null)
      .order('created_at', { ascending: false }).limit(1).maybeSingle()
    if (legacyError) return json({ error: 'Could not check your existing checkout. Please retry.' }, 500)
    if (legacyOrder?.paymongo_checkout_session_id) {
      try {
        const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(legacyOrder.paymongo_checkout_session_id)}`, {
          headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}` }
        })
        const result = await response.json().catch(() => ({}))
        if (!response.ok) return json({ error: 'An earlier checkout is still pending. Refresh payment status before retrying.' }, 503)
        const attrs = result?.data?.attributes
        const payments = Array.isArray(attrs?.payments) ? attrs.payments : []
        if (payments.some((payment: any) => payment?.attributes?.status === 'paid')) {
          return json({ alreadyProcessing: true, orderId: legacyOrder.id, productCodes: codes })
        }
        if (attrs?.status === 'active' && typeof attrs?.checkout_url === 'string') {
          const url = new URL(attrs.checkout_url)
          if (url.protocol !== 'https:' || url.hostname !== 'checkout.paymongo.com') return json({ error: 'PayMongo returned an invalid checkout link.' }, 502)
          return json({ checkoutUrl: url.toString(), orderId: legacyOrder.id, productCodes: codes, reused: true })
        }
        if (attrs?.status === 'expired') {
          await admin.from('orders').update({ status: 'failed' }).eq('id', legacyOrder.id).eq('status', 'pending')
        } else {
          return json({ error: 'An earlier checkout is still open. Resume or safely cancel it before starting another payment.' }, 409)
        }
      } catch (error) {
        if (error instanceof TypeError) return json({ error: 'Could not contact PayMongo to check the previous checkout. Please retry.' }, 502)
        return json({ error: 'Could not safely check your previous checkout. Please retry.' }, 502)
      }
    }
  } else {
    const { data: legacyOrders, error: legacyError } = await admin.from('orders')
      .select('id,product_code')
      .eq('user_id', user.id).in('product_code', codes).eq('status', 'pending')
      .eq('payment_method', 'PayMongo Checkout').is('checkout_batch_id', null)
      .not('paymongo_checkout_session_id', 'is', null)
    if (legacyError) return json({ error: 'Could not check your previous checkout. Please retry.' }, 500)
    if (legacyOrders?.length) {
      return json({ error: 'An older single-track checkout is still open for one item in this basket. Resume or cancel that checkout first, then return to the basket.' }, 409)
    }
  }

  const { data: pendingBatches, error: pendingBatchError } = await admin.from('checkout_batches')
    .select('id,product_codes,paymongo_checkout_session_id')
    .eq('user_id', user.id).eq('status', 'pending')
    .order('created_at', { ascending: false }).limit(10)
  if (pendingBatchError) return json({ error: 'Could not check your previous basket checkout. Please retry.' }, 500)
  const newestPendingBatch = (pendingBatches ?? [])[0]
  const activePendingBatch = (pendingBatches ?? []).find(batch => batch.paymongo_checkout_session_id)
  if (newestPendingBatch && !newestPendingBatch.paymongo_checkout_session_id) {
    return json({ error: 'Your previous basket checkout is still being prepared. Wait a moment and then resume it from Pending checkouts.' }, 409)
  }
  if (activePendingBatch) {
    const pendingCodes = productOrder.filter(code => (activePendingBatch.product_codes ?? []).includes(code))
    if (pendingCodes.join(',') !== codes.join(',')) {
      return json({ error: 'You already have a checkout open for a different basket. Resume or cancel it before checking out these items.' }, 409)
    }
    try {
      const response = await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(activePendingBatch.paymongo_checkout_session_id)}`, {
        headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}` }
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) return json({ error: 'Could not check your existing PayMongo checkout. Please retry.' }, 502)
      const attrs = result?.data?.attributes
      const payments = Array.isArray(attrs?.payments) ? attrs.payments : []
      if (payments.some((payment: any) => payment?.attributes?.status === 'paid')) {
        return json({ alreadyProcessing: true, orderId: activePendingBatch.id, productCodes: codes })
      }
      if (attrs?.status === 'active' && typeof attrs?.checkout_url === 'string') {
        const url = new URL(attrs.checkout_url)
        if (url.protocol !== 'https:' || url.hostname !== 'checkout.paymongo.com') return json({ error: 'PayMongo returned an invalid checkout link.' }, 502)
        return json({ checkoutUrl: url.toString(), orderId: activePendingBatch.id, productCodes: codes, reused: true, isBatch: true })
      }
      if (attrs?.status === 'expired') {
        await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', activePendingBatch.id).eq('status', 'pending')
        await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', activePendingBatch.id).eq('status', 'pending')
      } else {
        return json({ error: 'This basket checkout is still open or processing. Resume it or refresh payment status before starting another payment.' }, 409)
      }
    } catch {
      return json({ error: 'Could not safely check your previous basket checkout. Please retry.' }, 502)
    }
  }

  for (const code of codes) {
    const { data: entitlement, error } = await admin.from('entitlements')
      .select('status,expires_at').eq('user_id', user.id).eq('product_code', code).maybeSingle()
    if (error) return json({ error: 'Could not check your current licenses. Please retry.' }, 500)
    if (entitlement?.status === 'active' && entitlement.expires_at && new Date(entitlement.expires_at).getTime() > Date.now()) {
      return json({ error: `${products[code].name} is already active for your account. Remove it from the basket before checkout.` }, 409)
    }
  }

  const { data: manualOrders, error: manualOrderError } = await admin.from('orders')
    .select('id,product_code,payment_method')
    .eq('user_id', user.id).in('product_code', codes).in('status', ['submitted','pending'])
  if (manualOrderError) return json({ error: 'Could not check existing payment submissions. Please retry.' }, 500)
  if (manualOrders?.some(order => order.payment_method !== 'PayMongo Checkout')) {
    const conflict = manualOrders.find(order => order.payment_method !== 'PayMongo Checkout')
    return json({ error: `You already have a manual payment waiting for review for ${products[conflict!.product_code as keyof typeof products]?.name ?? conflict!.product_code}. Complete or cancel that request before paying for it through PayMongo.` }, 409)
  }

  // Keep a single-track purchase on the original, previously working order flow.
  // Only multi-track baskets use checkout_batches and multiple line items.
  if (codes.length === 1) {
    const code = codes[0]
    const product = products[code]
    const price = productPrices[code]
    const { data: order, error: insertError } = await admin.from('orders').insert({
      user_id: user.id,
      product_code: code,
      track_id: product.track,
      amount_php: price,
      currency: 'PHP',
      status: 'pending',
      payment_method: 'PayMongo Checkout',
      customer_name: profile.customerName,
      customer_company: profile.customerCompany,
      customer_school: profile.customerSchool
    }).select('id').single()
    if (insertError || !order) return json({ error: 'Could not create your order. Please try again.' }, 500)

    const configuredBase = (Deno.env.get('APP_BASE_URL') || 'https://hyperionmaritime.org').replace(/\\/+$/, '')
    let appUrl: URL
    try { appUrl = new URL(configuredBase) } catch {
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({ error: 'The app return URL is not configured correctly.' }, 503)
    }
    if (appUrl.protocol !== 'https:' && !(appUrl.hostname === 'localhost' && appUrl.protocol === 'http:')) {
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({ error: 'The app return URL must use HTTPS.' }, 503)
    }

    const payload = {
      data: {
        attributes: {
          line_items: [{ name: product.name, amount: price * 100, currency: 'PHP', quantity: 1 }],
          billing: {
            ...(profile.customerName ? { name: profile.customerName } : {}),
            ...(user.email ? { email: user.email } : {})
          },
          payment_method_types: ['gcash', 'paymaya', 'qrph', 'card'],
          success_url: `${configuredBase}/checkout?payment=success&order_id=${encodeURIComponent(order.id)}&product_code=${encodeURIComponent(code)}`,
          cancel_url: `${configuredBase}/checkout?payment=cancelled&order_id=${encodeURIComponent(order.id)}&product_code=${encodeURIComponent(code)}`,
          reference_number: order.id,
          send_email_receipt: true,
          metadata: { order_id: order.id, user_id: user.id, product_code: code }
        }
      }
    }

    let response: Response
    let result: any
    try {
      response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
        method: 'POST',
        headers: {
          Authorization: `Basic ${btoa(paymongoKey + ':')}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
      })
      result = await response.json().catch(() => ({}))
    } catch {
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({ error: 'Could not connect to PayMongo. Please retry or use manual payment.' }, 502)
    }

    const checkoutUrl = result?.data?.attributes?.checkout_url
    const sessionId = result?.data?.id
    if (!response.ok || !checkoutUrl || !sessionId) {
      const providerErrors = Array.isArray(result?.errors)
        ? result.errors.map((item: any) => [item?.code, item?.detail].filter((value: unknown) => typeof value === 'string' && value.trim()).join(': ')).filter(Boolean).slice(0, 3).join(' ')
        : ''
      console.error('[create-checkout] PayMongo rejected single-track checkout', JSON.stringify({
        httpStatus: response.status,
        productCode: code,
        providerErrors: providerErrors || 'No error details returned'
      }))
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({
        error: providerErrors
          ? `PayMongo rejected checkout (HTTP ${response.status}): ${providerErrors}`
          : `PayMongo rejected checkout creation (HTTP ${response.status}). Check PayMongo API key and merchant payment-method settings.`
      }, 502)
    }

    let parsedCheckoutUrl: URL
    try { parsedCheckoutUrl = new URL(checkoutUrl) } catch {
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({ error: 'PayMongo returned an invalid checkout link.' }, 502)
    }
    if (parsedCheckoutUrl.protocol !== 'https:' || parsedCheckoutUrl.hostname !== 'checkout.paymongo.com') {
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({ error: 'PayMongo returned an unexpected checkout domain.' }, 502)
    }

    const { error: updateError } = await admin.from('orders')
      .update({ paymongo_checkout_session_id: sessionId, payment_reference: order.id })
      .eq('id', order.id).eq('status', 'pending')
    if (updateError) {
      await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(sessionId)}/expire`, {
        method: 'POST',
        headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}`, 'Content-Type': 'application/json' }
      }).catch(() => undefined)
      await admin.from('orders').update({ status: 'failed' }).eq('id', order.id)
      return json({ error: 'Checkout tracking could not be saved. Please retry or contact support.' }, 500)
    }

    return json({ checkoutUrl: parsedCheckoutUrl.toString(), orderId: order.id, productCodes: codes, isBatch: false })
  }

  const { data: batch, error: batchError } = await admin.from('checkout_batches').insert({
    user_id: user.id,
    product_codes: codes,
    amount_php: totalPrice,
    currency: 'PHP',
    status: 'pending',
    payment_method: 'PayMongo Checkout',
    customer_name: profile.customerName,
    customer_company: profile.customerCompany,
    customer_school: profile.customerSchool
  }).select('id').single()
  if (batchError || !batch) return json({ error: 'Could not create your basket order. Please try again.' }, 500)

  const childOrders = codes.map(code => ({
    user_id: user.id,
    product_code: code,
    track_id: products[code].track,
    amount_php: productPrices[code],
    currency: 'PHP',
    status: 'pending',
    payment_method: 'PayMongo Checkout',
    payment_reference: batch.id,
    checkout_batch_id: batch.id,
    customer_name: profile.customerName,
    customer_company: profile.customerCompany,
    customer_school: profile.customerSchool
  }))
  const { error: childInsertError } = await admin.from('orders').insert(childOrders)
  if (childInsertError) {
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    return json({ error: 'Could not add the basket items to your order. Please try again.' }, 500)
  }

  const configuredBase = (Deno.env.get('APP_BASE_URL') || 'https://hyperionmaritime.org').replace(/\/+$/, '')
  let appUrl: URL
  try { appUrl = new URL(configuredBase) } catch {
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({ error: 'The app return URL is not configured correctly.' }, 503)
  }
  if (appUrl.protocol !== 'https:' && !(appUrl.hostname === 'localhost' && appUrl.protocol === 'http:')) {
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({ error: 'The app return URL must use HTTPS.' }, 503)
  }

  const metadata = {
    order_id: batch.id,
    batch_id: batch.id,
    user_id: user.id,
    product_codes: codes.join(',')
  }
  const payload = {
    data: {
      attributes: {
        line_items: codes.map(code => ({ name: products[code].name, amount: productPrices[code] * 100, currency: 'PHP', quantity: 1 })),
        billing: {
          ...(profile.customerName ? { name: profile.customerName } : {}),
          ...(user.email ? { email: user.email } : {})
        },
        payment_method_types: ['gcash', 'paymaya', 'qrph', 'card'],
        success_url: `${configuredBase}/checkout?payment=success&order_id=${encodeURIComponent(batch.id)}&product_codes=${encodeURIComponent(codes.join(','))}`,
        cancel_url: `${configuredBase}/checkout?payment=cancelled&order_id=${encodeURIComponent(batch.id)}&product_codes=${encodeURIComponent(codes.join(','))}`,
        reference_number: batch.id,
        send_email_receipt: true,
        metadata
      }
    }
  }

  let response: Response
  let result: any
  try {
    response = await fetch('https://api.paymongo.com/v2/checkout_sessions', {
      method: 'POST',
      headers: {
        Authorization: `Basic ${btoa(paymongoKey + ':')}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    })
    result = await response.json().catch(() => ({}))
  } catch {
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({ error: 'Could not connect to PayMongo. Please retry or use manual payment.' }, 502)
  }

  const checkoutUrl = result?.data?.attributes?.checkout_url
  const sessionId = result?.data?.id
  if (!response.ok || !checkoutUrl || !sessionId) {
    const providerErrors = Array.isArray(result?.errors)
      ? result.errors.map((item: any) => [item?.code, item?.detail].filter((value: unknown) => typeof value === 'string' && value.trim()).join(': ')).filter(Boolean).slice(0, 3).join(' ')
      : ''
    console.error('[create-checkout] PayMongo rejected basket checkout', JSON.stringify({
      httpStatus: response.status,
      productCount: codes.length,
      productCodes: codes,
      providerErrors: providerErrors || 'No error details returned'
    }))
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({
      error: providerErrors
        ? `PayMongo rejected the basket checkout (HTTP ${response.status}): ${providerErrors}`
        : `PayMongo rejected basket checkout creation (HTTP ${response.status}). Check PayMongo API key and merchant payment-method settings.`
    }, 502)
  }

  let parsedCheckoutUrl: URL
  try { parsedCheckoutUrl = new URL(checkoutUrl) } catch {
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({ error: 'PayMongo returned an invalid checkout link.' }, 502)
  }
  if (parsedCheckoutUrl.protocol !== 'https:' || parsedCheckoutUrl.hostname !== 'checkout.paymongo.com') {
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({ error: 'PayMongo returned an unexpected checkout domain.' }, 502)
  }

  const { error: updateError } = await admin.from('checkout_batches')
    .update({ paymongo_checkout_session_id: sessionId, payment_reference: batch.id })
    .eq('id', batch.id).eq('status', 'pending')
  if (updateError) {
    await fetch(`https://api.paymongo.com/v1/checkout_sessions/${encodeURIComponent(sessionId)}/expire`, {
      method: 'POST',
      headers: { Authorization: `Basic ${btoa(paymongoKey + ':')}`, 'Content-Type': 'application/json' }
    }).catch(() => undefined)
    await admin.from('checkout_batches').update({ status: 'failed' }).eq('id', batch.id)
    await admin.from('orders').update({ status: 'failed' }).eq('checkout_batch_id', batch.id)
    return json({ error: 'Checkout tracking could not be saved. Please retry or contact support.' }, 500)
  }

  return json({ checkoutUrl: parsedCheckoutUrl.toString(), orderId: batch.id, productCodes: codes, isBatch: true })
})
