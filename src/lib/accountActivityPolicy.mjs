// Activity is only used to prevent deletion after extended account inactivity.
// Entitlements, Google Play renewal, and paid content authorization do not depend
// on this marker. A six-hour interval preserves the 60-day retention grace while
// eliminating redundant Auth/Edge/SQL reads and writes on app focus/route changes.
export const ACTIVITY_REPORT_INTERVAL_MS = 6 * 60 * 60 * 1000
// Failed requests should not retry on every focus, visibility or token event.
export const ACTIVITY_FAILURE_RETRY_MS = 10 * 60 * 1000

export function shouldRecordAccountActivity(lastReportedAt, now) {
  const last = Number(lastReportedAt)
  return !Number.isFinite(last) || last <= 0 || now < last || now - last >= ACTIVITY_REPORT_INTERVAL_MS
}

export function canAttemptAccountActivity(lastAttemptAt, now) {
  const last = Number(lastAttemptAt)
  return !Number.isFinite(last) || last <= 0 || now < last || now - last >= ACTIVITY_FAILURE_RETRY_MS
}
