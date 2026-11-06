// Webhooks remain primary. These checks are a bounded fallback while a page is open.
const POLLING_WINDOW_MS = 10 * 60_000
const RETRY_DELAYS_MS = [8000, 15_000, 30_000, 60_000]
const AUTOMATIC_ORDER_AGE_MS = 24 * 60 * 60_000

type PendingPaymentOrder = {
  id: string
  checkout_batch_id?: string | null
  status: string
  payment_method: string | null
  created_at: string
}

export function pendingPaymentCheckoutIds(orders: PendingPaymentOrder[], now = Date.now()): string {
  return [...new Set(orders.filter(order =>
    order.status === 'pending' && order.payment_method === 'PayMongo Checkout' &&
    Date.parse(order.created_at) > now - AUTOMATIC_ORDER_AGE_MS
  ).map(order => order.checkout_batch_id || order.id))].sort().join(',')
}

export function createPaymentPollingState() {
  const now = Date.now()
  return { deadline: now + POLLING_WINDOW_MS, nextCheckAt: now, attempts: 0, checking: false }
}

export function startPaymentPolling(
  check: (isCurrent: () => boolean) => Promise<void>,
  { refreshOnResumeAfterTimeout = false, immediate = true, state = createPaymentPollingState() } = {},
): () => void {
  let active = true
  if (!immediate && state.attempts === 0) state.nextCheckAt = Math.max(state.nextCheckAt, Date.now() + RETRY_DELAYS_MS[0])
  let timer: number | undefined
  const available = () => active && document.visibilityState === 'visible' && navigator.onLine !== false
  const clearTimer = () => { window.clearTimeout(timer); timer = undefined }
  const schedule = () => {
    clearTimer()
    if (!available() || Date.now() >= state.deadline) return
    const next = state.checking ? Date.now() + RETRY_DELAYS_MS[0] : state.nextCheckAt
    if (next >= state.deadline) return
    timer = window.setTimeout(() => { void run() }, Math.max(0, next - Date.now()))
  }
  const run = async (resumed = false) => {
    clearTimer()
    if (!available()) return
    if (state.checking) { schedule(); return }
    if (Date.now() < state.nextCheckAt) { schedule(); return }
    const lateRefresh = resumed && refreshOnResumeAfterTimeout
    if (Date.now() >= state.deadline && !lateRefresh) return
    state.checking = true
    const isCurrent = () => available() && (Date.now() < state.deadline || lateRefresh)
    try {
      await check(isCurrent)
    } catch {
      // Retry transient failures within the same bounded window.
    } finally {
      state.checking = false
      const delay = RETRY_DELAYS_MS[Math.min(state.attempts++, RETRY_DELAYS_MS.length - 1)]
      state.nextCheckAt = Date.now() + delay
      schedule()
    }
  }
  const onResume = () => { void run(true) }
  const onVisibility = () => { if (available()) onResume(); else clearTimer() }
  window.addEventListener('focus', onResume)
  window.addEventListener('online', onResume)
  window.addEventListener('offline', onVisibility)
  document.addEventListener('visibilitychange', onVisibility)
  void run()
  return () => {
    active = false
    clearTimer()
    window.removeEventListener('focus', onResume)
    window.removeEventListener('online', onResume)
    window.removeEventListener('offline', onVisibility)
    document.removeEventListener('visibilitychange', onVisibility)
  }
}
