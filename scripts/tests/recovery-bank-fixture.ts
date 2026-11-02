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

export async function getFlashcardQuestions(track: TrackId, competenceId?: string, limit = 20) {
  return recoveryQuestions.filter(question => question.track === track && (!competenceId || question.competenceId === competenceId)).slice(0, limit)
}

const fullFlashcards = Array.from({ length: 65 }, (_, index) => ({
  ...recoveryQuestions[0], id: `recovery-fixture-full-${index + 1}`,
  questionText: `Full bank card ${index + 1}`, competenceId: index < 35 ? 'C1' : 'C2'
}))
export async function getQuestionCountsByTrack() {
  if (!localStorage.getItem('fixture-full-flashcards')) return [{ competenceId: 'C1', count: 4 }]
  return [{ competenceId: 'C1', part: 1, count: 32 }, { competenceId: 'C1', part: 2, count: 3 }, { competenceId: 'C2', part: 1, count: 30 }]
}
export async function getQuestionsByCompetence(track: TrackId, competenceId: string, part?: number, _freeOnly = false, startItem = 1, limit?: number) {
  if (localStorage.getItem('fixture-flashcard-page-failure')) throw new Error('Synthetic next-page failure')
  const bank = localStorage.getItem('fixture-full-flashcards') ? fullFlashcards : recoveryQuestions
  const pool = bank.filter((q, index) => q.track === track && q.competenceId === competenceId && (part == null || (index < 32 || index >= 35 ? 1 : 2) === part))
  return pool.slice(startItem - 1, limit == null ? undefined : startItem - 1 + limit)
}
