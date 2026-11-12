import assert from 'node:assert/strict'
import { keywordTokens, readKeywordSelection, toggleKeywordToken } from '../../src/lib/keywordTokens.ts'
const text = "Vessel gives way; vessel stays clear. 3.5% _____: don't port-side ⚓"
const tokens = keywordTokens(text)
const words = [...new Map(tokens.filter(token => token.kind === 'word').map(token => [token.id, { ...token, text: token.label }])).values()]
assert.deepEqual(words.map(token => token.text), ['Vessel', 'gives', 'way', 'vessel', 'stays', 'clear', '3', '5', "don't", 'port-side'])
assert.deepEqual(words.map(token => token.id), words.map((_, index) => index), 'Existing word positions are preserved')
assert.ok(tokens.find(token => token.text === ';')?.id >= words.length)
assert.equal(tokens.filter(token => token.text === '_').length, 5)
for (const character of ['.', '%', ':', '⚓']) assert.ok(tokens.some(token => token.text === character))
assert.equal(new Set(tokens.filter(token => token.kind === 'symbol').map(token => token.id)).size, tokens.filter(token => token.kind === 'symbol').length)
assert.ok(tokens.some(token => token.text === "'" && token.kind === 'symbol'))
assert.ok(tokens.some(token => token.text === '-' && token.kind === 'symbol'))
assert.ok(tokens.every(token => text.slice(token.start, token.end) === token.text))
assert.deepEqual(keywordTokens('  \n\t'), [])
assert.equal(keywordTokens('⚓!').length, 2)
console.log('PASS: stable legacy word IDs, repeated words, punctuation, decimals, blanks, Unicode symbols and exact text offsets.')

const compound = "ship's give-way"
const compoundTokens = keywordTokens(compound)
const apostrophe = compoundTokens.find(token => token.text === "'").id
let selected = readKeywordSelection([0], compound, true)
assert.ok(selected.has(apostrophe), 'Legacy compound highlights retain punctuation')
selected = toggleKeywordToken(selected, apostrophe, compound)
assert.ok(selected.has(0))
assert.ok(!selected.has(apostrophe), 'Punctuation can be cleared independently')
assert.deepEqual(readKeywordSelection([...selected], compound), selected, 'New saves preserve independent punctuation removal')
selected = toggleKeywordToken(selected, 0, compound)
assert.ok(!selected.has(0))
selected = toggleKeywordToken(selected, 0, compound)
assert.ok(selected.has(apostrophe), 'Selecting a compound word includes its internal punctuation')
console.log('PASS: legacy compound-word migration and independently removable punctuation survive reload.')
