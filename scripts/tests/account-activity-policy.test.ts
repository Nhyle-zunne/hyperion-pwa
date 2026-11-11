import { expect, test } from 'bun:test'
import {
  ACTIVITY_REPORT_INTERVAL_MS,
  ACTIVITY_FAILURE_RETRY_MS,
  shouldRecordAccountActivity,
  canAttemptAccountActivity
} from '../../src/lib/accountActivityPolicy.mjs'

test('paid-account activity is reported at most every six hours', () => {
  const now = 1_800_000_000_000
  expect(ACTIVITY_REPORT_INTERVAL_MS).toBe(6 * 60 * 60 * 1000)
  expect(shouldRecordAccountActivity(0, now)).toBe(true)
  expect(shouldRecordAccountActivity(now - 15 * 60 * 1000, now)).toBe(false)
  expect(shouldRecordAccountActivity(now - 5 * 60 * 60 * 1000, now)).toBe(false)
  expect(shouldRecordAccountActivity(now - ACTIVITY_REPORT_INTERVAL_MS, now)).toBe(true)
})

test('previous account or reversed clock cannot block another fresh account', () => {
  const now = 1_800_000_000_000
  const accountA = new Map([['owner-a', now]])
  const ownerBHint = accountA.get('owner-b') ?? 0
  expect(shouldRecordAccountActivity(ownerBHint, now)).toBe(true)
  expect(shouldRecordAccountActivity(now + 60_000, now)).toBe(true)
  expect(shouldRecordAccountActivity(Number.NaN, now)).toBe(true)
})

test('an outage cannot trigger one Edge invocation per focus or token event', () => {
  const now = 1_800_000_000_000
  expect(ACTIVITY_FAILURE_RETRY_MS).toBe(10 * 60 * 1000)
  expect(canAttemptAccountActivity(0, now)).toBe(true)
  expect(canAttemptAccountActivity(now - 60_000, now)).toBe(false)
  expect(canAttemptAccountActivity(now - ACTIVITY_FAILURE_RETRY_MS, now)).toBe(true)
  expect(canAttemptAccountActivity(now + 60_000, now)).toBe(true)
})
