import type { TrackId } from '../types/question'

// Shared by the mock-exam runner and the track-page question count.
const MOCK_EXAM_ITEMS: Record<TrackId, Record<string, number>> = {
  DECK_OIC_NW: { C1: 35, C2: 20, C3: 15, C4: 10, C5: 10, C7: 20, C9: 15, C10: 15, C11: 15, C12: 15, C13: 15, C17: 15 },
  GMDSS_GOC: { C1: 85, C2: 15 },
  ENGINE_OIC_EW: { C1: 14, C2: 10, C3: 10, C4: 30, C5: 10, C6: 20, C7: 15, C8: 24, C9: 15, C10: 10, C11: 10, C15: 10, C16: 22 },
  DECK_MGT: { C1: 10, C2: 10, C3: 10, C4: 10, C5: 10, C6: 10, C8: 10, C9: 10, C10: 20, C11: 10, C12: 15, C13: 10, C14: 10, C15: 15, C16: 10, C17: 10, C18: 10, C20: 10 },
  ENGINE_MGT: { C1: 10, C2: 26, C3: 28, C4: 10, C5: 20, C6: 20, C7: 10, C8: 10, C9: 10, C10: 10, C11: 10, C12: 10, C13: 10, C14: 16 }
}
export const mockExamItemCount = (track: TrackId, competenceId: string) => MOCK_EXAM_ITEMS[track][competenceId] ?? (track === 'GMDSS_GOC' ? 50 : 15)

export const totalMockExamQuestionCount = (track: TrackId): number =>
  Object.values(MOCK_EXAM_ITEMS[track]).reduce((total, count) => total + count, 0)
