type MarkerStorage = Pick<Storage, 'getItem' | 'setItem'>
const RECOVERY_KEY = 'hyperion-cloud-recovery-v1:'
const RECOVERY_RETRY_MS = 15 * 60_000

/** Scheduling hints only; never authorizes access or acknowledges saved data. */
export class ProgressRequestPolicy {
  private failures = new Map<string, { count: number; at: number }>()
  private recoveryFailures = new Map<string, number>()
  private recoveredAt = new Map<string, number>()
  private lastWake = new Map<string, number>()
  constructor(private storage: MarkerStorage, private now: () => number = Date.now) {}

  needsRecovery(userId: string, missingRow = false): boolean {
    if ((this.recoveryFailures.get(userId) ?? 0) > this.now()) return false
    let at = this.recoveredAt.get(userId)
    if (at === undefined) {
      try {
        const raw = this.storage.getItem(RECOVERY_KEY + userId)
        if (raw !== null && Number.isFinite(Number(raw))) at = Number(raw)
      } catch { /* In-memory hints still work when storage is unavailable. */ }
    }
    return at === undefined || (missingRow && this.now() - at >= RECOVERY_RETRY_MS)
  }
  recovered(userId: string): void {
    const now = this.now()
    this.recoveredAt.set(userId, now)
    this.recoveryFailures.delete(userId)
    try { this.storage.setItem(RECOVERY_KEY + userId, String(now)) } catch { /* Optional hint. */ }
  }
  recoveryFailed(userId: string): void { this.recoveryFailures.set(userId, this.now() + RECOVERY_RETRY_MS) }
  retryAt(userId: string): number { return this.failures.get(userId)?.at ?? 0 }
  fail(userId: string): number {
    const count = (this.failures.get(userId)?.count ?? 0) + 1
    const at = this.now() + Math.min(900_000, 30_000 * 2 ** Math.min(count - 1, 5))
    this.failures.set(userId, { count, at })
    return at
  }
  succeeded(userId: string): void { this.failures.delete(userId) }
  wake(userId: string): boolean {
    const previous = this.lastWake.get(userId)
    if (previous !== undefined && this.now() - previous < 30_000) return false
    this.lastWake.set(userId, this.now())
    const retry = this.failures.get(userId)
    if (retry) retry.at = 0
    return true
  }
}
