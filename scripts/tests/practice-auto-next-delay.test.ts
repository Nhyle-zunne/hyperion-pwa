import { expect, test } from 'bun:test'
import {
  AUTO_NEXT_MAX_DELAY_MS, AUTO_NEXT_MIN_DELAY_MS, DEFAULT_PRACTICE_AUTOMATIONS,
  PRACTICE_AUTOMATIONS_STORAGE_KEY, formatAutoNextDelayMs, loadPracticeAutomations,
  normalizeAutoNextDelayMs, normalizePracticeAutomations, stepAutoNextDelayMs
} from '../../src/lib/practiceAutomations'

test('new and existing practice users keep their answer toggles and prior timing defaults', () => {
  const empty = loadPracticeAutomations({ getItem: () => null })
  expect(empty).toEqual(DEFAULT_PRACTICE_AUTOMATIONS)
  const legacy = loadPracticeAutomations({
    getItem: key => key === PRACTICE_AUTOMATIONS_STORAGE_KEY
      ? JSON.stringify({ directAnswer: true, autoNextCorrect: true, autoNextWrong: false })
      : null
  })
  expect(legacy).toEqual({
    directAnswer: true, autoNextCorrect: true, autoNextWrong: false,
    delayCorrectMs: 300, delayWrongMs: 500
  })
})

test('delays step like text size in 0.1s increments, clamp at 0.1–5.0s and reset', () => {
  expect(stepAutoNextDelayMs(300, 1)).toBe(400)
  expect(stepAutoNextDelayMs(500, -1)).toBe(400)
  expect(stepAutoNextDelayMs(AUTO_NEXT_MIN_DELAY_MS, -1)).toBe(100)
  expect(stepAutoNextDelayMs(AUTO_NEXT_MAX_DELAY_MS, 1)).toBe(5000)
  expect(normalizeAutoNextDelayMs(10, 300)).toBe(100)
  expect(normalizeAutoNextDelayMs(9999, 500)).toBe(5000)
  expect(formatAutoNextDelayMs(300)).toBe('0.3s')
  expect(formatAutoNextDelayMs(1500)).toBe('1.5s')
  expect(normalizePracticeAutomations({ delayCorrectMs: 1500, delayWrongMs: 100 }).delayCorrectMs).toBe(1500)
  expect(DEFAULT_PRACTICE_AUTOMATIONS.delayCorrectMs).toBe(300)
  expect(DEFAULT_PRACTICE_AUTOMATIONS.delayWrongMs).toBe(500)
})

test('malformed saved settings fail closed to safe defaults without corrupting other toggles', () => {
  expect(loadPracticeAutomations({ getItem: () => '{bad' })).toEqual(DEFAULT_PRACTICE_AUTOMATIONS)
  expect(normalizePracticeAutomations({ directAnswer: true, autoNextCorrect: 'true',
    autoNextWrong: true, delayCorrectMs: Infinity, delayWrongMs: -12 })).toEqual({
    directAnswer: true, autoNextCorrect: false, autoNextWrong: true,
    delayCorrectMs: 300, delayWrongMs: 100
  })
})

test('local storage round-trip restores each delay independently without any backend call', () => {
  const settings = { ...DEFAULT_PRACTICE_AUTOMATIONS, directAnswer: true,
    autoNextCorrect: true, autoNextWrong: true, delayCorrectMs: 1700, delayWrongMs: 2300 }
  const stored = JSON.stringify(settings)
  const restored = loadPracticeAutomations({ getItem: key => key === PRACTICE_AUTOMATIONS_STORAGE_KEY ? stored : null })
  expect(restored).toEqual(settings)
})
