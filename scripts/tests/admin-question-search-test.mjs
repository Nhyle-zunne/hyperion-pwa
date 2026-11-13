import assert from 'node:assert/strict'
import { createHash, webcrypto } from 'node:crypto'
import { createBankWorker } from '../../worker/index.ts'
import { SOURCE_ASSETS, deriveKeyBytes } from '../../supabase/functions/_shared/bankCodec.ts'
import { createAdminQuestionSearch } from '../../worker/adminQuestionSearch.ts'

const standard = (questions) => ['No.,Question,A,B,C,D,Correct Answer,Explanation,HYPERION_STATUS,HYPERION_MEDIA', ...questions.map((q, index) => [index + 1, q.text, 'One', 'Two', 'Three', 'Four', 'A', 'Secret explanation', q.retired ? 'RETIRED' : '', q.image ? JSON.stringify([{ sha256: 'a'.repeat(64), mime: 'image/png', placement: 'question', alt: 'Question diagram' }]) : ''].map(value => '"' + String(value).replaceAll('"', '""') + '"').join(','))].join('\n')
const csv = path => path.startsWith('gmdss/') ? 'Question,Type,Option1,Option2,Option3,Option4,Option5,Option6,Explanation,Answer\nBeacon Match,Choice,One,Two,Three,Four,,,Secret explanation,A' : standard([{ text: 'Beacon Match' }, { text: '', image: true }, { text: 'Retired beacon', retired: true }])
const revision = 'a'.repeat(40)
const release = { revision, publishedAt: '2026-11-01T00:00:00Z', files: [] }
let reads = 0, concurrent = 0, peak = 0
const source = { read: async (path, pinned, persist) => { assert.equal(pinned, release); assert.equal(persist, false); reads++; concurrent++; peak = Math.max(peak, concurrent); await new Promise(resolve => setTimeout(resolve, 1)); concurrent--; return csv(path) } }
const search = createAdminQuestionSearch()
const collect = async (run, input) => {
  const results = []; let cursor = 0, page
  do { page = await run({ ...input, cursor, bankRevision: revision, limit: 100 - results.length }); results.push(...page.results); cursor = page.nextCursor } while (cursor !== null && !page.truncated && results.length < 100)
  return { ...page, results }
}
const firstPage = await search(source, release, { query: 'BEACON match', limit: 100 })
assert.equal(firstPage.results.length, 12)
assert.equal(firstPage.nextCursor, 12)
assert.equal(firstPage.truncated, false)
assert.equal(reads, 12, 'Cold pages scan at most twelve banks')
const all = await collect(input => search(source, release, input), { query: 'BEACON match' })
assert.equal(all.results.length, SOURCE_ASSETS.length)
assert.equal(all.truncated, false)
assert.equal(all.bankRevision, revision)
assert.deepEqual(all.results.map(item => item.track).filter((item, index, items) => index === 0 || item !== items[index - 1]), ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'])
assert.deepEqual(all.results.filter(item => item.track === 'DECK_OIC_NW').map(item => item.competenceId), ['C1','C2','C3','C4','C5','C7','C9','C10','C11','C12','C13','C17'])
assert.deepEqual(all.results.filter(item => item.track === 'GMDSS_GOC' && item.competenceId === 'C1').map(item => item.part), [1,2,3,4,5,6,7,8,9,10])
assert.ok(peak <= 4)
const warmReads = reads
assert.equal((await collect(input => search(source, release, input), { query: 'missing' })).results.length, 0)
assert.equal(reads, warmReads, 'Warm searches reuse parsed indexes')
const images = await search(source, release, { query: '2', track: 'DECK_OIC_NW', limit: 100 })
assert.equal(images.results.length, 12)
assert.ok(images.results.every(item => item.ordinal === 2 && item.questionText === ''))
const retired = await search(source, release, { query: 'Retired', track: 'DECK_OIC_NW', limit: 100 })
assert.ok(retired.results.every(item => item.ordinal === 3))
assert.deepEqual(Object.keys(retired.results[0]).sort(), ['path','ordinal','questionText','track','competenceId','part'].sort())
const browse = await search(source, release, { query: '', limit: 2 })
assert.equal(browse.results.length, 2)
assert.equal(browse.truncated, true)
assert.equal(browse.nextCursor, null)
assert.equal((await search(source, release, { query: '02', track: 'DECK_OIC_NW' })).results.length, 0, 'Numeric strings match the exact ordinal')
await assert.rejects(createAdminQuestionSearch()({ read: async () => { throw Error('Unavailable bank') } }, release, { query: 'missing', limit: 100 }), /Unavailable bank/)

const boundedSearch = createAdminQuestionSearch()
let versionReads = 0
const versionSource = { read: async () => { versionReads++; return standard([{ text: 'Versioned question' }]) } }
const scanVersion = async bankRevision => { let cursor = 0, page; do { page = await boundedSearch(versionSource, { ...release, revision: bankRevision }, { query: 'missing', cursor }); cursor = page.nextCursor } while (cursor !== null) }
await scanVersion('1'.repeat(40))
await scanVersion('1'.repeat(40))
assert.equal(versionReads, SOURCE_ASSETS.length)
await scanVersion('2'.repeat(40))
await scanVersion('3'.repeat(40))
await scanVersion('1'.repeat(40))
assert.equal(versionReads, SOURCE_ASSETS.length * 4, 'Indexes use immutable revisions and evict older banks after two full revisions')

const key = await webcrypto.subtle.importKey('raw', deriveKeyBytes(), 'AES-GCM', false, ['encrypt'])
const encrypted = new Map()
for (const path of SOURCE_ASSETS) {
  const iv = webcrypto.getRandomValues(new Uint8Array(12))
  const bytes = Buffer.concat([iv, Buffer.from(await webcrypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, new TextEncoder().encode(csv(path))))])
  encrypted.set(path, bytes)
  release.files.push({ path, bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') })
}
const manifest = JSON.stringify({ version: 1, encrypted: true, files: release.files })
const pointer = JSON.stringify({ version: 1, revision, manifestSha256: createHash('sha256').update(manifest).digest('hex'), publishedAt: release.publishedAt, publicationId: 'test', inputDigest: 'b'.repeat(64) })
let authorized = true, bankReads = 0, authCalls = 0, failedPath = ''
const fetcher = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input.url)
  if (url.hostname.endsWith('supabase.co')) { authCalls++; assert.equal(JSON.parse(options.body).action, 'github-admin-access'); return Response.json({ allowed: authorized, access: authorized ? 'admin' : 'denied' }, { status: authorized ? 200 : 403 }) }
  if (url.pathname.endsWith('/hyperion-release.json')) return new Response(pointer)
  if (url.pathname.endsWith('/hyperion-manifest.json')) return new Response(manifest)
  const path = SOURCE_ASSETS.find(path => url.pathname.endsWith('/' + path.replace(/^gmdss\//, 'pro/')))
  assert.ok(path)
  bankReads++
  return path === failedPath ? new Response('', { status: 503 }) : new Response(encrypted.get(path))
}
const env = { ASSETS: { fetch: async () => Response.json({ supabaseUrl: 'https://evnjoezffghtrzqacwcj.supabase.co', supabaseAnonKey: 'test-key' }) } }
const worker = createBankWorker(fetcher)
const request = (body, { token = true, origin = 'https://hyperion.test', handler = worker } = {}) => handler(new Request('https://hyperion.test/api/question-bank/admin', { method: 'POST', headers: { ...(token ? { Authorization: 'Bearer admin' } : {}), Origin: origin }, body: JSON.stringify({ action: 'editor-search', ...body }) }), env)
assert.equal((await request({ query: '' }, { token: false })).status, 401)
assert.equal((await request({ query: '' }, { origin: 'https://elsewhere.test' })).status, 403)
authorized = false
assert.equal((await request({ query: '' })).status, 403)
assert.equal(bankReads, 0)
authorized = true
for (const invalid of [{ query: 2 }, { query: 'x'.repeat(161) }, { query: '', track: 'unknown' }, { query: '', track: null }, { query: '', limit: 0 }, { query: '', limit: 101 }, { query: '', limit: 1.5 }, { query: '', limit: '2' }, { query: '', cursor: -1 }, { query: '', cursor: 0.5 }, { query: '', cursor: SOURCE_ASSETS.length + 1 }, { query: '', bankRevision: 'bad' }]) assert.equal((await request(invalid)).status, 400, JSON.stringify(invalid))
assert.equal(bankReads, 0)
const response = await request({ query: '  Beacon MATCH  ', limit: 100 })
assert.equal(response.status, 200)
assert.equal(response.headers.get('Cache-Control'), 'no-store')
const result = await response.json()
assert.equal(result.results.length, 12)
assert.equal(result.nextCursor, 12)
const complete = await collect(async input => { const page = await request(input); assert.equal(page.status, 200); return page.json() }, { query: 'Beacon Match' })
assert.equal(complete.results.length, SOURCE_ASSETS.length)
assert.equal(result.bankRevision, revision)
assert.equal(result.truncated, false)
const readsAfterSearch = bankReads, authBeforeWarm = authCalls
assert.equal((await request({ query: 'missing' })).status, 200)
assert.equal(bankReads, readsAfterSearch)
assert.equal(authCalls, authBeforeWarm + 1, 'Warm indexes still require fresh admin verification')
const defaultBrowse = await (await request({ query: '' })).json()
assert.equal(defaultBrowse.results.length, 36)
assert.equal(defaultBrowse.truncated, false)
assert.equal(defaultBrowse.nextCursor, 12)
assert.equal((await request({ query: '', bankRevision: 'c'.repeat(40) })).status, 409)
failedPath = SOURCE_ASSETS[0]
assert.equal((await request({ query: 'missing' }, { handler: createBankWorker(fetcher) })).status, 503, 'An unavailable bank must fail search instead of returning a false empty success')
console.log('PASS: protected admin cross-bank search, input validation, numeric ordering, immutable warm indexes, retirement/image slots and failure handling.')

const longPreview = await createAdminQuestionSearch()({ read: async () => standard([{ text: 'x'.repeat(700) + ' uncommon suffix' }]) }, release, { query: 'uncommon suffix', track: 'ENGINE_MGT', limit: 1 })
assert.equal(longPreview.results.length, 1, 'Search still matches text beyond the preview boundary')
assert.equal(longPreview.results[0].questionText.length, 500, 'Metadata previews cannot grow into full bank-sized responses')
