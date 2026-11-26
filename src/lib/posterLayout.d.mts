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

export function posterPortraitBlend(headTop: number, headWidth: number, visibleBottom: number, yOffset: number):
  { torsoStart: number; extension: number; fadeStart: number; fadeEnd: number }

export function posterPortraitPlacement(headWidth: number, shoulderWidth: number): { headCenter: number; scale: number }
