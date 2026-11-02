import { beforeEach, expect, mock, test } from 'bun:test'
const path = 'deck/oic_nw_c1.csv.enc'
const question = { id: 'D-F1-C1-001', track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1', topic: 'Synthetic', questionText: 'Original question', options: ['A', 'B'], correctAnswerIndex: 0, explanation: '', difficulty: 'EASY' }
const semanticHash = [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify([question]))))].map(value => value.toString(16).padStart(2, '0')).join('')
let manifest: any, packs: any[], currentHash: string, persisted: any[], calls: string[]
mock.module('../../src/lib/supabase', () => ({ supabaseAnonKey: 'synthetic', supabase: { functions: { invoke: async (_name: string, options: any) => {
  calls.push(options.body.action)
  const legacy = options.body.action === 'content-versions-legacy'
  return { error: null, data: { track: 'DECK_OIC_NW', versions: [{ path, competenceId: 'C1', part: null, freeHash: legacy ? semanticHash : currentHash, fullHash: legacy ? semanticHash : currentHash }], versionFormat: legacy ? 'content-sha256-v1' : 'github-content-sha256-v1' } }
} } } }))
const actualCache = await import('../../src/lib/offlineQuestionCache')
mock.module('../../src/lib/offlineQuestionCache', () => ({ ...actualCache,
  getOfflinePackManifest: async () => manifest,
  getOfflineQuestionPacks: async () => packs,
  recordOfflinePackVersionCheck: async (_track: string, _free: boolean, value: any) => { persisted.push(value) }
}))
const { checkOfflineQuestionPackUpdates } = await import('../../src/lib/questionBank')
beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  manifest = { complete: true, savedAt: 100, sourceVersionFormat: 'storage-metadata-v1', sourceVersions: { [path]: 'a'.repeat(64) } }
  packs = [{ competenceId: 'C1', part: null, questions: [{ ...question }] }]
  currentHash = 'b'.repeat(64); persisted = []; calls = []
})
test('unchanged existing Storage pack rebases to GitHub metadata without replacing its questions', async () => {
  const original = JSON.stringify(packs)
  const result = await checkOfflineQuestionPackUpdates('DECK_OIC_NW', false, true)
  expect(result.status).toBe('current')
  expect(persisted[0].sourceVersionFormat).toBe('github-content-sha256-v1')
  expect(persisted[0].sourceVersions[path]).toBe(currentHash)
  expect(JSON.stringify(packs)).toBe(original)
})
test('different existing content is offered an update even if old Storage versions match', async () => {
  packs[0].questions[0].questionText = 'Different historical content'
  const original = JSON.stringify(packs)
  const result = await checkOfflineQuestionPackUpdates('DECK_OIC_NW', false, true)
  expect(result.status).toBe('available')
  expect(persisted[0].sourceVersionFormat).toBe('storage-metadata-v1')
  expect(JSON.stringify(packs)).toBe(original)
})
test('a new GitHub file hash marks its existing GitHub pack outdated', async () => {
  manifest.sourceVersionFormat = 'github-content-sha256-v1'
  const result = await checkOfflineQuestionPackUpdates('DECK_OIC_NW', false, true)
  expect(result.status).toBe('available')
  expect(calls).not.toContain('content-versions-legacy')
})
test('old packs stay available offline without contacting or changing either source', async () => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
  const original = JSON.stringify(packs)
  const result = await checkOfflineQuestionPackUpdates('DECK_OIC_NW', false, true)
  expect(result.status).toBe('offline')
  expect(calls.length).toBe(0)
  expect(persisted.length).toBe(0)
  expect(JSON.stringify(packs)).toBe(original)
})
test('legacy semantic hashes migrate to GitHub metadata when their content is unchanged', async () => {
  manifest.sourceVersionFormat = 'content-sha256-v1'
  manifest.sourceVersions[path] = semanticHash
  expect((await checkOfflineQuestionPackUpdates('DECK_OIC_NW', false, true)).status).toBe('current')
  expect(persisted[0].sourceVersionFormat).toBe('github-content-sha256-v1')
})
