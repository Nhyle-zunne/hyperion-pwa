/**
 * Only presentation/search logic for the admin question-bank selector.
 * Individual selections remain immutable publisher asset paths; aggregate
 * scopes use a synthetic value that must never be sent as a bank path.
 */
export type QuestionBankPickerAsset = {
  path: string
  track: string
  competenceId: string
  part: number | null
  label: string
}

export const QUESTION_BANK_TRACK_NAMES: Record<string, string> = {
  DECK_OIC_NW: 'Deck OIC-NW',
  ENGINE_OIC_EW: 'Engine OIC-EW',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management',
  GMDSS_GOC: 'GMDSS GOC'
}

export function isAllQuestionBankScope(value: string): boolean {
  return value === '@all' || /^@all:[A-Z0-9_]+$/.test(value)
}

export function questionBankScopeTrack(value: string): string | null {
  return isAllQuestionBankScope(value) && value !== '@all' ? value.slice(5) : null
}

export function showAllQuestionBankOption(query: string): boolean {
  return !query.trim() || /\ball\b/i.test(query)
}

export function sortQuestionBankAssets<T extends QuestionBankPickerAsset>(
  assets: T[], tracks: ReadonlyArray<readonly [string, string]>
): T[] {
  const trackOrder = new Map(tracks.map(([track], index) => [track, index]))
  for (const asset of assets) {
    if (!trackOrder.has(asset.track)) trackOrder.set(asset.track, trackOrder.size)
  }
  return [...assets].sort((a, b) =>
    trackOrder.get(a.track)! - trackOrder.get(b.track)!
    || a.competenceId.localeCompare(b.competenceId, 'en', { numeric: true })
    || (a.part ?? 0) - (b.part ?? 0)
  )
}

export function questionBankPickerLabel(asset: QuestionBankPickerAsset): string {
  const track = QUESTION_BANK_TRACK_NAMES[asset.track] || asset.track
  return track + ' · ' + asset.competenceId + (asset.part == null ? '' : ' · Part ' + asset.part)
}

function normalize(value: string): string {
  return value.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, ' ').trim()
}

export function searchQuestionBankAssets<T extends QuestionBankPickerAsset>(assets: T[], input: string): T[] {
  const terms = normalize(input).split(/\s+/).filter(Boolean)
  if (!terms.length) return assets
  return assets.filter(asset => {
    const haystack = normalize([
      QUESTION_BANK_TRACK_NAMES[asset.track] || asset.track,
      asset.competenceId,
      asset.part == null ? '' : 'Part ' + asset.part,
      asset.label,
      asset.path
    ].join(' '))
    return terms.every(term => haystack.includes(term))
  })
}

/** Filter by the exact publisher track before applying the existing fuzzy search.
 * A null track keeps the original global search behavior intact. */
export function filterQuestionBankAssets<T extends QuestionBankPickerAsset>(assets: T[], track: string | null, query: string): T[] {
  return searchQuestionBankAssets(track ? assets.filter(asset => asset.track === track) : assets, query)
}
