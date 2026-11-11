import assert from 'node:assert/strict'
import { canSkipQuestionBankAuthLookup } from '../functions/question-bank/publicAuthPolicy.ts'

Deno.test('public question-bank sample requests never require Auth user metadata', () => {
  for (const action of ['github-delivery-access', 'questions', 'counts']) {
    assert.equal(canSkipQuestionBankAuthLookup({ action, freeOnly: true }), true, action)
    assert.equal(canSkipQuestionBankAuthLookup({ action, freeOnly: false }), false, action)
    assert.equal(canSkipQuestionBankAuthLookup({ action }), false, action)
  }
  assert.equal(canSkipQuestionBankAuthLookup({ action: 'catalog-counts' }), true)
  assert.equal(canSkipQuestionBankAuthLookup({ action: 'catalog-counts', freeOnly: false }), true)
})

Deno.test('paid and legacy file paths always resolve and verify supplied identity', () => {
  for (const action of [
    'get', 'offline-license', 'github-admin-access', 'update-csv',
    'flashcards', 'search', 'verify-session-questions', 'download',
    'github-delivery-access', 'questions', 'counts'
  ]) {
    const request = { action, freeOnly: true }
    if (action === 'github-delivery-access' || action === 'questions' || action === 'counts') continue
    assert.equal(canSkipQuestionBankAuthLookup(request), false, action)
  }
  assert.equal(canSkipQuestionBankAuthLookup({ action: 'questions', freeOnly: 'true' }), false)
  assert.equal(canSkipQuestionBankAuthLookup({ freeOnly: true }), false)
  assert.equal(canSkipQuestionBankAuthLookup(null), false)
  assert.equal(canSkipQuestionBankAuthLookup(undefined), false)
})
