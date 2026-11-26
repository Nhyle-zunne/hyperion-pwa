export function fitPosterText(text, { maxWidth, preferredSize, minSize, maxLines }, measureWidth) {
  const words = String(text || '').trim().split(/\s+/).filter(Boolean)
  if (!words.length) return { fontSize: preferredSize, lines: [] }

  for (let allowedLines = 1; allowedLines <= maxLines; allowedLines++) {
    for (let fontSize = preferredSize; fontSize >= minSize; fontSize--) {
    const lines = []
    let current = ''
    let fits = true
    for (const word of words) {
      if (measureWidth(word, fontSize) > maxWidth) { fits = false; break }
      const next = current ? `${current} ${word}` : word
      if (measureWidth(next, fontSize) <= maxWidth) current = next
      else { lines.push(current); current = word }
      if (lines.length >= allowedLines) { fits = false; break }
    }
    if (fits && current) lines.push(current)
      if (fits && lines.length <= allowedLines) return { fontSize, lines }
    }
  }
  return null
}

export function posterOffsetFromPercent(percent, dimension) {
  return dimension * percent / 100
}
