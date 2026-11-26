export function fitPosterText(
  text: string,
  options: { maxWidth: number; preferredSize: number; minSize: number; maxLines: number },
  measureWidth: (text: string, fontSize: number) => number,
): { fontSize: number; lines: string[] } | null

export function posterOffsetFromPercent(percent: number, dimension: number): number

interface PosterTextLayout {
  x: number
  baseline: number
  maxWidth: number
  fontSize: number
  minSize: number
  maxLines?: number
  lineHeight?: number
  singleLineMinSize?: number
  wrappedFontSize?: number
}

export const POSTER_TEXT_LAYOUT: Readonly<{
  name: PosterTextLayout
  degree: PosterTextLayout
  date: PosterTextLayout
  exam: PosterTextLayout
  school: PosterTextLayout
  company: PosterTextLayout
}>
