import type { TrackId } from '../types/question'

/** Display names only; persisted track IDs remain unchanged. */
export const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

export function trackLabel(track: string): string {
  return Object.prototype.hasOwnProperty.call(TRACK_LABELS, track)
    ? TRACK_LABELS[track as TrackId]
    : track.replace(/_/g, ' ')
}
