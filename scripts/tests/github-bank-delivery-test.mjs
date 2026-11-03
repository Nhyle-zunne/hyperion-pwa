import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createBankWorker } from '../../worker/index.ts'
import { createGithubBankSource, GITHUB_BANK_REVISION, GITHUB_BANK_ROOT, githubBankRequest } from '../../supabase/functions/_shared/githubBankSource.ts'
import { SOURCE_ASSETS, toSearchQuestions, sampleFreeCsv, sourceInfo } from '../../supabase/functions/_shared/bankCodec.ts'
const manifest = JSON.parse(await readFile(new URL('../../supabase/functions/_shared/github-bank-manifest.json', import.meta.url), 'utf8'))
const folder = join(tmpdir(), 'hyperion-bank-' + GITHUB_BANK_REVISION)
await mkdir(folder, { recursive: true })
const bank = new Map()
for (let i = 0; i < manifest.files.length; i += 4) await Promise.all(manifest.files.slice(i, i + 4).map(async file => {
  const path = join(folder, file.path.replaceAll('/', '__'))
  let bytes
  try { bytes = await readFile(path) } catch {}
  if (!bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) {
    const response = await fetch(githubBankRequest(file.path, GITHUB_BANK_REVISION, process.env.GITHUB_BANK_READ_TOKEN))
    if (!response.ok) throw new Error('Could not fetch encrypted bank test fixture (HTTP ' + response.status + '). For a private bank repository, configure the BANK_READ_TOKEN Actions secret with Contents read access to hyperion-reviewer.')
    bytes = Buffer.from(await response.arrayBuffer())
    await writeFile(path, bytes)
  }
  if (bytes.length !== file.bytes || createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Bank checksum mismatch: ' + file.path)
  bank.set(file.path, bytes)
}))
assert.deepEqual([...bank.keys()].sort(), SOURCE_ASSETS.slice().sort())
let licensed = true, backendAvailable = true, corrupt = false, upstreamBankReads = 0, supabaseRequests = 0
const fakeFetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname.endsWith('.supabase.co')) {
    supabaseRequests++
    const body = JSON.parse(options.body)
    assert.equal(body.action, 'github-delivery-access')
    const headers = new Headers(options.headers)
    const allowed = body.freeOnly || (licensed && headers.get('Authorization') === 'Bearer test-user')
    return new Response(JSON.stringify({ allowed, track: body.track, access: body.freeOnly ? 'free-sample' : 'licensed' }), { status: !backendAvailable ? 503 : allowed ? 200 : 403 })
  }
  if (url.pathname.endsWith('/hyperion-release.json')) return new Response('', { status: 404 })
  assert.equal(url.hostname, 'raw.githubusercontent.com')
  assert.ok(url.pathname.includes(GITHUB_BANK_REVISION))
  const path = url.pathname.split('/' + GITHUB_BANK_ROOT + '/')[1].replace(/^pro\//, 'gmdss/')
  upstreamBankReads++
  const bytes = bank.get(path)
  return new Response(corrupt ? new Uint8Array([1, 2, 3]) : bytes, { status: bytes ? 200 : 404 })
}
const assets = { fetch: async () => new Response(JSON.stringify({ supabaseUrl: 'https://evnjoezffghtrzqacwcj.supabase.co', supabaseAnonKey: 'sb_publishable_test_only' })) }
const worker = createBankWorker(fakeFetch)
const request = (body, handler = worker, token = 'test-user') => handler(new Request('https://hyperionmaritime.org/api/question-bank/questions', { method: 'POST', headers: token ? { Authorization: 'Bearer ' + token } : {}, body: JSON.stringify(body) }), { ASSETS: assets })
const selection = { track: 'DECK_OIC_NW', competenceId: 'C1', offset: 0, limit: 20, freeOnly: false }
let response = await request(selection)
assert.equal(response.status, 200)
let page = await response.json()
assert.equal(page.source, 'github')
assert.equal(page.bankRevision, GITHUB_BANK_REVISION)
assert.equal(page.questions.length, 20)
const originalSource = createGithubBankSource(fakeFetch)
const text = await originalSource('deck/oic_nw_c1.csv.enc')
assert.deepEqual(page.questions, toSearchQuestions('deck/oic_nw_c1.csv.enc', text).slice(0, 20))
const reads = upstreamBankReads
licensed = false
response = await request(selection)
assert.equal(response.status, 403)
assert.equal(upstreamBankReads, reads, 'A warm cache must not bypass a revoked license')
response = await request(selection, worker, '')
assert.equal(response.status, 403)
response = await request({ ...selection, freeOnly: true }, worker, '')
assert.equal(response.status, 200)
page = await response.json()
assert.equal(page.access, 'free-sample')
assert.deepEqual(page.questions, toSearchQuestions('deck/oic_nw_c1.csv.enc', sampleFreeCsv('deck/oic_nw_c1.csv.enc', text)).slice(0, 20))
licensed = true; backendAvailable = false
assert.equal((await request(selection)).status, 503)
assert.equal(upstreamBankReads, reads, 'Failed authorization must not fetch or disclose bank data')
backendAvailable = true; corrupt = true
assert.equal((await request(selection, createBankWorker(fakeFetch))).status, 503)
corrupt = false
assert.equal((await request({ ...selection, limit: 201 })).status, 400)
assert.equal((await request({ ...selection, randomSample: true, offset: 1 })).status, 400)
await assert.rejects(originalSource('../../private'), /Unsupported/)
const compatibility = JSON.parse(await readFile(new URL('./fixtures/github-bank-compatibility.json', import.meta.url), 'utf8'))
let total = 0
for (const path of SOURCE_ASSETS) {
  const csv = await originalSource(path)
  const questions = toSearchQuestions(path, csv)
  assert.ok(questions.every(question => typeof question.id === 'string' && question.track && question.options.length > 1))
  assert.equal(questions.length, compatibility.files[path].count, 'Question count changed: ' + path)
  assert.equal(createHash('sha256').update(JSON.stringify(questions)).digest('hex'), compatibility.files[path].semanticSha256, 'Saved-question compatibility changed: ' + path)
  total += questions.length
}
console.log(`PASS: all ${SOURCE_ASSETS.length} GitHub bank hashes/parsers (${total} questions), original IDs/content, anonymous denial, paid/free gating, revocation despite warm cache, failed authorization, integrity failure and range validation.`)

