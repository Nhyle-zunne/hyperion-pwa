import { expect, test } from 'bun:test'
import { invokeBankTransport } from '../../src/lib/questionBankTransport'

test('GitHub count metadata uses the public Worker without auth or Supabase calls', async () => {
  let requests = 0
  const client: any = { auth: { getSession: () => { throw Error('Metadata must not ask for a session') } }, functions: { invoke: () => { throw Error('Metadata must not invoke Supabase') } } }
  const result = await invokeBankTransport({ body: { action: 'counts', track: 'GMDSS_GOC', freeOnly: true, bankRevision: 'a'.repeat(40) } }, client, 'anon', true, (async (input: any, options: any) => {
    requests++
    const url = new URL(input, 'https://hyperionmaritime.org')
    expect(url.pathname).toBe('/api/question-bank/counts')
    expect(url.searchParams.get('track')).toBe('GMDSS_GOC')
    expect(url.searchParams.get('freeOnly')).toBe('1')
    expect(url.searchParams.get('bankRevision')).toBe('a'.repeat(40))
    expect(options?.headers?.Authorization).toBeUndefined()
    return Response.json({ counts: [{ competenceId: 'C1', part: 1, count: 90 }] })
  }) as typeof fetch)
  expect(result.error).toBe(null)
  expect(result.data.counts[0].count).toBe(90)
  expect(requests).toBe(1)
})
test('public catalog counts work without an account client while paid pages still send identity', async () => {
  const received: any[] = []
  const fetcher = (async (url: any, options: any) => { received.push([url, options]); return Response.json({ counts: [] }) }) as typeof fetch
  await invokeBankTransport({ body: { action: 'catalog-counts', track: 'DECK_MGT' } }, null, '', true, fetcher)
  const client: any = { auth: { getSession: async () => ({ data: { session: { access_token: 'user-token' } } }) } }
  await invokeBankTransport({ body: { action: 'questions', track: 'DECK_MGT' } }, client, 'anon', true, fetcher)
  expect(received[0][0]).toContain('/api/question-bank/counts?')
  expect(received[1][0]).toBe('/api/question-bank/questions')
  expect(received[1][1].headers.Authorization).toBe('Bearer user-token')
})
test('legacy configurations retain Supabase routing and Worker errors retain HTTP status', async () => {
  let action = ''
  const client: any = { functions: { invoke: async (_: string, options: any) => { action = options.body.action; return { data: { counts: [] }, error: null } } } }
  await invokeBankTransport({ body: { action: 'counts' } }, client, '', false)
  expect(action).toBe('counts')
  const failure = await invokeBankTransport({ body: { action: 'counts', track: 'DECK_MGT' } }, client, '', true, (async () => Response.json({ error: 'Release changed' }, { status: 409 })) as typeof fetch)
  expect(failure.error.context.status).toBe(409)
})
