// Authoritative one-time catalogue. Subscription prices are intentionally
// separate, and a browser-supplied price never determines the charge.
export const lifetimeProducts = {
  gmdss: { track: 'GMDSS_GOC', label: 'GMDSS GOC', amountPhp: 599 },
  oic_nw: { track: 'DECK_OIC_NW', label: 'Deck OIC-NW', amountPhp: 999 },
  engine_ew: { track: 'ENGINE_OIC_EW', label: 'Engine OIC-EW', amountPhp: 999 },
  deck_mgt: { track: 'DECK_MGT', label: 'Deck Management', amountPhp: 1999 },
  engine_mgt: { track: 'ENGINE_MGT', label: 'Engine Management', amountPhp: 1999 }
} as const

export type LifetimeProductCode = keyof typeof lifetimeProducts
export function lifetimeProduct(code: unknown) {
  return typeof code === 'string' && Object.prototype.hasOwnProperty.call(lifetimeProducts, code)
    ? { code: code as LifetimeProductCode, ...lifetimeProducts[code as LifetimeProductCode] }
    : null
}

// Confirm that the existing PayMongo webhook covers both successful checkout
// and completed refunds before making a one-time irreversible product payable.
// PayMongo's webhook-list response is server-only and must never be logged.
export function hasLifetimePaymongoWebhook(
  resources: unknown, endpoint: string, expectedLivemode: boolean
): boolean {
  if (!Array.isArray(resources) || !endpoint.startsWith('https://')) return false
  return resources.some((entry: any) => {
    const attrs = entry?.attributes
    const events = attrs?.events
    return entry?.type === 'webhook' &&
      attrs?.status === 'enabled' &&
      attrs?.livemode === expectedLivemode &&
      attrs?.url === endpoint &&
      Array.isArray(events) &&
      events.includes('checkout_session.payment.paid') &&
      (events.includes('payment.refunded') || events.includes('payment.refund.updated'))
  })
}

export type LifetimeOrder = {
  id: string
  user_id: string
  product_code: string
  track_id: string
  amount_php: number
  currency: string
  status: string
  paymongo_livemode: boolean
  paymongo_checkout_session_id: string | null
}

export type LifetimePaidProof = {
  sessionId: string
  paymentId: string
  amountMinor: number
  currency: string
  livemode: boolean
}

// A redirect, receipt screenshot, client payload or event ID is never payment
// proof. Only a provider session directly retrieved with the secret API key,
// or a verified-signature PayMongo webhook, may supply this object.
export function validatePaidLifetimeSession(
  session: any, order: LifetimeOrder, expectedLivemode: boolean
): LifetimePaidProof | null {
  const product = lifetimeProduct(order.product_code)
  const attrs = session?.attributes
  const metadata = attrs?.metadata
  if (!product || !order.paymongo_checkout_session_id ||
      order.track_id !== product.track ||
      order.amount_php !== product.amountPhp ||
      order.currency !== 'PHP' ||
      order.paymongo_livemode !== expectedLivemode ||
      session?.id !== order.paymongo_checkout_session_id ||
      attrs?.reference_number !== order.id ||
      metadata?.order_id !== order.id ||
      metadata?.user_id !== order.user_id ||
      metadata?.product_code !== product.code ||
      metadata?.kind !== 'lifetime' ||
      (typeof attrs?.livemode === 'boolean' && attrs.livemode !== expectedLivemode)) {
    return null
  }
  const paidPayments = Array.isArray(attrs?.payments)
    ? attrs.payments.filter((value: any) => value?.attributes?.status === 'paid')
    : []
  if (paidPayments.length !== 1) return null
  const payment = paidPayments[0]
  const proof = payment.attributes
  if (typeof payment.id !== 'string' || !/^pay_[A-Za-z0-9_-]{6,}$/.test(payment.id) ||
      proof?.currency !== 'PHP' ||
      !Number.isSafeInteger(Number(proof?.amount)) ||
      Number(proof.amount) !== product.amountPhp * 100) return null
  return {
    sessionId: session.id,
    paymentId: payment.id,
    amountMinor: Number(proof.amount),
    currency: proof.currency,
    livemode: expectedLivemode
  }
}

export async function lifetimePaymentSha256(paymentId: string): Promise<string> {
  const bytes = new Uint8Array(await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(paymentId)
  ))
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')
}

export async function finalizeVerifiedLifetimePayment(
  admin: any, order: LifetimeOrder, session: any, expectedLivemode: boolean
): Promise<{status: string; orderId?: string; productCode?: string; duplicate?: boolean}> {
  const proof = validatePaidLifetimeSession(session, order, expectedLivemode)
  if (!proof) throw new Error('Provider lifetime checkout did not match the saved order and paid amount.')
  const { data, error } = await admin.rpc('finalize_paymongo_lifetime_checkout', {
    p_order_id: order.id,
    p_checkout_session_id: proof.sessionId,
    p_payment_id: proof.paymentId,
    p_payment_ref_sha256: await lifetimePaymentSha256(proof.paymentId),
    p_amount_minor: proof.amountMinor,
    p_currency: proof.currency,
    p_livemode: proof.livemode
  })
  if (error || !data || typeof data.status !== 'string') {
    throw new Error('Atomic lifetime payment finalization failed.')
  }
  return data
}

// Only a successfully completed refund is an authoritative revocation event.
// Unknown refund types/statuses fail closed and never mutate account grants.
export function refundedPaymentIdForEvent(eventType: string, resource: any): string | null {
  const attrs = resource?.attributes
  if (eventType === 'payment.refunded') {
    return attrs?.status === 'refunded' && typeof resource.id === 'string' &&
      /^pay_[A-Za-z0-9_-]{6,}$/.test(resource.id) ? resource.id : null
  }
  if (eventType !== 'payment.refund.updated' ||
      !['succeeded','successful','refunded'].includes(String(attrs?.status || '').toLowerCase())) return null
  const id = attrs?.payment_id ?? attrs?.payment?.id
  return typeof id === 'string' && /^pay_[A-Za-z0-9_-]{6,}$/.test(id) ? id : null
}
