// Synthetic bank used only by the isolated browser build; no application access checks are changed.
export * from '../../src/lib/questionBank'
import type { Question, TrackId } from '../../src/types/question'
export const fixtureQuestions: Question[] = Array.from({ length: 120 }, (_, index) => ({
  id: `quickscan-fixture-${index + 1}`, track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1',
  topic: 'Synthetic fixture', questionText: `Vessel fixture ${index + 1} gives way.`, options: ['Port', 'Starboard'],
  correctAnswerIndex: 1, explanation: 'Synthetic fixture only', difficulty: 'EASY'
}))
export async function getQuestionCountsByTrack() { return [{ competenceId: 'C1', part: null, count: 120 }] }
export async function getQuestionsByCompetence(_track: TrackId, _competence: string, _part?: number, _free?: boolean, start = 1, limit = 50) {
  return fixtureQuestions.slice(start - 1, start - 1 + limit)
}
