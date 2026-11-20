/** A small per-isolate guard for this unauthenticated, Google-API-backed lookup.
 * Upstream gateway quotas should still be applied for distributed abuse.
 */
export function createRestoreRateLimiter({
  perSource = 20,
  global = 80,
  windowMs = 60_000,
  concurrent = 6
} = {}) {
  let windowStart: number | null = null
  let globalCount = 0
  let inFlight = 0
  const sourceCounts = new Map<string, number>()

  return {
    allow(source: string, now: number): boolean {
      if (windowStart === null || now < windowStart || now - windowStart >= windowMs) {
        windowStart = now
        globalCount = 0
        sourceCounts.clear()
      }
      if (inFlight >= concurrent || globalCount >= global) return false
      if (source && (sourceCounts.get(source) || 0) >= perSource) return false
      globalCount++
      if (source) sourceCounts.set(source, (sourceCounts.get(source) || 0) + 1)
      inFlight++
      return true
    },
    finish() { inFlight = Math.max(0, inFlight - 1) }
  }
}
