import { readEncryptedPersistedValue, writeEncryptedPersistedValue } from './encryptedPersistStorage'
import type { TrackId } from '../types/question'
export type SavedQuestionContext = { collection: 'bookmarks' | 'mistakes'; selectionId: string }
export interface SavedQuestionSelection extends SavedQuestionContext {
  ownerId: string | null
  track: TrackId
  ids: string[]
  competenceId: string | null
}
export function savedQuestionsReturnPath(source: SavedQuestionContext | null | undefined): string | null {
  return source?.collection === 'bookmarks' ? '/bookmarks' : source?.collection === 'mistakes' ? '/vault' : null
}
export async function createSavedQuestionSelection(collection: SavedQuestionContext['collection'], track: TrackId, ids: string[], competenceId: string | null) {
  const selectionId = crypto.randomUUID()
  const selection: SavedQuestionSelection = { selectionId, collection, track, ids: [...new Set(ids)], competenceId, ownerId: localStorage.getItem('hyperion-progress-owner') }
  await writeEncryptedPersistedValue('hyperion-saved-set:' + selectionId, JSON.stringify(selection))
  return '/saved-questions/config?set=' + selectionId
}
export async function readSavedQuestionSelection(id: string): Promise<SavedQuestionSelection | null> {
  const raw = await readEncryptedPersistedValue('hyperion-saved-set:' + id)
  if (!raw) return null
  try {
    const selection = JSON.parse(raw) as SavedQuestionSelection
    return selection.selectionId === id && ['bookmarks', 'mistakes'].includes(selection.collection) && Array.isArray(selection.ids)
      && selection.ownerId === localStorage.getItem('hyperion-progress-owner') ? selection : null
  } catch { return null }
}
