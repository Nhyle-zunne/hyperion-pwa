/**
 * Stable, privacy-preserving Google Play account binding for Hyperion users.
 * Keep the prefix and UTF-8 SHA-256 encoding in sync with Android BillingManager.
 */
export async function obfuscatedHyperionAccountId(userId: string): Promise<string> {
  const normalizedUserId = userId.trim()
  if (!normalizedUserId) throw new TypeError('A Hyperion user ID is required.')

  const input = new TextEncoder().encode('hyperion-maritime:' + normalizedUserId)
  const digest = await crypto.subtle.digest('SHA-256', input)
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

/**
 * Purchases created before account binding was introduced have no external identifier.
 * Accept those for backward compatibility; when Google supplies one, require an exact
 * match with the currently authenticated Hyperion user before linking any entitlement.
 */
export function matchesObfuscatedHyperionAccount(
  observedAccountId: unknown,
  expectedAccountId: string
): boolean {
  if (observedAccountId == null) return true
  if (typeof observedAccountId !== 'string') return false
  const observed = observedAccountId.trim()
  return observed.length === 0 || observed === expectedAccountId
}
