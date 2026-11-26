// Coordinates in the 1254 × 1254 artwork, measured from the reference poster.
export const POSTER_TEXT_LAYOUT = Object.freeze({
  name: Object.freeze({ x: 423, baseline: 458, maxWidth: 712, fontSize: 59, minSize: 27, maxLines: 2, lineHeight: 38, singleLineMinSize: 39 }),
  degree: Object.freeze({ x: 400, baseline: 499, maxWidth: 650, fontSize: 37, minSize: 19 }),
  date: Object.freeze({ x: 421, baseline: 598, maxWidth: 670, fontSize: 41, minSize: 26 }),
  exam: Object.freeze({ x: 411, baseline: 765, maxWidth: 700, fontSize: 64, minSize: 29, maxLines: 2, lineHeight: 65 }),
  school: Object.freeze({ x: 471, baseline: 913, maxWidth: 615, fontSize: 35, minSize: 17, maxLines: 2, lineHeight: 23, singleLineMinSize: 24 }),
  company: Object.freeze({ x: 471, baseline: 944, maxWidth: 610, fontSize: 22, minSize: 14 }),
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
