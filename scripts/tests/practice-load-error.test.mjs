import test from 'node:test'
import assert from 'node:assert/strict'
import { practiceLoadErrorMessage } from '../../src/lib/practiceLoadError.ts'

test('an expired session tells the user how to recover rather than hiding the problem', () => {
  assert.equal(
    practiceLoadErrorMessage(new Error('Your sign-in session has expired. Please sign in again to load licensed questions.')),
    'Your sign-in session has expired. Please sign in again to load licensed questions.'
  )
})

test('unexpected internal errors do not disclose details in the practice screen', () => {
  const message = practiceLoadErrorMessage(new Error('Internal SQL table private_questions is unavailable'))
  assert.match(message, /check your connection/i)
  assert.doesNotMatch(message, /private_questions|SQL/i)
})

test('a stale bank revision gives the user a specific retry action', () => {
  assert.equal(
    practiceLoadErrorMessage(new Error('The question bank changed while loading. Reload this question set.')),
    'The question bank changed while loading. Reload this question set.'
  )
})

test('a live license denial is not misreported as a connection problem', () => {
  assert.equal(
    practiceLoadErrorMessage(new Error('An active license is required for this track.')),
    'An active license is required for this track.'
  )
})
