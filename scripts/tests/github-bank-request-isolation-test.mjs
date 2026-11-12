import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createGithubBankSource, INITIAL_BANK_RELEASE, GITHUB_BANK_ROOT } from '../../supabase/functions/_shared/githubBankSource.ts'
import { createBankWorker } from '../../worker/index.ts'

// A disconnected request's I/O can stop progressing in Workers. A later
// request must not inherit its unfinished release, asset or count promise.
const stalled = new Promise(() => {})
async function completes(promise, label) {
  let timer
  try {
    return await Promise.race([promise, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error(label + ' inherited another request’s stalled I/O')), 250)
    })])
  } finally { clearTimeout(timer) }
}
let pointerReads = 0
const releaseSource = createGithubBankSource(async () => ++pointerReads === 1 ? stalled : new Response('', { status: 404 }))
void releaseSource.release()
assert.equal((await completes(releaseSource.release(), 'Release lookup')).revision, INITIAL_BANK_RELEASE.revision)

const file = INITIAL_BANK_RELEASE.files.find(file => file.path === 'deck/oic_nw_c1.csv.enc')
const fixtureDirectory = join(tmpdir(), 'hyperion-bank-' + INITIAL_BANK_RELEASE.revision)
const bytes = await readFile(join(fixtureDirectory, 'deck__oic_nw_c1.csv.enc'))
let assetReads = 0
const assetSource = createGithubBankSource(async () => ++assetReads === 1 ? stalled : new Response(bytes))
void assetSource.read(file.path, INITIAL_BANK_RELEASE)
const text = await completes(assetSource.read(file.path, INITIAL_BANK_RELEASE), 'Asset lookup')
assert.ok(text.length > 100)
assert.equal(await assetSource.read(file.path, INITIAL_BANK_RELEASE), text)
assert.equal(assetReads, 2, 'Completed verified text should still be reused')

let blockCounts = true
let started
const countStarted = new Promise(resolve => { started = resolve })
const fakeFetch = async input => {
  const url = new URL(input.url)
  if (url.pathname.endsWith('/hyperion-release.json')) return new Response('', { status: 404 })
  if (blockCounts) { started(); return stalled }
  const path = url.pathname.split('/' + GITHUB_BANK_ROOT + '/')[1].replace(/^pro\//, 'gmdss/')
  return new Response(await readFile(join(fixtureDirectory, path.replaceAll('/', '__'))))
}
const worker = createBankWorker(fakeFetch)
const request = () => worker(new Request('https://example.org/api/question-bank/counts?track=GMDSS_GOC'), { ASSETS: { fetch: async () => new Response() } })
// Warm the completed release, then stall only the first count request.
await worker(new Request('https://example.org/api/question-bank/source'), { ASSETS: { fetch: async () => new Response() } })
void request()
await countStarted
blockCounts = false
const response = await completes(request(), 'Track counts')
assert.equal(response.status, 200)
assert.equal((await response.json()).counts.length, 12)
console.log('PASS: stalled release, asset and count requests cannot block later requests; completed verified assets remain cached.')
