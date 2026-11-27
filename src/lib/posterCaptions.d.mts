export const POSTER_CAPTION_STYLES: readonly string[]

export function createPosterCaption(
  trackId: string,
  style: number,
  details: { name: string; date?: string; school?: string; company?: string },
): string
