import { expect, test } from 'bun:test'
import { questionBankPickerLabel, searchQuestionBankAssets, type QuestionBankPickerAsset } from '../../src/lib/questionBankPicker'

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
