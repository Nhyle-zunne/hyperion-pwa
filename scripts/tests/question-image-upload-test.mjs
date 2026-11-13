import assert from 'node:assert/strict'
import { build } from 'esbuild'
import { createHash } from 'node:crypto'
const result = await build({ entryPoints: ['src/lib/questionMediaUpload.ts'], bundle: true, write: false, format: 'esm', platform: 'browser', plugins: [{ name: 'synthetic-admin-session', setup(build) { build.onResolve({ filter: /^\.\/supabase$/ }, () => ({ path: 'session', namespace: 'fixture' })); build.onLoad({ filter: /.*/, namespace: 'fixture' }, () => ({ contents: `export const supabaseUrl='https://synthetic.invalid'; export const supabaseAnonKey='synthetic-key'; export const supabase={auth:{getSession:async()=>({data:{session:{access_token:'synthetic-token',user:{id:'synthetic-owner'}}},error:null})}}` })) } }] })
const { uploadQuestionImage } = await import('data:text/javascript;base64,' + Buffer.from(result.outputFiles[0].text).toString('base64'))
const bytes = Buffer.from('RIFF00000000WEBPsynthetic-image')
globalThis.createImageBitmap = async () => ({ width: 2, height: 2, close() {} })
globalThis.document = { createElement: () => ({ getContext: () => ({ drawImage() {} }), toBlob: callback => callback(new Blob([bytes], { type: 'image/webp' })) }) }
let scenario = 'success', requests = 0, lastRequest
class FakeXHR {
  upload = {}; headers = {}; status = 200
  constructor() { requests++; lastRequest = this }
  open(method, url) { assert.equal(method, 'POST'); assert.equal(url, 'https://synthetic.invalid/functions/v1/question-media') }
  setRequestHeader(key, value) { this.headers[key] = value }
  send(body) {
    assert.equal(this.headers.Authorization, 'Bearer synthetic-token')
    assert.equal(this.headers.apikey, 'synthetic-key')
    const data = JSON.parse(body), decoded = Buffer.from(data.base64, 'base64')
    queueMicrotask(() => {
      if (scenario === 'network') { this.onerror(); return }
      if (scenario === 'timeout') { this.ontimeout(); return }
      if (scenario === 'held') return
      this.upload.onprogress({ loaded: 25, total: 100, lengthComputable: true })
      this.upload.onload()
      this.status = scenario === 'forbidden' ? 403 : 200
      this.responseText = scenario === 'invalid-json' ? 'bad' : JSON.stringify({ track: data.track, mime: 'image/webp', bytes: decoded.length, sha256: scenario === 'forged' ? 'b'.repeat(64) : createHash('sha256').update(decoded).digest('hex') })
      this.onload()
    })
  }
  abort() { this.onabort?.() }
}
globalThis.XMLHttpRequest = FakeXHR
const file = new File([bytes], 'synthetic.png', { type: 'image/png' })
const progress = []
const ref = await uploadQuestionImage('ENGINE_OIC_EW', file, 'question', 'Diagram', { onProgress: event => progress.push(event) })
assert.equal(ref.sha256, createHash('sha256').update(bytes).digest('hex'))
assert(progress.some(event => event.stage === 'uploading' && event.loaded === 25 && event.total === 100), 'Progress uses actual transfer byte events')
assert.deepEqual(progress.map(event => event.stage), ['preparing', 'uploading', 'uploading', 'verifying', 'complete'])
assert.equal(lastRequest.timeout, 60000)
for (scenario of ['forged', 'forbidden', 'invalid-json', 'network', 'timeout']) {
  const events = []
  await assert.rejects(uploadQuestionImage('ENGINE_OIC_EW', file, 'question', 'Diagram', { onProgress: event => events.push(event.stage) }))
  assert(!events.includes('complete'), `${scenario} cannot report verified completion`)
}
scenario = 'held'
const controller = new AbortController()
const pending = uploadQuestionImage('ENGINE_OIC_EW', file, 'question', 'Diagram', { signal: controller.signal })
await new Promise(resolve => setTimeout(resolve, 0))
controller.abort()
await assert.rejects(pending, { name: 'AbortError' })
const priorRequests = requests
await assert.rejects(uploadQuestionImage('ENGINE_OIC_EW', file, 'question', 'Diagram', { signal: controller.signal }), { name: 'AbortError' })
assert.equal(requests, priorRequests, 'A superseded editor cannot send another request')
console.log('PASS: authenticated upload byte progress, verified completion, integrity/errors, timeout and abort')
