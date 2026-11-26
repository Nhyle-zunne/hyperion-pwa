export interface PosterTrack {
  id: string
  label: string
  prefix: string
  defaultDegree: string
  examTitle: string
}

export interface PosterDegree {
  label: string
  value: string
}

export const POSTER_DEGREES: ReadonlyArray<PosterDegree>
export const POSTER_TRACKS: ReadonlyArray<PosterTrack>
export function fullPosterName(trackId: string, name: string): string
export function formatPosterDate(value: string): string
