// Skip *database writes*, never Google Play verification. The caller first
// verifies the purchase using Google's authenticated API and checks linked-token
// ownership. Existing expiry/revocation checks are always performed.
// Any stale, incomplete, ambiguous or mismatched state fails open to the
// original atomic reconciliation RPC, which remains the source of truth.
export type VerifiedEntitlement = {
  track_id: string
  product_code: string
  status: string
  expires_at: string
}
export type ExistingSubscriptionLink = {
  status: string
  subscription_state: string
  product_ids: string[]
  expires_at: string
  last_verified_at: string
}
export type VerifiedSubscriptionState = {
  status: string
  subscription_state: string
  product_ids: string[]
  expires_at: string
  entitlements: VerifiedEntitlement[]
}
const RECHECK_WRITE_INTERVAL_MS = 6 * 60 * 60 * 1000
const TRACKS = new Set(['DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'])
const isStringArray = (xs: unknown): xs is string[] =>
  Array.isArray(xs) && xs.every(x => typeof x === 'string')
const equalProducts = (a: string[], b: string[]) =>
  a.length === b.length && a.length === new Set(a).size &&
  b.length === new Set(b).size && [...a].sort().every((x, i) => x === [...b].sort()[i])
const instant = (value: unknown) =>
  typeof value === 'string' && value ? Date.parse(value) : NaN
const equivalentExpiry = (current: string, expected: string) => {
  const a = instant(current), b = instant(expected)
  return Number.isFinite(a) && Number.isFinite(b) && a === b
}
export function canSkipUnchangedGooglePlayWrite(
  existing: ExistingSubscriptionLink | null,
  currentEntitlements: VerifiedEntitlement[] | null,
  verified: VerifiedSubscriptionState,
  nowMs: number,
  hasPendingPurchaseReplacement: boolean
): boolean {
  if (!existing || !currentEntitlements || !verified ||
      !Number.isFinite(nowMs) || hasPendingPurchaseReplacement) return false
  const verifiedAt = instant(existing.last_verified_at)
  if (!Number.isFinite(verifiedAt) || verifiedAt > nowMs ||
      nowMs - verifiedAt >= RECHECK_WRITE_INTERVAL_MS) return false
  if (!['active', 'inactive'].includes(verified.status) ||
      existing.status !== verified.status ||
      existing.subscription_state !== verified.subscription_state ||
      !isStringArray(existing.product_ids) ||
      !isStringArray(verified.product_ids) ||
      !equalProducts(existing.product_ids, verified.product_ids) ||
      !equivalentExpiry(existing.expires_at, verified.expires_at)) return false
  if (!Array.isArray(verified.entitlements) ||
      currentEntitlements.length !== verified.entitlements.length) return false
  const stored = new Map<string, VerifiedEntitlement>()
  for (const item of currentEntitlements) {
    if (!item || !TRACKS.has(item.track_id) || stored.has(item.track_id) ||
        !['active', 'revoked'].includes(item.status)) return false
    stored.set(item.track_id, item)
  }
  const expected = new Set<string>()
  for (const item of verified.entitlements) {
    if (!item || !TRACKS.has(item.track_id) || expected.has(item.track_id) ||
        !['active', 'revoked'].includes(item.status)) return false
    expected.add(item.track_id)
    const actual = stored.get(item.track_id)
    if (!actual || actual.product_code !== item.product_code ||
        actual.status !== item.status ||
        !equivalentExpiry(actual.expires_at, item.expires_at)) return false
    // Expired or non-entitled products must never have an active grant.
    if ((verified.status !== 'active' || instant(item.expires_at) <= nowMs) &&
        item.status !== 'revoked') return false
  }
  return true
}
