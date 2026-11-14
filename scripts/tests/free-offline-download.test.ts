import { beforeEach, expect, mock, test } from 'bun:test'
const revision = 'a'.repeat(40)
const question = { id: 'EW-C1-001', track: 'ENGINE_OIC_EW', functionId: 'F1', competenceId: 'C1',
  topic: 'Synthetic', questionText: 'Free question?', options: ['A', 'B'],
  correctAnswerIndex: 0, explanation: '', difficulty: 'EASY' }
let paidCalls = 0, authCalls = 0, mediaPrepared = false, written: any[] = []
let manifest: any = null, packs: any = null, mismatch = false, rawRows = false
mock.module('../../src/lib/supabase', () => ({
  supabaseAnonKey: 'fixture', supabase: {
    auth: {
      getSession: async () => { authCalls++; throw Error('Public offline packs must not ask for a session') }
    },
    functions: { invoke: async (_name: string, options: any) => {
      const body = options.body
      if (!body.freeOnly && body.action !== 'counts') paidCalls++
      if (body.action === 'counts') return { data: { bankRevision: revision, counts: [{ competenceId: 'C1', part: null, count: 1, rawCount: rawRows ? 2 : 1 }] }, error: null }
      if (body.action === 'questions') return { data: {
        bankRevision: mismatch ? 'b'.repeat(40) : revision, access: 'free-sample', questions: (rawRows ? [question, { ...question, id: 'EW-C1-002', isRetired: true }] : [question]).slice(body.offset, body.offset + body.limit)
      }, error: null }
      throw Error('Free download made a protected request: ' + body.action)
    } }
  }
}))
const actualCache = await import('../../src/lib/offlineQuestionCache')
mock.module('../../src/lib/offlineQuestionCache', () => ({ ...actualCache,
  getOfflinePackManifest: async () => manifest,
  getOfflineQuestionPacks: async () => packs,
  getOfflineQuestionsByTrack: async (_track: string, freeOnly: boolean) => freeOnly ? packs?.flatMap((group: any) => group.questions) || null : null,
  saveOfflineQuestionPackSets: async (sets: any[]) => {
    written = sets; manifest = { ...sets[0], questionCount: sets[0].groups[0].questions.length, groupCount: 1, complete: true }
    packs = sets[0].groups
  },
  recordOfflinePackVersionCheck: async () => {}
}))
mock.module('../../src/lib/questionMediaCache', () => ({
  preloadQuestionImages: async (_track: string, questions: unknown[], freeOnly: boolean) => {
    expect(freeOnly).toBe(true); expect(questions).toHaveLength(1); mediaPrepared = true
  },
  offlineQuestionImagesComplete: async () => mediaPrepared,
}))
const { downloadOfflinePack, authorizeQuestionSetAccess } = await import('../../src/lib/questionBank')
beforeEach(() => {
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: true } })
  paidCalls = 0; authCalls = 0; mediaPrepared = false; written = []; manifest = null; packs = null; mismatch = false; rawRows = false
})
test('anonymous download saves only public free pool after media verification', async () => {
  const saved = await downloadOfflinePack('ENGINE_OIC_EW', true, undefined, { background: true })
  expect(saved.questionCount).toBe(1)
  expect(mediaPrepared).toBe(true)
  expect(written[0].freeOnly).toBe(true)
  expect(written[0].publicBankRevision).toBe(revision)
  expect(written[0].groups[0].questions).toEqual([question])
  expect(authCalls).toBe(0)
  expect(paidCalls).toBe(0)
})
test('a mismatched public release fails before saving a replacement', async () => {
  mismatch = true
  await expect(downloadOfflinePack('ENGINE_OIC_EW', true, undefined, { background: true })).rejects.toThrow(/incomplete/)
  expect(written).toHaveLength(0)
  expect(authCalls).toBe(0)
})
test('offline free saved session requires exact question fingerprints from its saved pool', async () => {
  await downloadOfflinePack('ENGINE_OIC_EW', true, undefined, { background: true })
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { onLine: false } })
  expect(await authorizeQuestionSetAccess('ENGINE_OIC_EW', [{ ...question } as any])).toBe('free-sample')
  expect(await authorizeQuestionSetAccess('ENGINE_OIC_EW', [{ ...question, correctAnswerIndex: 1 } as any])).toBe(null)
  expect(authCalls).toBe(0)
})

test('free offline preparation paginates original physical rows but saves only active question IDs', async () => {
  rawRows = true
  const saved = await downloadOfflinePack('ENGINE_OIC_EW', true, undefined, { background: true })
  expect(saved.questionCount).toBe(1)
  expect(written[0].groups[0].questions.map((q: any) => q.id)).toEqual(['EW-C1-001'])
  expect(written[0].groups[0].questions.every((q: any) => q.isRetired !== true)).toBe(true)
  expect(authCalls).toBe(0)
})
