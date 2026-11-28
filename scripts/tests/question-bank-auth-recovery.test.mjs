import test from 'node:test'
import assert from 'node:assert/strict'
import { invokeBankTransport } from '../../src/lib/questionBankTransport.ts'

const paidRange = {
  body: { action: 'questions', track: 'DECK_OIC_NW', competenceId: 'C1', offset: 500, limit: 100, freeOnly: false }
}

test('a rejected paid #501–#600 request renews its signed-in session and retries the same range once', async () => {
  const requests = []
  let refreshes = 0
  const user = { id: 'same-account' }
  const client = {
    auth: {
      getSession: async () => ({ data: { session: { access_token: 'expired-token', user } }, error: null }),
      refreshSession: async () => {
        refreshes++
        return { data: { session: { access_token: 'renewed-token', user } }, error: null }
      }
    }
  }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async (_url, options) => {
    const { offset, limit } = JSON.parse(options.body)
    requests.push({ offset, limit, authorization: options.headers.Authorization })
    return requests.length === 1
      ? Response.json({ error: 'Invalid token' }, { status: 401 })
      : Response.json({ questions: Array.from({ length: 100 }, (_, i) => ({ id: `question-${i + 501}` })) })
  })

  assert.equal(result.error, null)
  assert.equal(result.data.questions.length, 100)
  assert.deepEqual(requests, [
    { offset: 500, limit: 100, authorization: 'Bearer expired-token' },
    { offset: 500, limit: 100, authorization: 'Bearer renewed-token' }
  ])
  assert.equal(refreshes, 1)
})

test('a missing paid session asks the user to sign in without sending an anonymous question request', async () => {
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: null }) } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () => {
    throw Error('Protected questions must not be requested anonymously')
  })
  assert.equal(result.data, null)
  assert.match(result.error.message, /sign in/i)
})

test('a token without an owner never authorizes a paid question request', async () => {
  const client = { auth: { getSession: async () => ({ data: { session: { access_token: 'orphan-token' } }, error: null }) } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () => {
    throw Error('A token with no account owner must never reach protected delivery')
  })
  assert.match(result.error.message, /sign in/i)
})

test('an expired refresh token discovered by getSession tells the user to sign in again', async () => {
  const authError = Object.assign(new Error('Invalid Refresh Token: Refresh Token Not Found'), {
    code: 'refresh_token_not_found', status: 400
  })
  const client = { auth: { getSession: async () => ({ data: { session: null }, error: authError }) } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () => {
    throw Error('Protected delivery must not be called for an expired refresh token')
  })
  assert.match(result.error.message, /sign in again/i)
  assert.doesNotMatch(result.error.message, /refresh token/i)
})

test('an expired refresh token thrown by getSession receives the same sign-in guidance', async () => {
  const client = { auth: { getSession: async () => { throw Error('Invalid Refresh Token: Refresh Token Not Found') } } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () => {
    throw Error('Protected delivery must not be called for an expired refresh token')
  })
  assert.match(result.error.message, /sign in again/i)
})

test('a 403 license rejection never refreshes credentials or retries protected delivery', async () => {
  let requests = 0
  const client = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'valid-token', user: { id: 'account' } } }, error: null }),
    refreshSession: async () => { throw Error('A forbidden license must not trigger token refresh') }
  } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () => {
    requests++
    return Response.json({ error: 'An active license is required for this track.' }, { status: 403 })
  })
  assert.equal(result.error.context.status, 403)
  assert.equal(requests, 1)
})

test('a renewed token rejected again stops after one retry and asks for a fresh sign-in', async () => {
  let requests = 0
  const user = { id: 'same-account' }
  const client = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'old', user } }, error: null }),
    refreshSession: async () => ({ data: { session: { access_token: 'new', user } }, error: null })
  } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () => {
    requests++
    return Response.json({ error: 'Invalid session' }, { status: 401 })
  })
  assert.equal(requests, 2)
  assert.match(result.error.message, /sign in again/i)
})

test('a failed session refresh after 401 asks for reauthentication', async () => {
  const user = { id: 'same-account' }
  const client = { auth: {
    getSession: async () => ({ data: { session: { access_token: 'old', user } }, error: null }),
    refreshSession: async () => { throw Error('Invalid Refresh Token: Refresh Token Not Found') }
  } }
  const result = await invokeBankTransport(paidRange, client, 'anon-key', true, async () =>
    Response.json({ error: 'JWT expired' }, { status: 401 }))
  assert.match(result.error.message, /sign in again/i)
})
