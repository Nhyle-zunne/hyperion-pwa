import { PAID_PRODUCTS } from './supabase'
import type { LicenseTerm, PaidTrack } from './supabase'

// A guest's Buy Now selection must survive Google even when Supabase sends
// the user to its configured site URL (/) instead of /auth/callback.
export const PENDING_BUY_NOW_KEY = 'hyperion-pending-buy-now-v1'
export const OAUTH_RETURN_TO_KEY = 'hyperion-oauth-return-to'
const MAX_PENDING_AGE_MS = 10 * 60 * 1000

export interface PendingBuyNow {
  code: PaidTrack
  term: LicenseTerm
  startedAt: number
}

export function buyNowCheckoutPath(code: PaidTrack, term: LicenseTerm): string {
  const query = new URLSearchParams({ buy_product: code, buy_term: term })
  return `/checkout?${query.toString()}`
}

export function readPendingBuyNow(now = Date.now()): PendingBuyNow | null {
  try {
    const raw = localStorage.getItem(PENDING_BUY_NOW_KEY)
    if (!raw) return null
    const value: unknown = JSON.parse(raw)
    if (value && typeof value === 'object') {
      const pending = value as { code?: unknown; term?: unknown; startedAt?: unknown }
      const age = typeof pending.startedAt === 'number' ? now - pending.startedAt : NaN
      if (
        typeof pending.code === 'string' &&
        PAID_PRODUCTS.some(product => product.code === pending.code) &&
        (pending.term === 'week' || pending.term === 'month' || pending.term === 'year') &&
        Number.isFinite(age) && age >= 0 && age <= MAX_PENDING_AGE_MS
      ) {
        return pending as PendingBuyNow
      }
    }
    localStorage.removeItem(PENDING_BUY_NOW_KEY)
  } catch {
    // If storage is unavailable, never infer a purchase or navigate on a guess.
  }
  return null
}

export function rememberPendingBuyNow(code: PaidTrack, term: LicenseTerm): void {
  const path = buyNowCheckoutPath(code, term)
  const startedAt = Date.now()
  // Keep the selection in the existing checkout basket as well as in a separate
  // one-time return marker; the return marker is not a license or payment grant.
  localStorage.setItem('hyperion-account-basket-v1', JSON.stringify([{ code, term }]))
  localStorage.setItem(PENDING_BUY_NOW_KEY, JSON.stringify({ code, term, startedAt }))
  localStorage.setItem(OAUTH_RETURN_TO_KEY, JSON.stringify({
    path, startedAt, mode: 'redirect'
  }))
}

export function clearPendingBuyNow(): void {
  try {
    localStorage.removeItem(PENDING_BUY_NOW_KEY)
  } catch {
    // Best effort: invalid or expired markers cannot authorize any purchase.
  }
}

// The home-page fallback may run instead of the OAuth callback. Clear only
// the old purchase-specific callback marker, never a new account sign-in.
export function clearMatchingBuyNowReturn(path: string): void {
  try {
    const raw = localStorage.getItem(OAUTH_RETURN_TO_KEY)
    if (!raw) return
    const stored: unknown = JSON.parse(raw)
    if (stored && typeof stored === 'object' && (stored as { path?: unknown }).path === path) {
      localStorage.removeItem(OAUTH_RETURN_TO_KEY)
    }
  } catch {
    // Ignore storage access failures.
  }
}
