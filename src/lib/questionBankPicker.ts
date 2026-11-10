/**
 * Only presentation/search logic for the admin question-bank selector.
 * The selected value remains the immutable publisher asset path.
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
