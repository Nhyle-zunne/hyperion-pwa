import assert from 'node:assert/strict'
import { createPaymentPollingState, startPaymentPolling, pendingPaymentCheckoutIds } from '../../src/lib/paymentPolling.ts'

const original = Object.fromEntries(['window', 'document', 'navigator'].map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]))
const realNow = Date.now
let now = 0
let timers = new Map()
let serial = 0
const windowMock = Object.assign(new EventTarget(), {
  setTimeout(fn, delay) { const id = ++serial; timers.set(id, { fn, at: now + delay }); return id },
  clearTimeout(id) { timers.delete(id) },
})
const documentMock = Object.assign(new EventTarget(), { visibilityState: 'visible' })
const navigatorMock = { onLine: true }
const flush = async () => { for (let i = 0; i < 20; i++) await Promise.resolve() }
const advance = async ms => {
  const end = now + ms
  while (true) {
    const next = [...timers.entries()].sort((a, b) => a[1].at - b[1].at)[0]
    if (!next || next[1].at > end) break
    now = next[1].at; timers.delete(next[0]); next[1].fn(); await flush()
  }
  now = end; await flush()
}
const reset = () => { now = 0; timers = new Map(); documentMock.visibilityState = 'visible'; navigatorMock.onLine = true }
const visibility = state => { documentMock.visibilityState = state; documentMock.dispatchEvent(new Event('visibilitychange')) }
try {
  Object.defineProperty(globalThis, 'window', { configurable: true, value: windowMock })
  Object.defineProperty(globalThis, 'document', { configurable: true, value: documentMock })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: navigatorMock })
  Date.now = () => now

  let initialCalls = 0
  let initialStop = startPaymentPolling(async () => { initialCalls++ }, { immediate: false })
  await flush(); assert.equal(initialCalls, 0, 'Checkout data refresh does not duplicate the initial page load')
  await advance(8000); assert.equal(initialCalls, 1)
  initialStop(); reset()

  const calls = []
  let stop = startPaymentPolling(async () => { calls.push(now) })
  await flush()
  await advance(113_000)
  assert.deepEqual(calls, [0, 8000, 23000, 53000, 113000], 'Checks back off to one minute')
  await advance(900_000)
  assert.equal(calls.length, 13, 'Ten-minute window bounds automatic checks')
  windowMock.dispatchEvent(new Event('focus')); await flush()
  assert.equal(calls.length, 13, 'Focus cannot restart an expired payment polling window')
  assert.equal(timers.size, 0)
  stop()

  reset()
  const paused = []
  stop = startPaymentPolling(async () => { paused.push(now) })
  await flush()
  visibility('hidden'); await advance(60_000)
  assert.deepEqual(paused, [0], 'Hidden tabs do not poll')
  visibility('visible'); windowMock.dispatchEvent(new Event('focus')); await flush()
  assert.deepEqual(paused, [0, 60000], 'Returning resumes once without duplicate focus checks')
  windowMock.dispatchEvent(new Event('focus')); await flush()
  assert.equal(paused.length, 2, 'Focus does not bypass the retry delay')
  navigatorMock.onLine = false; windowMock.dispatchEvent(new Event('offline'))
  await advance(60_000)
  assert.equal(paused.length, 2, 'Offline tabs do not poll')
  navigatorMock.onLine = true; windowMock.dispatchEvent(new Event('online')); await flush()
  assert.equal(paused.length, 3)
  stop(); await advance(600_000)
  assert.equal(paused.length, 3, 'Cleanup cancels future timers and listeners')

  reset()
  visibility('hidden')
  let count = 0
  stop = startPaymentPolling(async () => { count++ })
  await advance(600_001); visibility('visible'); await flush()
  assert.equal(count, 0, 'Hidden time counts toward the maximum window')
  stop()

  reset()
  let release
  let current
  count = 0
  stop = startPaymentPolling(async isCurrent => { count++; current = isCurrent; await new Promise(resolve => { release = resolve }) })
  await advance(100_000); windowMock.dispatchEvent(new Event('focus')); await flush()
  assert.equal(count, 1, 'Slow network requests never overlap')
  visibility('hidden'); assert.equal(current(), false, 'A callback cannot launch the next batch request while hidden')
  visibility('visible'); stop(); assert.equal(current(), false, 'Unmount invalidates in-flight callbacks')
  release(); await flush(); await advance(600_000)
  assert.equal(count, 1)
  assert.equal(timers.size, 0)

  reset()
  count = 0
  stop = startPaymentPolling(async () => { count++; throw new Error('Synthetic network error') })
  await flush(); await advance(8000)
  assert.equal(count, 2, 'Failures retry with backoff without unhandled rejections')
  stop()

  reset()
  count = 0
  stop = startPaymentPolling(async () => { count++ }, { refreshOnResumeAfterTimeout: true })
  await flush(); await advance(660_001)
  const beforeResume = count
  windowMock.dispatchEvent(new Event('focus')); await flush()
  assert.equal(count, beforeResume + 1, 'Checkout can discover newly created orders on a later return')
  await advance(120_000)
  assert.equal(count, beforeResume + 1, 'A late return does not restart background polling')
  stop()

  reset()
  const state = createPaymentPollingState()
  const restarted = []
  stop = startPaymentPolling(async () => { restarted.push(now) }, { state })
  await flush(); await advance(540_000)
  stop()
  stop = startPaymentPolling(async () => { restarted.push(now) }, { state })
  await flush(); await advance(120_000)
  assert.equal(restarted.length, 13, 'Changed order sets preserve the original deadline and retry delay')
  assert(restarted.every(at => at < 600_000))
  stop()

  reset()
  const shared = createPaymentPollingState()
  count = 0
  stop = startPaymentPolling(async () => { count++; await new Promise(resolve => { release = resolve }) }, { state: shared })
  await flush(); stop()
  stop = startPaymentPolling(async () => { count++ }, { state: shared })
  await advance(10_000)
  assert.equal(count, 1, 'A changed order set cannot overlap the previous in-flight request')
  release(); await flush(); await advance(20_000)
  assert.equal(count, 2, 'The new order set resumes after the previous request and its cooldown')
  stop()

  now = 2 * 86400_000
  const recent = { status: 'pending', payment_method: 'PayMongo Checkout', created_at: new Date(now - 1000).toISOString() }
  assert.equal(pendingPaymentCheckoutIds([
    { ...recent, id: 'a', checkout_batch_id: 'batch' }, { ...recent, id: 'b', checkout_batch_id: 'batch' },
    { ...recent, id: 'single', checkout_batch_id: null },
    { ...recent, id: 'old', created_at: new Date(now - 86400_000).toISOString() },
    { ...recent, id: 'invalid', created_at: 'invalid' },
    { ...recent, id: 'manual', payment_method: 'GCash' }, { ...recent, id: 'paid', status: 'paid' },
  ]), 'batch,single', 'Only recent pending provider checkouts qualify; batches are deduplicated')
  console.log('PASS: payment polling backoff, limits, visibility, offline, cancellation, errors, resume and eligibility')
} finally {
  Date.now = realNow
  for (const [key, descriptor] of Object.entries(original)) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor)
    else delete globalThis[key]
  }
}
