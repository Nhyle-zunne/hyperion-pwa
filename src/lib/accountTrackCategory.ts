/** Informational account label. Never use it to grant or restrict licensed access. */
export const TRACK_CATEGORIES = ['DECK', 'ENGINE', 'GMDSS'] as const
type SingleTrackCategory = typeof TRACK_CATEGORIES[number]
export type TrackCategory = SingleTrackCategory | 'DECK+GMDSS'

export function parseTrackCategory(value: unknown): TrackCategory | null {
  return value === 'DECK' || value === 'ENGINE' || value === 'GMDSS' || value === 'DECK+GMDSS' ? value : null
}

export function hasTrackCategory(value: TrackCategory | null | '', category: SingleTrackCategory): boolean {
  return value === category || (value === 'DECK+GMDSS' && category !== 'ENGINE')
}

export function toggleTrackCategory(value: TrackCategory | null | '', category: SingleTrackCategory): TrackCategory | null {
  if (category === 'ENGINE') return value === 'ENGINE' ? null : 'ENGINE'
  if (value === 'ENGINE' || !value) return category
  if (value === 'DECK+GMDSS') return category === 'DECK' ? 'GMDSS' : 'DECK'
  return value === category ? null : 'DECK+GMDSS'
}
