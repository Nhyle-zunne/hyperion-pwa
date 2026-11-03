import { expect, test } from 'bun:test'
import { ProgressRequestPolicy } from '../../src/lib/progressRequestPolicy'
const fixture = () => {
  let now = 1_800_000_000_000
  const map = new Map<string, string>()
  const storage = { getItem: (key: string) => map.get(key) ?? null, setItem: (key: string, value: string) => { map.set(key, value) } }
  return { policy: new ProgressRequestPolicy(storage, () => now), storage, advance: (ms: number) => { now += ms }, now: () => now }
}
test('successful recovery survives reload but does not suppress another account', () => {
  const f = fixture()
  expect(f.policy.needsRecovery('a')).toBe(true)
  f.policy.recovered('a')
  expect(f.policy.needsRecovery('a')).toBe(false)
  expect(new ProgressRequestPolicy(f.storage, f.now).needsRecovery('a')).toBe(false)
  expect(f.policy.needsRecovery('b')).toBe(true)
  f.advance(900_000)
  expect(f.policy.needsRecovery('a')).toBe(false)
  expect(f.policy.needsRecovery('a', true)).toBe(true)
})
test('failed recovery pauses rather than being marked complete', () => {
  const f = fixture()
  f.policy.recoveryFailed('a')
  expect(f.policy.needsRecovery('a')).toBe(false)
  expect(f.policy.needsRecovery('b')).toBe(true)
  f.advance(900_000)
  expect(f.policy.needsRecovery('a')).toBe(true)
})
test('repeated failures back off and success resets the account', () => {
  const f = fixture()
  expect(f.policy.fail('a') - f.now()).toBe(30_000)
  expect(f.policy.fail('a') - f.now()).toBe(60_000)
  for (let i = 0; i < 12; i++) f.policy.fail('a')
  expect(f.policy.retryAt('a') - f.now()).toBe(900_000)
  expect(f.policy.retryAt('b')).toBe(0)
  f.policy.succeeded('a')
  expect(f.policy.retryAt('a')).toBe(0)
  expect(f.policy.fail('a') - f.now()).toBe(30_000)
})
test('wake retries are prompt but repeated online events cannot bypass backoff', () => {
  const f = fixture()
  f.policy.fail('a')
  expect(f.policy.wake('a')).toBe(true)
  expect(f.policy.retryAt('a')).toBe(0)
  f.policy.fail('a')
  expect(f.policy.wake('a')).toBe(false)
  expect(f.policy.retryAt('a')).toBeGreaterThan(f.now())
  f.advance(30_000)
  expect(f.policy.wake('a')).toBe(true)
})
