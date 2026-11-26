export const POSTER_TEXT_LAYOUT = Object.freeze({
  name: Object.freeze({ x: 430, baseline: 448, maxWidth: 790, fontSize: 58, minSize: 22, maxLines: 2, lineHeight: 42 }),
  degree: Object.freeze({ x: 430, baseline: 497, maxWidth: 780, fontSize: 36, minSize: 19 }),
  date: Object.freeze({ x: 580, baseline: 663, maxWidth: 380, fontSize: 34, minSize: 19 }),
  exam: Object.freeze({ x: 402, baseline: 789, maxWidth: 706, fontSize: 47, minSize: 28, maxLines: 2, lineHeight: 58 }),
})

export function fitPosterText(text, { maxWidth, preferredSize, minSize, maxLines }, measureWidth) {
  const paragraphs = String(text || '').split(/\\r?\\n/).map(line => line.trim()).filter(Boolean)
  if (!paragraphs.length) return { fontSize: preferredSize, lines: [] }

  for (let fontSize = preferredSize; fontSize >= minSize; fontSize--) {
    const lines = []
    let fits = true

    for (const paragraph of paragraphs) {
      let current = ''
      for (const word of paragraph.split(/\\s+/)) {
        if (measureWidth(word, fontSize) > maxWidth) {
          fits = false
          break
        }
        const next = current ? `${current} ${word}` : word
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
