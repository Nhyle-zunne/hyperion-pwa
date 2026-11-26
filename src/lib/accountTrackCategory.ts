/** Informational account label. Never use it to grant or restrict licensed access. */
export const TRACK_CATEGORIES = ['DECK', 'ENGINE', 'GMDSS'] as const
export type TrackCategory = typeof TRACK_CATEGORIES[number]

export function parseTrackCategory(value: unknown): TrackCategory | null {
  return value === 'DECK' || value === 'ENGINE' || value === 'GMDSS' ? value : null
}
