import { expect, test } from 'bun:test'
import {
  activeToPublishedC10Position,
  ENGINE_MGT_C10_RETIRED_IDS,
  isRetiredQuestion,
  requiresC10ActivePositionMapping,
  selectActiveQuestions,
  visibleCompetenceCount
} from '../../src/lib/retiredQuestions'
import type { Question } from '../../src/types/question'

const sample = (id: string, track: Question['track'] = 'ENGINE_MGT', competenceId = 'C10') =>
  ({ id, track, competenceId })

test('published 416 original positions map losslessly into 413 active positions', () => {
  const old = Array.from({ length: 416 }, (_, i) => i + 1)
  const active = old.filter(number => ![182, 373, 406].includes(number))
  expect(active).toHaveLength(413)
  for (let index = 1; index <= active.length; index++) {
    expect(activeToPublishedC10Position(index)).toBe(active[index - 1])
  }
  expect([active[180], active[181], active[371], active[372], active[402], active[403]])
    .toEqual([181, 183, 374, 375, 405, 407])
})

test('only C10 Engine Management IDs retire, including Android four-digit alias', () => {
  expect(ENGINE_MGT_C10_RETIRED_IDS).toEqual(['EM-C10-182', 'EM-C10-373', 'EM-C10-406'])
  for (const number of [182, 373, 406]) {
    expect(isRetiredQuestion(sample(`EM-C10-${number}`))).toBe(true)
    expect(isRetiredQuestion(sample(`EM-C10-${String(number).padStart(4, '0')}`))).toBe(true)
    expect(isRetiredQuestion(sample(`EM-C10-${number}`, 'DECK_MGT'))).toBe(false)
    expect(isRetiredQuestion(sample(`EM-C10-${number}`, 'ENGINE_MGT', 'C9'))).toBe(false)
  }
  expect(isRetiredQuestion(sample('EM-C10-183'))).toBe(false)
})

test('filter changes only new active lists and leaves bookmarked historical records intact', () => {
  const previous = [sample('EM-C10-181'), sample('EM-C10-182'),
    sample('EM-C10-183'), sample('DM-C10-182', 'DECK_MGT')]
  const active = selectActiveQuestions(previous)
  expect(active).toHaveLength(3)
  expect(previous).toHaveLength(4)
  expect(active.map(item => item.id)).toEqual(['EM-C10-181', 'EM-C10-183', 'DM-C10-182'])
  expect(visibleCompetenceCount('ENGINE_MGT', 'C10', 416, false)).toBe(413)
  expect(visibleCompetenceCount('ENGINE_MGT', 'C10', 166, true)).toBe(166)
  expect(visibleCompetenceCount('DECK_MGT', 'C10', 416, false)).toBe(416)
  expect(requiresC10ActivePositionMapping('ENGINE_MGT', 'C10', false)).toBe(true)
  expect(requiresC10ActivePositionMapping('ENGINE_MGT', 'C10', true)).toBe(false)
})
