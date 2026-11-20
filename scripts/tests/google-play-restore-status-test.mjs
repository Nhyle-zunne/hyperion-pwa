import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFile } from 'node:fs/promises'
import { publicSubscriptionStatus } from '../../supabase/functions/google-play-subscription-status/verification.ts'

test('restored annual Play subscriptions use the real expiry and base plan', () => {
  const snapshot = publicSubscriptionStatus({
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    externalAccountIdentifiers: { obfuscatedExternalAccountId: 'private-account-id' },
    lineItems: [{
      productId: 'hyperion_engine_oic_ew_pass',
      expiryTime: '2027-10-30T15:11:00Z',
      offerDetails: { basePlanId: 'oic-ew-yearly' }
    }]
  }, Date.parse('2026-11-19T15:11:00Z'))

  assert.deepEqual(snapshot, {
    active: true,
    items: [{ productId: 'hyperion_engine_oic_ew_pass', expiresAt: '2027-10-30T15:11:00.000Z', basePlanId: 'oic-ew-yearly' }]
  })
  assert.equal(JSON.stringify(snapshot).includes('private-account-id'), false)
})

test('canceled with remaining paid time is still valid; on-hold is not', () => {
  const lineItems = [{ productId: 'hyperion_gmdss_pass', expiryTime: '2027-01-01T00:00:00Z' }]
  assert.equal(publicSubscriptionStatus({ subscriptionState: 'SUBSCRIPTION_STATE_CANCELED', lineItems }, 1).active, true)
  assert.equal(publicSubscriptionStatus({ subscriptionState: 'SUBSCRIPTION_STATE_ON_HOLD', lineItems }, 1).active, false)
  assert.equal(publicSubscriptionStatus({ subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE', lineItems }, Date.parse('2027-01-02T00:00:00Z')).active, false)
})

test('only valid Hyperion track products and finite dates are returned', () => {
  const result = publicSubscriptionStatus({
    subscriptionState: 'SUBSCRIPTION_STATE_ACTIVE',
    lineItems: [
      { productId: 'another_app', expiryTime: '2027-10-30T00:00:00Z' },
      { productId: 'hyperion_deck_mgt_pass', expiryTime: 'not-a-date' },
      { productId: 'hyperion_oic_nw_pass', expiryTime: '2027-12-01T00:00:00Z', offerDetails: { basePlanId: 'oic-nw-monthly' } }
    ]
  }, 1)
  assert.deepEqual(result.items, [{ productId: 'hyperion_oic_nw_pass', expiresAt: '2027-12-01T00:00:00.000Z', basePlanId: 'oic-nw-monthly' }])
  assert.equal(publicSubscriptionStatus({ lineItems: [] }, 1).active, false)
})

test('anonymous restore endpoint is read-only and never exposes or links purchase owners', async () => {
  const source = await readFile(new URL('../../supabase/functions/google-play-subscription-status/index.ts', import.meta.url), 'utf8')
  const config = await readFile(new URL('../../supabase/config.toml', import.meta.url), 'utf8')
  assert.match(config, /\[functions\.google-play-subscription-status\]\s*verify_jwt = false/)
  assert.match(source, /purchases\/subscriptionsv2\/tokens\//)
  assert.match(source, /readBodyLimited\(req\)/)
  assert.match(source, /GOOGLE_PLAY_SERVICE_ACCOUNT_JSON/)
  assert.doesNotMatch(source, /createClient\(|SUPABASE_SERVICE_ROLE_KEY|\.rpc\(|\.upsert\(|\.insert\(/)
  assert.doesNotMatch(source, /externalAccountIdentifiers|obfuscatedExternalAccountId|linkedPurchaseToken/)
})
