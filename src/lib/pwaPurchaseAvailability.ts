export const PWA_PURCHASE_PAUSE_NOTICE =
  'Website checkout is temporarily unavailable. Existing licenses remain active. Please try again later.'

type PwaPaymentAction = 'buy' | 'extend' | 'checkout' | 'resume' | 'manual-payment' | 'verify' | 'cancel'

export function isWebsiteCheckoutEnabled(value: unknown): boolean {
  return Boolean(value && typeof value === 'object' && 'website_checkout_enabled' in value && value.website_checkout_enabled === true)
}

// Only the new QR checkout may be enabled through the server-backed switch.
// Previous PayMongo/legacy manual payments must stay blocked either way.
export function canPerformPwaPaymentAction(action: PwaPaymentAction, checkoutEnabled = false): boolean {
  if (action === 'verify' || action === 'cancel') return true
  if (action === 'resume' || action === 'manual-payment') return false
  return checkoutEnabled
}
