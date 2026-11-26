// Coordinates in the 1254 × 1254 artwork, measured from the reference poster.
export const POSTER_TEXT_LAYOUT = Object.freeze({
  name: Object.freeze({ x: 395, baseline: 449, maxWidth: 650, fontSize: 59, minSize: 27, maxLines: 2, lineHeight: 44, singleLineMinSize: 39, wrappedFontSize: 49 }),
  degree: Object.freeze({ x: 400, baseline: 499, maxWidth: 650, fontSize: 37, minSize: 19 }),
  date: Object.freeze({ x: 421, baseline: 579, maxWidth: 670, fontSize: 41, minSize: 26 }),
  exam: Object.freeze({ x: 411, baseline: 736, maxWidth: 748, fontSize: 72, minSize: 29, maxLines: 2, lineHeight: 84 }),
  school: Object.freeze({ x: 447, baseline: 870, maxWidth: 700, fontSize: 47, minSize: 17, maxLines: 2, lineHeight: 34, singleLineMinSize: 32, wrappedFontSize: 31 }),
  company: Object.freeze({ x: 447, baseline: 925, maxWidth: 700, fontSize: 38, minSize: 14 }),
})

export function fitPosterText(text, { maxWidth, preferredSize, minSize, maxLines }, measureWidth) {
  const paragraphs = String(text || '').split(/\r?\n/).map(line => line.trim()).filter(Boolean)
  if (!paragraphs.length) return { fontSize: preferredSize, lines: [] }

  for (let fontSize = preferredSize; fontSize >= minSize; fontSize--) {
    const lines = []
    let fits = true

    for (const paragraph of paragraphs) {
      let current = ''
      for (const word of paragraph.split(/\s+/)) {
        if (measureWidth(word, fontSize) > maxWidth) {
          fits = false
          break
        }
        const next = current ? current + ' ' + word : word
        if (measureWidth(next, fontSize) <= maxWidth) current = next
        else {
          if (current) lines.push(current)
          current = word
        }
      }
      if (!fits) break
      if (current) lines.push(current)
      if (lines.length > maxLines) {
        fits = false
        break
      }
    }

    if (fits) return { fontSize, lines }
  }
  return null
}

export function posterOffsetFromPercent(percent, dimension) {
  return dimension * percent / 100
}

export const POSTER_PORTRAIT_LEFT = 811

export function posterPortraitPlacement(headWidth, leftExtent, rightExtent, zoom = 1, xOffset = 0) {
  const rightEdge = 1246
  const preferredCenter = 1017
  const scale = Math.min(253 / headWidth * zoom, (rightEdge - POSTER_PORTRAIT_LEFT) / (leftExtent + rightExtent))
  const headCenter = Math.max(POSTER_PORTRAIT_LEFT + leftExtent * scale,
    Math.min(preferredCenter + xOffset, rightEdge - rightExtent * scale))
  // The reference hairline is roughly 22% from the top of the artwork.
  return { headCenter, headTop: 272, scale }
}

export function posterPortraitBlend(headTop, headWidth, visibleBottom, yOffset) {
  // Keep the shoulders and upper chest at the original scale. Stretch only
  // a narrow strip at the bottom, where the artwork blends into the shirt.
  const chestBottom = headTop + headWidth * 1.95
  const torsoStart = Math.max(chestBottom, visibleBottom - headWidth * 0.25)
  const lowerTorso = visibleBottom - torsoStart
  const targetBottom = Math.min(1105, 1055 + yOffset)
  const canExtend = lowerTorso >= headWidth * 0.1
  // The quadratic stretch increases toward the bottom of the strip. Limit the
  // total extension so the shirt keeps its proportions during the fade.
  const extension = canExtend
    ? Math.max(0, Math.min(36, lowerTorso * 0.35, targetBottom - visibleBottom))
    : 0
  const fadeEnd = Math.min(1105, visibleBottom + extension)
  // Keep a longer portrait clear farther down the right side. Short crops
  // still feather into the artwork before the original edge becomes visible.
  const torsoCoverage = Math.max(0, Math.min(1, (visibleBottom - yOffset - 840) / 160))
  const featherLength = 235 - torsoCoverage * 65
  const fadeStart = canExtend
    ? Math.min(fadeEnd - 24, Math.max(chestBottom, fadeEnd - featherLength))
    : fadeEnd - 64
  return { torsoStart, extension, fadeStart, fadeEnd }
}
