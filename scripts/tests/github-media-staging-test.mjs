import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createBankWorker } from '../../worker/index.ts'
import { stageGithubQuestionImage, createGithubMediaBundler } from '../../worker/githubMediaStore.ts'
import { checkMediaAssets } from '../../worker/questionMediaBundler.ts'
import { deriveKeyBytes } from '../../supabase/functions/_shared/bankCodec.ts'

const sha256 = data => createHash('sha256').update(data).digest('hex')
const png = Uint8Array.from([137,80,78,71,13,10,26,10,0,0,0,0,0,0,0,0])
const image = { track: 'DECK_OIC_NW', mime: 'image/png', sha256: sha256(png) }
const root = 'app/src/main/assets/question-media/' + image.track + '/' + image.sha256 + '.png.enc'
const upload = { action: 'media-upload', track: image.track, mime: image.mime, base64: Buffer.from(png).toString('base64') }
const MAIN = '1'.repeat(40), BASE_TREE = '2'.repeat(40)
function githubFixture() {
  const branches = new Map([['main', MAIN]])
  const commits = new Map([[MAIN, BASE_TREE]])
  const trees = new Map([[BASE_TREE, new Map()]])
  const blobs = new Map()
  const requests = []
  let counter = 3, writes = 0, supabaseCalls = 0
  let adminAllowed = true
  const nextSha = () => (counter++).toString(16).padStart(40, '0')
  const fetcher = async (input, init = {}) => {
    const url = new URL(typeof input === 'string' ? input : input.url)
    const method = init.method || 'GET'
    requests.push({ url: url.toString(), method })
    if (url.hostname.endsWith('.supabase.co')) {
      supabaseCalls++
      const body = JSON.parse(init.body)
      assert.equal(body.action, 'github-admin-access', 'No Supabase media storage or build calls')
      return Response.json(adminAllowed ? { allowed: true, access: 'admin' } : { allowed: false }, { status: adminAllowed ? 200 : 403 })
    }
    assert.equal(url.hostname, 'api.github.com')
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer fake-github-write-token')
    const path = url.pathname.split('/repos/Nhyle-zunne/hyperion-reviewer/')[1]
    const body = init.body ? JSON.parse(init.body) : null
    if (method === 'GET' && path.startsWith('git/ref/heads/')) {
      const name = path.slice('git/ref/heads/'.length)
      const sha = branches.get(name)
      return sha ? Response.json({ object: { sha } }) : new Response('', { status: 404 })
    }
    if (method === 'GET' && path.startsWith('git/commits/')) {
      const tree = commits.get(path.slice('git/commits/'.length))
      return tree ? Response.json({ tree: { sha: tree } }) : new Response('', { status: 404 })
    }
    if (method === 'GET' && path.startsWith('contents/')) {
      const branch = url.searchParams.get('ref')
      const head = branches.get(branch)
      const tree = commits.get(head)
      const blobSha = trees.get(tree)?.get(path.slice('contents/'.length))
      return blobSha ? new Response(blobs.get(blobSha)) : new Response('', { status: 404 })
    }
    writes++
    if (method === 'POST' && path === 'git/refs') {
      assert.equal(body.ref, 'refs/heads/hyperion-media-staging')
      assert.equal(body.sha, branches.get('main'))
      branches.set('hyperion-media-staging', body.sha)
      return Response.json({ ref: body.ref }, { status: 201 })
    }
    if (method === 'POST' && path === 'git/blobs') {
      assert.equal(body.encoding, 'base64')
      const sha = nextSha()
      blobs.set(sha, Uint8Array.from(Buffer.from(body.content, 'base64')))
      return Response.json({ sha }, { status: 201 })
    }
    if (method === 'POST' && path === 'git/trees') {
      const sha = nextSha()
      const tree = new Map(trees.get(body.base_tree))
      for (const entry of body.tree) {
        assert.equal(entry.mode, '100644')
        assert.equal(entry.type, 'blob')
        tree.set(entry.path, entry.sha)
      }
      trees.set(sha, tree)
      return Response.json({ sha }, { status: 201 })
    }
    if (method === 'POST' && path === 'git/commits') {
      assert.equal(body.parents.length, 1)
      assert.equal(body.parents[0], branches.get('hyperion-media-staging'))
      const sha = nextSha()
      commits.set(sha, body.tree)
      return Response.json({ sha }, { status: 201 })
    }
    if (method === 'PATCH' && path === 'git/refs/heads/hyperion-media-staging') {
      assert.equal(body.force, false)
      branches.set('hyperion-media-staging', body.sha)
      return Response.json({ object: { sha: body.sha } })
    }
    throw new Error('Unexpected GitHub request ' + method + ' ' + path)
  }
  return {
    fetcher, branches, commits, trees, blobs, requests,
    get writes() { return writes },
    get supabaseCalls() { return supabaseCalls },
    setAdminAllowed(value) { adminAllowed = value },
    getStaged() {
      const tree = commits.get(branches.get('hyperion-media-staging'))
      const blob = trees.get(tree)?.get(root)
      return blob ? blobs.get(blob) : undefined
    }
  }
}

