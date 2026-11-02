export * from '../../src/lib/questionBank'
import type { Question, TrackId } from '../../src/types/question'
export const recoveryQuestions: Question[] = Array.from({ length: 4 }, (_, index) => ({
  id: `recovery-fixture-${index + 1}`, track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1', topic: 'Recovery fixture',
  questionText: `Recovery vessel ${index + 1} question.`, options: ['Port', 'Starboard'], correctAnswerIndex: 1,
  explanation: 'Synthetic recovery fixture explanation.', difficulty: 'EASY'
}))
export async function authorizeQuestionSetAccess(track: TrackId, questions: Question[]) {
  return questions.length > 0 && questions.every(q => q.track === track && q.id.startsWith('recovery-fixture-')) ? 'licensed' : null
}
export async function authorizeQuestionSet(track: TrackId, questions: Question[]) { return (await authorizeQuestionSetAccess(track, questions)) !== null }
