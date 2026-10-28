// Expiry-aware scheduling for entitlement refreshes. Browser timer limits are below 2^31-1 ms.
export const MAX_EXPIRY_REFRESH_TIMEOUT_MS = 2_147_000_000;
const EXPIRY_REFRESH_PADDING_MS = 250;

export function nextExpiryRefreshDelay(expiryValues, now = Date.now(), maxDelay = MAX_EXPIRY_REFRESH_TIMEOUT_MS) {
  if (!Array.isArray(expiryValues) || !Number.isFinite(now) || !Number.isFinite(maxDelay) || maxDelay <= 0) return null;
  const futureExpiries = expiryValues
    .map((value) => typeof value === 'number' ? value : typeof value === 'string' ? Date.parse(value) : Number.NaN)
    .filter((value) => Number.isFinite(value) && value > now);
  if (!futureExpiries.length) return null;
  const nearestExpiry = Math.min(...futureExpiries);
  // Run just after the authoritative expiry so the server query cannot immediately re-arm on the same row.
  return Math.min(maxDelay, Math.max(0, nearestExpiry - now + EXPIRY_REFRESH_PADDING_MS));
}