const github = githubFixture(), token = 'fake-github-write-token'
const uploaded = await stageGithubQuestionImage(github.fetcher, token, upload)
assert.deepEqual(uploaded, { ...image, bytes: png.length, source: 'github' })
assert.equal(github.branches.get('main'), MAIN, 'Unpublished images must not move main')
assert.notEqual(github.branches.get('hyperion-media-staging'), MAIN, 'Image is safely staged')
const encrypted = github.getStaged()
assert.ok(encrypted)
assert.notDeepEqual(encrypted, png)
assert.equal(encrypted.length, png.length + 28)
const key = await crypto.subtle.importKey('raw', Uint8Array.from(deriveKeyBytes()), 'AES-GCM', false, ['decrypt'])
assert.deepEqual(new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: encrypted.slice(0, 12) }, key, encrypted.slice(12))), png)
const writes = github.writes
assert.deepEqual(await stageGithubQuestionImage(github.fetcher, token, upload), uploaded)
assert.equal(github.writes, writes, 'Re-uploading identical image makes no Git writes')
const media = await createGithubMediaBundler(github.fetcher, token)([image])
assert.equal(media.length, 1)
assert.equal(media[0].path, 'question-media/' + image.track + '/' + image.sha256 + '.png.enc')
await checkMediaAssets([image], { assets: media })
assert.equal(github.supabaseCalls, 0, 'Image staging and publishing use GitHub exclusively')
assert.equal(github.branches.get('main'), MAIN)

for (const invalid of [
  { ...upload, track: '../malicious' },
  { ...upload, mime: 'image/svg+xml' },
  { ...upload, base64: 'not base64!' },
  { ...upload, base64: Buffer.from('not an image').toString('base64') },
]) {
  const before = github.writes
  await assert.rejects(() => stageGithubQuestionImage(github.fetcher, token, invalid), /invalid|valid|unsupported/i)
  assert.equal(github.writes, before, 'Invalid input never writes GitHub')
}
const missing = { ...image, sha256: 'f'.repeat(64) }
await assert.rejects(() => createGithubMediaBundler(github.fetcher, token)([missing]), /not staged/i, 'Publishing a missing image must fail closed')
assert.equal(github.writes, writes)

// Admin UI uses the SAME existing bank administrator access gate.
// Neither an unsigned client nor an unapproved user can stage GitHub content.
const handler = createBankWorker(github.fetcher)
const config = { ASSETS: { fetch: async () => Response.json({ supabaseUrl: 'https://evnjoezffghtrzqacwcj.supabase.co', supabaseAnonKey: 'fake-anon' }) }, GITHUB_BANK_WRITE_TOKEN: token }
const request = authorization => new Request('https://hyperionmaritime.org/api/question-bank/admin', {
  method: 'POST', headers: authorization ? { Authorization: 'Bearer ' + authorization, 'Content-Type': 'application/json' } : { 'Content-Type': 'application/json' },
  body: JSON.stringify(upload)
})
const previousRequests = github.requests.length
assert.equal((await handler(request(''), config)).status, 401)
assert.equal(github.requests.length, previousRequests, 'Anonymous clients must not trigger GitHub or Supabase requests')
github.setAdminAllowed(false)
assert.equal((await handler(request('not-admin'), config)).status, 403)
const beforeGitWrites = github.writes
assert.equal(github.writes, beforeGitWrites)
github.setAdminAllowed(true)
const response = await handler(request('admin'), config)
assert.equal(response.status, 200)
assert.equal((await response.json()).sha256, image.sha256)
assert.equal(github.writes, beforeGitWrites, 'Admin duplicate upload remains idempotent')
assert.equal(github.supabaseCalls, 2, 'Only existing administrator authentication uses Supabase')
console.log('PASS: Github-only encrypted image staging, immutable deduplication, publisher retrieval, upload validation, hash checks, no media Supabase calls, and unchanged admin security.')
