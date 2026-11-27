import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import postcss from 'postcss'
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

test('a pending purchase can switch reviewer duration without changing an already reviewed payment', () => {
  const notice = readFileSync(new URL('../../src/components/ManualCheckoutStatus.tsx',import.meta.url),'utf8')
  assert.match(notice,/SWITCH REVIEWER DURATION/)
  assert.match(notice,/CONTINUE TO CHECKOUT/)
  assert.match(notice,/cancel-manual-checkout-claim/)
  assert.match(notice,/\/checkout\/qr\?items=/)
  assert.match(notice,/claim\.status === 'awaiting_proof'/)
})

test('pending purchase actions are unboxed, stacked on mobile, and inline on wide or landscape screens', () => {
  const css = postcss.parse(readFileSync(new URL('../../src/components/ManualCheckoutStatus.css', import.meta.url), 'utf8'))
  const rules = (root, selector) => root.nodes.filter(node => node.type === 'rule' && node.selectors.includes(selector))
  const value = (rule, property) => rule?.nodes.find(node => node.type === 'decl' && node.prop === property)?.value
  const layout = rules(css, '.manual-checkout-actions')[0]
  assert.equal(value(layout, 'display'), 'flex')
  assert.equal(value(layout, 'flex-direction'), 'column')
  const horizontal = css.nodes.filter(node => node.type === 'atrule' && node.name === 'media')
    .filter(media => /min-width|orientation:\s*landscape/.test(media.params))
    .some(media => rules(media, '.manual-checkout-actions').some(rule => value(rule, 'flex-direction') === 'row'))
  assert.equal(horizontal, true)
  const switchAction = rules(css, '.manual-checkout-actions .manual-checkout-switch-button')[0]
  const cancelAction = rules(css, '.manual-checkout-actions .manual-checkout-cancel-button')[0]
  assert.equal(value(switchAction, 'border'), '0')
  assert.equal(value(cancelAction, 'border'), '0')
})

test('new checkouts can exclude already pending tracks without blocking different reviewers', () => {
  const basket = readFileSync(new URL('../../src/screens/BasketScreen.tsx',import.meta.url),'utf8')
  const account = readFileSync(new URL('../../src/screens/AccountScreen.tsx',import.meta.url),'utf8')
  const qr = readFileSync(new URL('../../src/screens/AdminQrCheckoutScreen.tsx',import.meta.url),'utf8')
  assert.match(basket,/useManualCheckoutClaims/)
  assert.match(basket,/pendingManualTracks/)
  assert.match(basket,/disabled=\{busy \|\| manualClaimsLoading \|\|/)
  assert.match(account,/pendingManualCodes/)
  assert.match(qr,/CHANGE REVIEWER DURATION/)
  assert.doesNotMatch(qr,/BUY A DIFFERENT TRACK|OPEN MESSENGER AGAIN/)
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
