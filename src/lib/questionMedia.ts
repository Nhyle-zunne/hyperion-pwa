import type { TrackId } from '../types/question'

/** Shared with Android's QuestionMedia parser.
 * This is an authenticated asset reference, NEVER a public URL or image bytes. */
export type QuestionImageRef = {
  sha256: string
  mime: 'image/webp' | 'image/png' | 'image/jpeg'
  placement: 'question' | 'explanation'
  alt: string
}

export const QUESTION_MEDIA_COLUMN = 'HYPERION_MEDIA'
export const QUESTION_MEDIA_LIMIT = 4
export const QUESTION_MEDIA_MAX_BYTES = 524288
export const QUESTION_MEDIA_TRACKS: TrackId[] = [
  'DECK_OIC_NW', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT', 'GMDSS_GOC'
]

const SHA256 = /^[a-f0-9]{64}$/
const MIMES = new Set<QuestionImageRef['mime']>(['image/webp', 'image/png', 'image/jpeg'])
const PLACEMENTS = new Set<QuestionImageRef['placement']>(['question', 'explanation'])

export function validQuestionImageRef(value: unknown): value is QuestionImageRef {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const row = value as Record<string, unknown>
  return Object.keys(row).length === 4 &&
    typeof row.sha256 === 'string' && SHA256.test(row.sha256) &&
    MIMES.has(row.mime as QuestionImageRef['mime']) &&
    PLACEMENTS.has(row.placement as QuestionImageRef['placement']) &&
    typeof row.alt === 'string' && row.alt.trim().length > 0 &&
    row.alt.length <= 160 && !/[\x00-\x1F\x7F]/.test(row.alt)
}

/** A prompt can be text, or a valid image displayed with the question. */
export function hasQuestionPrompt(text: string, refs: QuestionImageRef[] = []): boolean {
  return !!text.trim() || (refs.every(validQuestionImageRef) && refs.some(ref => ref.placement === 'question'))
}

export function parseQuestionImageRefs(raw: unknown): QuestionImageRef[] {
  if (typeof raw !== 'string' || raw.length > 2048 || raw.trim() === '') return []
  let value: unknown
  try { value = JSON.parse(raw) } catch { return [] }
  if (!Array.isArray(value) || value.length < 1 || value.length > QUESTION_MEDIA_LIMIT ||
      !value.every(validQuestionImageRef)) return []
  const list = value as QuestionImageRef[]
  const keySet = new Set(list.map(item => `${item.sha256}:${item.placement}`))
  return keySet.size === list.length ? list : []
}

export function parseQuestionImageRefsFromCsv(header: string[], row: string[]): QuestionImageRef[] {
  const index = header.findIndex(cell => cell.trim().toUpperCase() === QUESTION_MEDIA_COLUMN)
  return index < 0 ? [] : parseQuestionImageRefs(row[index])
}

export function serializeQuestionImageRefs(refs: QuestionImageRef[]): string {
  if (!refs.length) return ''
  const encoded = JSON.stringify(refs)
  if (encoded.length > 2048 ||
      parseQuestionImageRefs(encoded).length !== refs.length) {
    throw new Error('Question image attachment metadata is invalid.')
  }
  return encoded
}

/** Maps an encrypted bank source to the same license track used by Android. */
export function mediaTrackForBankPath(path: string): TrackId | null {
  if (/^deck\/[a-z0-9_]+\.csv\.enc$/.test(path)) return 'DECK_OIC_NW'
  if (/^engine_ew\/[a-z0-9_]+\.csv\.enc$/.test(path)) return 'ENGINE_OIC_EW'
  if (/^deck_mgt\/[a-z0-9_]+\.csv\.enc$/.test(path)) return 'DECK_MGT'
  if (/^engine_mgt\/[a-z0-9_]+\.csv\.enc$/.test(path)) return 'ENGINE_MGT'
  if (/^gmdss\/[a-z0-9_]+\.csv\.enc$/.test(path)) return 'GMDSS_GOC'
  return null
}
