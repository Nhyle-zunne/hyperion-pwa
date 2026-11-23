// Temporary website-only purchase pause. It does not affect existing licenses,
// Android/Google Play purchases, or payment verification and cancellation.
export const PWA_PURCHASES_PAUSED = true

export const PWA_PURCHASE_PAUSE_NOTICE =
  'New website purchases and license extensions are temporarily unavailable. Existing licenses remain active.'

type PwaPaymentAction = 'buy' | 'extend' | 'checkout' | 'resume' | 'manual-payment' | 'verify' | 'cancel'

export function canPerformPwaPaymentAction(action: PwaPaymentAction, paused = PWA_PURCHASES_PAUSED): boolean {
  return !paused || action === 'verify' || action === 'cancel'
}
