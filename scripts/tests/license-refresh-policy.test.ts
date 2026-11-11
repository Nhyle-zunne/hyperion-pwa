import { expect, test } from 'bun:test'
import { shouldRefreshLicenseForAuthEvent } from '../../src/lib/licenseRefreshPolicy.mjs'

test('new sign-in and account switch require a single license refresh', () => {
  expect(shouldRefreshLicenseForAuthEvent('SIGNED_IN', null, 'user-a')).toBe(true)
  expect(shouldRefreshLicenseForAuthEvent('SIGNED_IN', 'user-a', 'user-b')).toBe(true)
  expect(shouldRefreshLicenseForAuthEvent('SIGNED_IN', 'user-a', 'user-a')).toBe(false)
  expect(shouldRefreshLicenseForAuthEvent('SIGNED_OUT', 'user-a', null)).toBe(true)
  expect(shouldRefreshLicenseForAuthEvent('SIGNED_OUT', null, null)).toBe(false)
})

test('restoring a session, refreshing a JWT or updating a profile must not poll licensing', () => {
  for (const event of ['INITIAL_SESSION', 'TOKEN_REFRESHED', 'USER_UPDATED', 'PASSWORD_RECOVERY', 'MFA_CHALLENGE_VERIFIED']) {
    expect(shouldRefreshLicenseForAuthEvent(event, 'user-a', 'user-a')).toBe(false)
  }
  expect(shouldRefreshLicenseForAuthEvent('SIGNED_IN', null, null)).toBe(false)
})
