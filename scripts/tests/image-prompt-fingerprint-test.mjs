import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { transform } from 'esbuild'
import { fingerprintQuestion, questionFingerprintPayload } from '../../src/lib/questionFingerprint.mjs'

async function serverFingerprint(path, name, end, helpers = '') {
  const source = await readFile(new URL(path, import.meta.url), 'utf8')
  const start = source.indexOf(`async function ${name}(`)
  const body = source.slice(start, source.indexOf(end, start))
  const { code } = await transform(`${helpers}\n${body}\nexport { ${name} as fingerprint };`, { loader: 'ts', format: 'esm' })
  return (await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64'))).fingerprint
}
const bankSource = await readFile(new URL('../../supabase/functions/question-bank/index.ts', import.meta.url), 'utf8')
const cacheStart = bankSource.indexOf('const QUESTION_FINGERPRINT_ALGORITHM_VERSION') >= 0
  ? bankSource.indexOf('const QUESTION_FINGERPRINT_ALGORITHM_VERSION') : bankSource.indexOf('function assetVersionPayload(')
const { code: cacheCode } = await transform(bankSource.slice(cacheStart, bankSource.indexOf('async function cachedQuestionCounts(', cacheStart)) + '\nexport { assetVersionPayload, sameAssetVersions };', { loader: 'ts', format: 'esm' })
const cache = await import('data:text/javascript;base64,' + Buffer.from(cacheCode).toString('base64'))
const versions = [{ path: 'engine_ew/ew_c1.csv.enc', etag: 'same-etag', size: 100 }]
assert.equal(cache.sameAssetVersions(versions, versions), false, 'Historical fingerprint cache must be invalidated when parser accepts new image prompts')
assert.equal(cache.sameAssetVersions(cache.assetVersionPayload(versions), versions), true)
assert.equal(cache.sameAssetVersions(cache.assetVersionPayload(versions), [{ ...versions[0], etag: 'new-etag' }]), false)
const mediaParser = bankSource.slice(bankSource.indexOf('function parseProtectedImageRefs('), bankSource.indexOf('function toSearchQuestions('))
const bankFingerprint = await serverFingerprint('../../supabase/functions/question-bank/index.ts', 'questionFingerprint', 'async function freeQuestionFingerprints(', mediaParser)
const progressFingerprint = await serverFingerprint('../../supabase/functions/learning-progress/index.ts', 'fingerprintQuestion', 'type ProgressQuestionCandidate')
const image = { sha256: 'a'.repeat(64), mime: 'image/png', placement: 'question', alt: 'Scan' }
const question = { questionText: '', options: ['A', 'B', 'C', 'D'], correctAnswerIndex: 0, imageAttachments: [image] }
const changed = { ...question, imageAttachments: [{ ...image, sha256: 'b'.repeat(64) }] }
assert.notEqual(await fingerprintQuestion(question), await fingerprintQuestion(changed), 'Different image prompts must have different identities')
const text = { ...question, questionText: 'Original prompt' }
const oldPayload = JSON.stringify([text.questionText, text.options.map((value, index) => ({ text: value, correct: index === text.correctAnswerIndex }))])
assert.equal(questionFingerprintPayload(text), oldPayload, 'Text questions retain exact historical payload bytes')
assert.equal(questionFingerprintPayload({ ...text, imageAttachments: [{ invalid: true }] }), oldPayload)
const variants = [question, changed,
  { ...question, options: ['D', 'C', 'B', 'A'], correctAnswerIndex: 3 },
  { ...question, imageAttachments: [{ ...image, alt: 'Renamed' }, { ...image, placement: 'explanation' }] },
  { ...question, imageAttachments: [image, { ...image, sha256: 'b'.repeat(64) }] },
  { ...question, imageAttachments: [{ ...image, sha256: 'b'.repeat(64) }, image] }, text]
const hashes = []
for (const variant of variants) {
  const expected = await fingerprintQuestion(variant)
  assert.equal(await bankFingerprint(variant), expected, 'Delivery authorization matches client bytes')
  assert.equal(await progressFingerprint(variant), expected, 'Saved progress authorization matches client bytes')
  hashes.push(expected)
}
assert.equal(hashes[0], hashes[2], 'Shuffling options preserves identity')
assert.equal(hashes[0], hashes[3], 'Alt and explanation images do not change prompt identity')
assert.equal(hashes[4], hashes[5], 'Prompt image order does not change identity')
for (const refs of [undefined, [], [{ ...image, placement: 'explanation' }], [{ ...image, sha256: 'bad' }], [image, image], Array(5).fill(image), [{ ...image, alt: '' }], [{ ...image, unexpected: true }]]) {
  const invalid = { ...question, imageAttachments: refs }
  assert.equal(await fingerprintQuestion(invalid), null)
  assert.equal(await progressFingerprint(invalid), null)
  await assert.rejects(bankFingerprint(invalid), /image|prompt/i)
}
console.log('Image prompt fingerprints preserve historical text hashes, strict metadata, and client/server parity')