const countsRequest = (track, freeOnly = false, revision, handler = worker) => handler(new Request('https://hyperionmaritime.org/api/question-bank/counts?track=' + track + '&freeOnly=' + Number(freeOnly) + (revision ? '&bankRevision=' + revision : '')), { ASSETS: assets })
const beforeCountAuth = supabaseRequests
for (const [track, expectedTotal] of Object.entries({ DECK_OIC_NW: 6448, GMDSS_GOC: 2260, ENGINE_OIC_EW: 5380, DECK_MGT: 6075, ENGINE_MGT: 5589 })) {
  const result = await countsRequest(track)
  assert.equal(result.status, 200)
  assert.match(result.headers.get('Cache-Control'), /public/)
  const metadata = await result.json()
  assert.equal(metadata.bankRevision, GITHUB_BANK_REVISION)
  assert.equal(metadata.counts.reduce((sum, item) => sum + item.count, 0), expectedTotal)
  const expected = SOURCE_ASSETS.filter(path => sourceInfo(path)?.track === track).map(path => ({ competenceId: sourceInfo(path).competenceId, part: sourceInfo(path).part, count: compatibility.files[path].count }))
  assert.deepEqual(metadata.counts, expected)
  assert.equal(JSON.stringify(metadata).includes('questionText'), false)
}
const freeMetadata = await (await countsRequest('GMDSS_GOC', true)).json()
assert.equal(freeMetadata.counts.reduce((sum, item) => sum + item.count, 0), 1030)
const beforeRepeated = upstreamBankReads
await Promise.all(Array.from({ length: 5 }, () => countsRequest('DECK_OIC_NW')))
assert.equal(upstreamBankReads, beforeRepeated, 'Warm counts must not re-read bank assets')
assert.equal(supabaseRequests, beforeCountAuth, 'Public metadata must never invoke Supabase auth or counts')
assert.equal((await countsRequest('invalid')).status, 400)
assert.equal((await countsRequest('DECK_OIC_NW', false, 'a'.repeat(40))).status, 409)
console.log('PASS: public release-pinned full/free counts for all tracks, immutable caches and zero Supabase metadata/auth requests.')

const persistent = new Map()
const fakeEdgeCache = { match: async request => persistent.get(request.url)?.clone(), put: async (request, response) => { persistent.set(request.url, response.clone()) } }
const coldCounts = createBankWorker(fakeFetch, fakeEdgeCache)
await countsRequest('GMDSS_GOC', false, undefined, coldCounts)
const readsBeforeNewIsolate = upstreamBankReads
const nextIsolate = createBankWorker(fakeFetch, fakeEdgeCache)
assert.equal((await countsRequest('GMDSS_GOC', false, undefined, nextIsolate)).status, 200)
assert.equal(upstreamBankReads, readsBeforeNewIsolate, 'A new isolate reuses Cloudflare cached aggregates')
corrupt = true
const retryWorker = createBankWorker(fakeFetch)
assert.equal((await countsRequest('DECK_MGT', false, undefined, retryWorker)).status, 503)
corrupt = false
assert.equal((await countsRequest('DECK_MGT', false, undefined, retryWorker)).status, 200, 'Failed metadata computations must not poison the cache')
console.log('PASS: Cloudflare aggregate reuse across isolates and recovery after corrupt upstream assets.')

let subrequests = 0
const spend = () => { if (++subrequests > 50) throw Error('Too many subrequests') }
const limitedFetch = async (...args) => { spend(); return fakeFetch(...args) }
const limitedCache = { match: async () => { spend(); return undefined }, put: async () => { spend() } }
const boundedWorker = createBankWorker(limitedFetch, limitedCache)
const boundedResponse = await countsRequest('DECK_MGT', false, undefined, boundedWorker)
assert.equal(boundedResponse.status, 200, 'Cold counts must fit the Cloudflare Free subrequest limit')
assert.ok(subrequests <= 50)
console.log('PASS: cold largest-track counts fit the Cloudflare Free subrequest budget.')
