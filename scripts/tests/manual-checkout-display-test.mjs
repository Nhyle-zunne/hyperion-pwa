import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import { claimStatusLabel, fetchManualCheckoutClaims, isOpenManualClaim, pendingManualTracks } from '../../src/lib/manualCheckoutClaims.ts'

const now = Date.parse('2026-11-28T02:00:00Z')
const claim = (status, expires_at = '2026-11-30T02:00:00Z', codes = ['oic_nw']) => ({
  id: '11111111-1111-4111-8111-111111111111',
  status, expires_at,
  items: codes.map(code => ({ code, label: code, term: 'year', amountPhp: 499 })),
})

test('a clicked claim remains pending without treating the Messenger click as verified payment', () => {
  assert.equal(claimStatusLabel('awaiting_proof'), 'PENDING VERIFICATION')
  assert.equal(claimStatusLabel('pending_verification'), 'PENDING VERIFICATION')
  assert.equal(claimStatusLabel('approved'), 'APPROVED')
  assert.equal(claimStatusLabel('rejected'), 'REJECTED')
  assert.equal(claimStatusLabel('expired'), 'EXPIRED')
  assert.equal(claimStatusLabel('cancelled'), 'CANCELLED')
})

test('pending tracks block duplicate checkout until approval or expiry, without blocking unrelated tracks', () => {
  const open = claim('awaiting_proof', '2026-11-30T02:00:00Z', ['oic_nw', 'gmdss'])
  const expired = claim('awaiting_proof', '2026-11-27T02:00:00Z', ['deck_mgt'])
  assert.equal(isOpenManualClaim(open, now), true)
  assert.equal(isOpenManualClaim(expired, now), false)
  assert.equal(isOpenManualClaim(claim('pending_verification', '2026-11-27T02:00:00Z'), now), true)
  assert.deepEqual([...pendingManualTracks([open, expired, claim('approved', undefined, ['engine_mgt'])], now)].sort(), ['gmdss', 'oic_nw'])
  assert.equal(isOpenManualClaim(claim('cancelled'), now), false)
})

test('pending notices expose per-request cancellation and preserve cancelled purchase history', () => {
  const notice = readFileSync(new URL('../../src/components/ManualCheckoutStatus.tsx',import.meta.url),'utf8')
  const account = readFileSync(new URL('../../src/screens/AccountScreen.tsx',import.meta.url),'utf8')
  assert.match(notice,/CANCEL PURCHASE/)
  assert.match(notice,/cancel-manual-checkout-claim/)
  assert.match(notice,/Only cancel if you have not paid/i)
  assert.match(notice,/status === 'cancelled'/)
  assert.match(account,/onCancelled=\{reloadManualClaims\}/)
})

test('request history keeps an older unresolved purchase even when 50 newer requests exist', async () => {
  const owner = '11111111-1111-4111-8111-111111111111'
  const rows = [
    ...Array.from({ length: 51 }, (_, index) => ({ ...claim('approved'), id: String(index), user_id: owner, created_at: new Date(now - index * 1000).toISOString() })),
    { ...claim('pending_verification', '2026-11-27T02:00:00Z', ['deck_mgt']), id: 'older-open', user_id: owner, created_at: '2025-01-01T00:00:00Z' },
  ]
  let reads = 0
  const client = { from(table) {
    assert.equal(table, 'manual_checkout_claims')
    let ownerFilter, count = 1000, openOnly = false
    return {
      select() { return this }, eq(_field, value) { ownerFilter = value; return this },
      order() { return this }, limit(value) { count = value; return this },
      or() { openOnly = true; return this },
      then(resolve) {
        reads++
        const filtered = rows.filter(row => row.user_id === ownerFilter && (!openOnly || isOpenManualClaim(row, now)))
        return Promise.resolve({ data: filtered.slice(0, count), error: null }).then(resolve)
      },
    }
  } }
  const [first, second] = await Promise.all([fetchManualCheckoutClaims(client, owner), fetchManualCheckoutClaims(client, owner)])
  assert.equal(first.length, 51)
  assert.equal(first.some(row => row.id === 'older-open'), true)
  assert.deepEqual(first.map(row => row.id), second.map(row => row.id))
  assert.equal(reads, 2, 'concurrent screens share one recent-history and one open-request read')
})
