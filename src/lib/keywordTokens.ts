/** Legacy word IDs stay unchanged; punctuation and symbols get IDs after them. */
export function keywordTokens(text: string) {
  const words = [...text.matchAll(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu)]
  const tokens: { id: number; text: string; start: number; end: number; kind: 'word' | 'symbol'; wordId?: number; label: string }[] = []
  let cursor = 0
  let symbols = 0
  const appendSymbols = (end: number) => {
    for (const symbol of text.slice(cursor, end)) {
      const start = cursor
      cursor += symbol.length
      if (!/\s/u.test(symbol)) tokens.push({ id: words.length + symbols++, text: symbol, start, end: cursor, kind: 'symbol', label: symbol })
    }
  }
  words.forEach((word, id) => {
    appendSymbols(word.index!)
    // Compound words keep their old ID, but their punctuation has its own target.
    for (const piece of word[0].matchAll(/[\p{L}\p{N}]+|[^\p{L}\p{N}]/gu)) {
      const start = word.index! + piece.index!
      const symbol = !/[\p{L}\p{N}]/u.test(piece[0])
      tokens.push({ id: symbol ? words.length + symbols++ : id, text: piece[0], start, end: start + piece[0].length, kind: symbol ? 'symbol' : 'word', wordId: id, label: symbol ? piece[0] : word[0] })
    }
    cursor = word.index! + word[0].length
  })
  appendSymbols(text.length)
  return tokens
}

export function readKeywordSelection(raw: unknown, text: string, legacy = false): Set<number> {
  if (!Array.isArray(raw)) throw new Error('Invalid keyword data')
  const tokens = keywordTokens(text)
  const valid = new Set(tokens.filter(token => !legacy || token.kind === 'word').map(token => token.id))
  const selected = new Set(raw.filter((id): id is number => Number.isInteger(id) && valid.has(id)))
  if (legacy) for (const token of tokens) {
    if (token.kind === 'symbol' && token.wordId !== undefined && selected.has(token.wordId)) selected.add(token.id)
  }
  return selected
}

export function toggleKeywordToken(selected: Set<number>, id: number, text: string): Set<number> {
  const tokens = keywordTokens(text)
  const word = tokens.find(token => token.id === id && token.kind === 'word')
  const ids = word ? tokens.filter(token => token.wordId === id).map(token => token.id) : [id]
  const next = new Set(selected)
  const remove = next.has(id)
  for (const target of ids) {
    if (remove) next.delete(target)
    else next.add(target)
  }
  return next
}
