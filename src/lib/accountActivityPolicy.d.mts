export const ACTIVITY_REPORT_INTERVAL_MS: number
export const ACTIVITY_FAILURE_RETRY_MS: number
export function shouldRecordAccountActivity(lastReportedAt: unknown, now: number): boolean
export function canAttemptAccountActivity(lastAttemptAt: unknown, now: number): boolean
