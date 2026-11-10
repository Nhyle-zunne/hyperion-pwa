import type { Question, TrackId } from '../types/question'

/**
 * Permanent retirement policy for existing published questions.
 *
 * Never remove these records from the published/encrypted CSV, reassign their
 * Question.id, or delete users' bookmark/mistake/history/saved-session data.
 * Only exclude the IDs from NEW practice sessions and question discovery.
 *
 * Android uses EM-C10-0182 etc.; the PWA has used EM-C10-182 etc.
 * Both are equivalent original CSV question numbers because C10 has retained
 * its complete 1–416 historical record list.
 */
const ENGINE_MGT_C10_RETIRED_NUMBERS = [182, 373, 406] as const

const retiredNumbers = new Set<number>(ENGINE_MGT_C10_RETIRED_NUMBERS)

export const ENGINE_MGT_C10_RETIRED_IDS =
  ENGINE_MGT_C10_RETIRED_NUMBERS.map(number => `EM-C10-${String(number).padStart(3, '0')}`)

export function isRetiredQuestion(question: Pick<Question, 'id' | 'track' | 'competenceId'>): boolean {
  if (question.track !== 'ENGINE_MGT' || question.competenceId !== 'C10') return false
  const match = /^EM-C10-(\d+)$/.exec(question.id)
  return match !== null && retiredNumbers.has(Number(match[1]))
}

export function selectActiveQuestions<T extends Pick<Question, 'id' | 'track' | 'competenceId'>>(
  questions: T[]
): T[] {
  return questions.filter(question => !isRetiredQuestion(question))
}

/** Keep the published array intact; the active position is a view of it. */
export function activeToPublishedC10Position(activePosition: number): number {
  let published = activePosition
  for (const retired of ENGINE_MGT_C10_RETIRED_NUMBERS) {
    if (retired <= published) published += 1
  }
  return published
}

/**
 * Published metadata still counts retired historical records. Only the *full*
 * Engine Management C10 active pool is reduced. The existing free C10 sample
 * ends before item 182 and has no retired questions; preserve that quota.
 */
export function visibleCompetenceCount(
  track: TrackId,
  competenceId: string,
  publishedCount: number,
  freeOnly: boolean
): number {
  if (track !== 'ENGINE_MGT' || competenceId !== 'C10' || freeOnly) return publishedCount
  return Math.max(0, publishedCount - ENGINE_MGT_C10_RETIRED_NUMBERS.filter(n => n <= publishedCount).length)
}

export function requiresC10ActivePositionMapping(
  track: TrackId, competenceId: string, freeOnly: boolean
): boolean {
  return track === 'ENGINE_MGT' && competenceId === 'C10' && !freeOnly
}
