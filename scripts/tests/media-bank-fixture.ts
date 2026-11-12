export * from '../../src/lib/questionBank'
import type { Question } from '../../src/types/question'
export const mediaQuestion: Question = {
  id: 'synthetic-media-question', track: 'DECK_OIC_NW', functionId: 'F1', competenceId: 'C1', topic: 'Synthetic diagram',
  questionText: 'Synthetic vessel diagram question?', options: ['Port', 'Starboard'], correctAnswerIndex: 0,
  explanation: 'Synthetic diagram explanation.', difficulty: 'EASY', imageAttachments: [],
}
export async function authorizeQuestionSetAccess() { return 'licensed' }
export async function authorizeQuestionSet() { return true }
export async function getQuestionCountsByTrack() { return [{ competenceId: 'C1', part: 1, count: 1 }] }
export async function getQuestionsByCompetence() { return [mediaQuestion] }
export async function getFlashcardQuestions() { return [mediaQuestion] }
export async function searchQuestions() { return [mediaQuestion] }
