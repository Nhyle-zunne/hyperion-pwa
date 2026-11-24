import assert from 'node:assert/strict'
import test from 'node:test'
import { canPerformPwaPaymentAction, isWebsiteCheckoutEnabled } from '../../src/lib/pwaPurchaseAvailability.ts'

test('new website payments and extensions fail closed when disabled', () => {
  for (const action of ['buy', 'extend', 'checkout', 'resume', 'manual-payment']) {
    assert.equal(canPerformPwaPaymentAction(action, false), false, `${action} must not start a new payment`)
  }
})

test('existing payment verification and cancellation remain available', () => {
  for (const action of ['verify', 'cancel']) {
    assert.equal(canPerformPwaPaymentAction(action, false), true, `${action} must remain available`)
  }
})

test('enabling QR payments allows checkout without changing recovery actions', () => {
  assert.equal(canPerformPwaPaymentAction('checkout', true), true)
  assert.equal(canPerformPwaPaymentAction('verify', true), true)
})

test('enabled QR checkout allows Buy Now, extensions and checkout but not legacy payment routes', () => {
  for (const action of ['buy', 'extend', 'checkout']) {
    assert.equal(canPerformPwaPaymentAction(action, true), true, `${action} follows the enabled website checkout setting`)
  }
  for (const action of ['resume', 'manual-payment']) {
    assert.equal(canPerformPwaPaymentAction(action, true), false, `${action} stays disabled because legacy PayMongo payments remain retired`)
  }
})

test('checkout availability accepts only a server-returned true boolean', () => {
  assert.equal(isWebsiteCheckoutEnabled({ website_checkout_enabled: true }), true)
  for (const value of [{ website_checkout_enabled: false }, { website_checkout_enabled: 'true' }, {}, null]) {
    assert.equal(isWebsiteCheckoutEnabled(value), false)
  }
})
