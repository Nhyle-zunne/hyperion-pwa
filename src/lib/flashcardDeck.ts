import { getQuestionsByCompetence, type QuestionBankCount } from './questionBank'
import type { Question, TrackId } from '../types/question'

export const FLASHCARD_PAGE_SIZE = 50
export interface FlashcardDeck {
  track: TrackId
  groups: QuestionBankCount[]
  total: number
}

/** A count manifest covers the entire selected pool; question text stays paginated. */
export function createFlashcardDeck(track: TrackId, counts: QuestionBankCount[], competenceId?: string): FlashcardDeck {
  const groups = counts.filter(group => !competenceId || group.competenceId === competenceId)
    .map(group => ({ ...group }))
    .sort((a, b) => a.competenceId.localeCompare(b.competenceId, undefined, { numeric: true }) || (a.part ?? 0) - (b.part ?? 0))
  if (groups.some(group => !Number.isSafeInteger(group.count) || group.count < 0)) throw new Error('Could not verify the flashcard question counts. Refresh this track and try again.')
  return { track, groups: groups.filter(group => group.count > 0), total: groups.reduce((sum, group) => sum + group.count, 0) }
}

export async function loadFlashcardPage(deck: FlashcardDeck, index: number): Promise<{ questions: Question[]; pageStart: number }> {
  if (!Number.isInteger(index) || index < 0 || index >= deck.total) throw new Error('This flashcard is outside the selected deck.')
  const pageStart = index
  const pageEnd = Math.min(deck.total, pageStart + FLASHCARD_PAGE_SIZE)
  const questions: Question[] = []
  let groupStart = 0
  for (const group of deck.groups) {
    const groupEnd = groupStart + group.count
    const from = Math.max(pageStart, groupStart)
    const to = Math.min(pageEnd, groupEnd)
    if (from < to) {
      const page = await getQuestionsByCompetence(deck.track, group.competenceId, group.part ?? undefined, false, from - groupStart + 1, to - from)
      if (!page.length || page.length > to - from) {
        throw new Error('Could not load the requested cards. Retry or reopen the deck to refresh it.')
      }
      questions.push(...page)
      // A short response is still a usable prefix. Resume at its next offset
      // on advance before moving into a later competence or part.
      if (page.length < to - from) break
    }
    groupStart = groupEnd
    if (groupStart >= pageEnd) break
  }
  return { questions, pageStart }
}
