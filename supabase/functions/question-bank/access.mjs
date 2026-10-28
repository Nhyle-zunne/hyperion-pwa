/**
 * Pure paid-track entitlement decision used by the question-bank Edge Function.
 * This module intentionally contains no database access so its access matrix can
 * be exercised with synthetic records without creating or editing production users.
 */

/**
 * @param {{ user_id?: unknown, track_id?: unknown, status?: unknown, expires_at?: unknown } | null | undefined} entitlement
 * @param {string | null | undefined} expectedUserId
 * @param {string} expectedTrack
 * @param {number} now
 */
export function hasCurrentEntitlement(entitlement, expectedUserId, expectedTrack, now = Date.now()) {
  if (!entitlement || !expectedUserId || !expectedTrack || !Number.isFinite(now)) return false;
  if (entitlement.user_id !== expectedUserId || entitlement.track_id !== expectedTrack) return false;
  if (entitlement.status !== 'active' || typeof entitlement.expires_at !== 'string') return false;
  const expiresAt = Date.parse(entitlement.expires_at);
  return Number.isFinite(expiresAt) && expiresAt > now;
}

/**
 * @param {{ userId: string | null | undefined, isAdmin: boolean, entitlement: any, track: string, now?: number }} input
 */
export function canAccessPaidTrack({ userId, isAdmin, entitlement, track, now = Date.now() }) {
  // No session is never allowed, including when a client sends an admin-shaped body.
  if (!userId) return false;
  // Admin status must come from the existing server-side ADMIN_EMAILS check.
  if (isAdmin === true) return true;
  return hasCurrentEntitlement(entitlement, userId, track, now);
}
