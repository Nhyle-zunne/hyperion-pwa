import assert from 'node:assert/strict'
import test from 'node:test'
import { canPerformPwaPaymentAction } from '../../src/lib/pwaPurchaseAvailability.ts'

test('new website payments and extensions are blocked during the pause', () => {
  for (const action of ['buy', 'extend', 'checkout', 'resume', 'manual-payment']) {
    assert.equal(canPerformPwaPaymentAction(action, true), false, `${action} must not start a new payment`)
  }
})

test('existing payment verification and cancellation remain available', () => {
  for (const action of ['verify', 'cancel']) {
    assert.equal(canPerformPwaPaymentAction(action, true), true, `${action} must remain available`)
  }
})

test('removing the pause re-enables purchases without changing recovery actions', () => {
  assert.equal(canPerformPwaPaymentAction('checkout', false), true)
  assert.equal(canPerformPwaPaymentAction('verify', false), true)
})
