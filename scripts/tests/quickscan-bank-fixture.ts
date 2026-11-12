// Synthetic bank used only by the isolated browser build; no application access checks are changed.
export * from '../../src/lib/questionBank'
import type { Question, TrackId } from '../../src/types/question'
export const fixtureQuestions: Question[] = Array.from({ length: 120 }, (_, index) => ({
  id: `quickscan-fixture-${index + 1}`, track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1',
  topic: 'Synthetic fixture', questionText: `Vessel fixture ${index + 1} gives way.`, options: ['Port', 'Starboard'],
  correctAnswerIndex: 1, explanation: 'Synthetic fixture only', difficulty: 'EASY'
}))
// Browser tests can simulate administrator bank revisions without contacting
// the real question-bank service or changing any production code.
function currentFixtureBank(): Question[] {
  const mode = localStorage.getItem('hyperion-quickscan-fixture-bank-mode')
  if (mode === 'insert-before-20') {
    const inserted: Question = {
      ...fixtureQuestions[0],
      id: 'quickscan-inserted-question',
      questionText: 'Inserted synthetic bank revision question.'
    }
    return [...fixtureQuestions.slice(0, 10), inserted, ...fixtureQuestions.slice(10)]
  }
  if (mode === 'remove-51') return fixtureQuestions.filter(item => item.id !== 'quickscan-fixture-51')
  return fixtureQuestions
}
export async function getQuestionCountsByTrack() {
  return [{ competenceId: 'C1', part: null, count: currentFixtureBank().length }]
}
export async function getQuestionsByCompetence(_track: TrackId, _competence: string, _part?: number, _free?: boolean, start = 1, limit = 50) {
  if (localStorage.getItem('hyperion-quickscan-fixture-bank-mode') === 'fail-load') {
    throw new Error('Synthetic network failure, no Supabase request')
  }
  return currentFixtureBank().slice(start - 1, start - 1 + limit)
}
