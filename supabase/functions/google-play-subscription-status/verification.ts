/** Read-only public subset of the Play Developer API response. Never return account IDs or tokens. */
const PRODUCT_IDS = new Set([
  'hyperion_oic_nw_pass',
  'hyperion_engine_oic_ew_pass',
  'hyperion_gmdss_pass',
  'hyperion_deck_mgt_pass',
  'hyperion_engine_mgt_pass',
  'hyperion_all_access_pass' // Older owned purchases remain restorable.
])
const ENTITLED_STATES = new Set([
  'SUBSCRIPTION_STATE_ACTIVE',
  'SUBSCRIPTION_STATE_IN_GRACE_PERIOD',
  'SUBSCRIPTION_STATE_CANCELED'
])

export function publicSubscriptionStatus(google: Record<string, unknown>, now: number) {
  const lineItems = Array.isArray(google.lineItems) ? google.lineItems : []
  const items = lineItems.flatMap(raw => {
    if (!raw || typeof raw !== 'object') return []
    const item = raw as Record<string, unknown>
    if (typeof item.productId !== 'string' || !PRODUCT_IDS.has(item.productId)) return []
    const expiresAtMs = typeof item.expiryTime === 'string' ? Date.parse(item.expiryTime) : NaN
    if (!Number.isFinite(expiresAtMs)) return []
    const offer = item.offerDetails && typeof item.offerDetails === 'object'
      ? item.offerDetails as Record<string, unknown> : {}
    return [{
      productId: item.productId,
      expiresAt: new Date(expiresAtMs).toISOString(),
      basePlanId: typeof offer.basePlanId === 'string' ? offer.basePlanId : ''
    }]
  })

  return {
    active: ENTITLED_STATES.has(String(google.subscriptionState || '')) &&
      items.some(item => Date.parse(item.expiresAt) > now),
    items
  }
}
