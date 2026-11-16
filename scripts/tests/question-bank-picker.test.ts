import { expect, test } from 'bun:test'
import { filterQuestionBankAssets, questionBankPickerLabel, searchQuestionBankAssets, sortQuestionBankAssets, type QuestionBankPickerAsset } from '../../src/lib/questionBankPicker'

const assets: QuestionBankPickerAsset[] = [
  { path: 'engine_mgt/em_c10.csv.enc', track: 'ENGINE_MGT', competenceId: 'C10', part: null, label: 'Engine Management · C10' },
  { path: 'deck/oic_nw_c10.csv.enc', track: 'DECK_OIC_NW', competenceId: 'C10', part: null, label: 'Deck OIC-NW · C10' },
  { path: 'deck_mgt/dm_c10.csv.enc', track: 'DECK_MGT', competenceId: 'C10', part: null, label: 'Deck Management · C10' },
  { path: 'gmdss/c1_part2.csv.enc', track: 'GMDSS_GOC', competenceId: 'C1', part: 2, label: 'GMDSS GOC · C1 · Part 2' }
]

test('searches across track, competence, aliases and part with words in any order', () => {
  expect(searchQuestionBankAssets(assets, 'engine c10').map(a => a.path)).toEqual(['engine_mgt/em_c10.csv.enc'])
  expect(searchQuestionBankAssets(assets, 'C10 DECK').map(a => a.path)).toEqual(['deck/oic_nw_c10.csv.enc', 'deck_mgt/dm_c10.csv.enc'])
  expect(searchQuestionBankAssets(assets, 'oic-nw c10').map(a => a.path)).toEqual(['deck/oic_nw_c10.csv.enc'])
  expect(searchQuestionBankAssets(assets, 'gmdss part 2')).toEqual([assets[3]])
  expect(searchQuestionBankAssets(assets, 'UNKNOWN')).toEqual([])
})

test('labels are human readable while selected value remains the original bank path', () => {
  expect(questionBankPickerLabel(assets[0])).toBe('Engine Management · C10')
  expect(questionBankPickerLabel(assets[3])).toBe('GMDSS GOC · C1 · Part 2')
  expect(assets[0].path).toBe('engine_mgt/em_c10.csv.enc')
  expect(searchQuestionBankAssets(assets, '')).toEqual(assets)
  expect(searchQuestionBankAssets(assets, '   ')).toEqual(assets)
})

test('track preset restricts competence and part results without losing global search', () => {
  expect(filterQuestionBankAssets(assets, 'ENGINE_MGT', '').map(asset => asset.path)).toEqual(['engine_mgt/em_c10.csv.enc'])
  expect(filterQuestionBankAssets(assets, 'GMDSS_GOC', 'part 2').map(asset => asset.path)).toEqual(['gmdss/c1_part2.csv.enc'])
  expect(filterQuestionBankAssets(assets, 'GMDSS_GOC', 'C10')).toEqual([])
  expect(filterQuestionBankAssets(assets, 'DECK_OIC_NW', 'C10').map(asset => asset.path)).toEqual(['deck/oic_nw_c10.csv.enc'])
  expect(filterQuestionBankAssets(assets, null, 'C10').map(asset => asset.path)).toEqual([
    'engine_mgt/em_c10.csv.enc', 'deck/oic_nw_c10.csv.enc', 'deck_mgt/dm_c10.csv.enc'
  ])
  expect(filterQuestionBankAssets(assets, null, '')).toEqual(assets)
})

test('sorts competence numbers and parts naturally within configured track groups', async () => {
  const picker = await import('../../src/lib/questionBankPicker')
  expect(typeof picker.sortQuestionBankAssets).toBe('function')
  const bank = (track: string, competenceId: string, part: number | null = null): QuestionBankPickerAsset => ({
    track, competenceId, part, path: `${track}/${competenceId}/${part ?? 'main'}`, label: competenceId
  })
  const unsorted = [
    bank('ENGINE_MGT', 'C10'), bank('GMDSS_GOC', 'C1', 10), bank('DECK_MGT', 'C2'),
    bank('ENGINE_MGT', 'C2'), bank('GMDSS_GOC', 'C1', 2), bank('DECK_MGT', 'C10'),
    bank('UNKNOWN_Z', 'C10'), bank('ENGINE_MGT', 'C1'), bank('GMDSS_GOC', 'C1', 1),
    bank('DECK_MGT', 'C1'), bank('UNKNOWN_A', 'C1'), bank('UNKNOWN_Z', 'C2')
  ]
  expect(picker.sortQuestionBankAssets(unsorted, [['DECK_MGT', 'Deck'], ['ENGINE_MGT', 'Engine'], ['GMDSS_GOC', 'GMDSS']]).map(asset => asset.path)).toEqual([
    'DECK_MGT/C1/main', 'DECK_MGT/C2/main', 'DECK_MGT/C10/main',
    'ENGINE_MGT/C1/main', 'ENGINE_MGT/C2/main', 'ENGINE_MGT/C10/main',
    'GMDSS_GOC/C1/1', 'GMDSS_GOC/C1/2', 'GMDSS_GOC/C1/10',
    'UNKNOWN_Z/C2/main', 'UNKNOWN_Z/C10/main', 'UNKNOWN_A/C1/main'
  ])
  expect(unsorted[0].path).toBe('ENGINE_MGT/C10/main')
})

test('recognizes aggregate scopes without treating publisher paths as scopes', async () => {
  const picker = await import('../../src/lib/questionBankPicker')
  expect(typeof picker.isAllQuestionBankScope).toBe('function')
  expect(picker.isAllQuestionBankScope('@all')).toBe(true)
  expect(picker.isAllQuestionBankScope('@all:ENGINE_MGT')).toBe(true)
  expect(picker.questionBankScopeTrack('@all')).toBeNull()
  expect(picker.questionBankScopeTrack('@all:GMDSS_GOC')).toBe('GMDSS_GOC')
  for (const path of ['', '@all:', '@allied', assets[0].path]) {
    expect(picker.isAllQuestionBankScope(path)).toBe(false)
    expect(picker.questionBankScopeTrack(path)).toBeNull()
  }
  expect(filterQuestionBankAssets(assets, picker.questionBankScopeTrack('@all'), 'C10')).toHaveLength(3)
  expect(filterQuestionBankAssets(assets, picker.questionBankScopeTrack('@all:ENGINE_MGT'), 'C10')).toEqual([assets[0]])
})

test('uses numeric competence order in every examination track', () => {
  const tracks = ['DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'].map(track => [track, track] as const)
  const unsorted = tracks.flatMap(([track]) => ['C10', 'C2', 'C1'].map(competenceId => ({
    track, competenceId, path: `${track}/${competenceId}`, part: null, label: competenceId
  })))
  const sorted = sortQuestionBankAssets(unsorted, tracks)
  for (const [track] of tracks) {
    expect(sorted.filter(asset => asset.track === track).map(asset => asset.competenceId)).toEqual(['C1', 'C2', 'C10'])
  }
})

test('offers aggregate selection only for blank or explicit all searches', async () => {
  const picker = await import('../../src/lib/questionBankPicker')
  expect(typeof picker.showAllQuestionBankOption).toBe('function')
  for (const query of ['', '   ', 'all', 'All competences', 'all tracks']) {
    expect(picker.showAllQuestionBankOption(query)).toBe(true)
  }
  for (const query of ['Engine C10', 'C1', 'Part 2', 'alligator']) {
    expect(picker.showAllQuestionBankOption(query)).toBe(false)
  }
})
