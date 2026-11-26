// Coordinates are in the artwork's original 1254 × 1254 units.
export const POSTER_TEXT_LAYOUT = Object.freeze({
  name: Object.freeze({ x: 399, baseline: 452, maxWidth: 724, fontSize: 59, minSize: 27, maxLines: 2, lineHeight: 38, singleLineMinSize: 39 }),
  degree: Object.freeze({ x: 387, baseline: 499, maxWidth: 680, fontSize: 37, minSize: 19 }),
  // The template already includes “for passing the”; start just beyond its last glyph.
  date: Object.freeze({ x: 455, baseline: 664, maxWidth: 310, fontSize: 42, minSize: 26, align: 'left' }),
  // The exam title sits between the gold rules at approximately y=733 and y=895.
  exam: Object.freeze({ x: 398, baseline: 831, maxWidth: 700, fontSize: 61, minSize: 29, maxLines: 2, lineHeight: 64 }),
  school: Object.freeze({ x: 465, baseline: 937, maxWidth: 650, fontSize: 34, minSize: 17, maxLines: 2, lineHeight: 23, singleLineMinSize: 23 }),
  company: Object.freeze({ x: 465, baseline: 976, maxWidth: 650, fontSize: 23, minSize: 14 }),
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
