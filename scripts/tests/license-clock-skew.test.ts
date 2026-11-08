import { afterEach, expect, test } from 'bun:test'
import {
  anchorMonotonicOfflineEntitlementClock,
  effectiveOfflineEntitlementNowMonotonic,
  resetMonotonicOfflineEntitlementClock,
  verifyOfflineEntitlementToken
} from '../../src/lib/offlineEntitlementCrypto.mjs'

const hour = 60 * 60 * 1000

afterEach(() => resetMonotonicOfflineEntitlementClock())

test('a server-verified entitlement clock ignores a phone set hours ahead', () => {
  const serverNow = 1_800_000_000_000
  // This anchor is backed by a newly verified, server-signed response.
  anchorMonotonicOfflineEntitlementClock(serverNow, 1_000, true)
  expect(effectiveOfflineEntitlementNowMonotonic(serverNow + 6 * hour, serverNow, 4_000))
    .toBe(serverNow + 3_000)
})

test('a server-verified entitlement clock advances monotonically when the phone is behind', () => {
  const serverNow = 1_800_000_000_000
  anchorMonotonicOfflineEntitlementClock(serverNow, 1_000, true)
  expect(effectiveOfflineEntitlementNowMonotonic(serverNow - 6 * hour, serverNow, 4_000))
    .toBe(serverNow + 3_000)
})

test('an offline restart with a clock behind the saved high-water mark still fails closed', () => {
  const serverNow = 1_800_000_000_000
  expect(effectiveOfflineEntitlementNowMonotonic(serverNow - 6 * hour, serverNow, 4_000))
    .toBeNull()
})

test('a fresh server-signed grant verifies at server issue time, not an incorrect phone time', async () => {
  const serverNow = Date.now() + 6 * hour
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']
  )
  const publicKey = await crypto.subtle.exportKey('jwk', pair.publicKey)
  const payload = btoa(JSON.stringify({
    v: 1, userId: 'account-a', issuedAt: serverNow, admin: false,
    tracks: { DECK_MGT: serverNow + 365 * 24 * hour }
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const signature = new Uint8Array(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' }, pair.privateKey, new TextEncoder().encode(payload)
  ))
  const signature64 = btoa(String.fromCharCode(...signature))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
  const token = payload + '.' + signature64

  expect(await verifyOfflineEntitlementToken(token, 'account-a', serverNow - 6 * hour, publicKey))
    .toBeNull()
  const claims = await verifyOfflineEntitlementToken(token, 'account-a', serverNow, publicKey)
  expect(claims?.tracks.DECK_MGT).toBe(serverNow + 365 * 24 * hour)
  expect(await verifyOfflineEntitlementToken(token, 'account-b', serverNow, publicKey))
    .toBeNull()
})
