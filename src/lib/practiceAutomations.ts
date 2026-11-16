// Persist practice automations on-device, following the existing Text Size setting.
export const PRACTICE_AUTOMATIONS_STORAGE_KEY = 'hyperion-practice-automations'
export const AUTO_NEXT_MIN_DELAY_MS = 100
export const AUTO_NEXT_MAX_DELAY_MS = 5000
export const AUTO_NEXT_STEP_MS = 100

export type PracticeAutomations = {
  directAnswer: boolean
  autoNextCorrect: boolean
  autoNextWrong: boolean
  delayCorrectMs: number
  delayWrongMs: number
}

export const DEFAULT_PRACTICE_AUTOMATIONS: PracticeAutomations = {
  directAnswer: false,
  autoNextCorrect: false,
  autoNextWrong: false,
  delayCorrectMs: 300,
  delayWrongMs: 500
}

export function normalizeAutoNextDelayMs(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback
  const clamped = Math.max(AUTO_NEXT_MIN_DELAY_MS, Math.min(AUTO_NEXT_MAX_DELAY_MS, value))
  return Math.round(clamped / AUTO_NEXT_STEP_MS) * AUTO_NEXT_STEP_MS
}

export function stepAutoNextDelayMs(current: number, steps: number): number {
  return normalizeAutoNextDelayMs(current + steps * AUTO_NEXT_STEP_MS, current)
}

export function normalizePracticeAutomations(input: unknown): PracticeAutomations {
  const source = input && typeof input === 'object' ? input as Partial<PracticeAutomations> : {}
  return {
    directAnswer: source.directAnswer === true,
    autoNextCorrect: source.autoNextCorrect === true,
    autoNextWrong: source.autoNextWrong === true,
    delayCorrectMs: normalizeAutoNextDelayMs(source.delayCorrectMs, DEFAULT_PRACTICE_AUTOMATIONS.delayCorrectMs),
    delayWrongMs: normalizeAutoNextDelayMs(source.delayWrongMs, DEFAULT_PRACTICE_AUTOMATIONS.delayWrongMs)
  }
}

export function loadPracticeAutomations(storage: Pick<Storage, 'getItem'> = localStorage): PracticeAutomations {
  try {
    return normalizePracticeAutomations(JSON.parse(storage.getItem(PRACTICE_AUTOMATIONS_STORAGE_KEY) || 'null'))
  } catch {
    return { ...DEFAULT_PRACTICE_AUTOMATIONS }
  }
}

export function formatAutoNextDelayMs(delayMs: number): string {
  return (delayMs / 1000).toFixed(1) + 's'
}
