import test from 'node:test'
import assert from 'node:assert/strict'
import { fitPosterText, posterOffsetFromPercent, POSTER_TEXT_LAYOUT } from '../../src/lib/posterLayout.mjs'

const width = (text, size) => text.length * size * 0.55

test('a typical candidate name stays on one line', () => {
  const value = fitPosterText('OIC-NW SHELDON R. ABARQUEZ', { maxWidth: 710, preferredSize: 54, minSize: 20, maxLines: 2 }, width)
  assert.deepEqual(value.lines, ['OIC-NW SHELDON R. ABARQUEZ'])
  assert.ok(width(value.lines[0], value.fontSize) <= 710)
})

test('long candidate names wrap without entering the portrait area', () => {
  const value = fitPosterText('CAPT. A VERY LONG FIRST MIDDLE AND FAMILY NAME WITH EXTENSION', { maxWidth: 590, preferredSize: 52, minSize: 24, maxLines: 2 }, width)
  assert.ok(value)
  assert.ok(value.lines.length <= 2)
  assert.ok(value.lines.every(line => width(line, value.fontSize) <= 590))
})

test('percentage-based portrait movement converts to poster coordinates', () => {
  assert.equal(posterOffsetFromPercent(16, 1254), 200.64)
  assert.equal(posterOffsetFromPercent(-13, 1254), -163.02)
  assert.equal(posterOffsetFromPercent(0, 1254), 0)
})

test('unrenderable text gets an explicit failure instead of overflowing', () => {
  const value = fitPosterText('W'.repeat(180), { maxWidth: 160, preferredSize: 32, minSize: 22, maxLines: 1 }, width)
  assert.equal(value, null)
})

test('poster headings keep readable two-line sizing instead of shrinking to one line', () => {
  const value = fitPosterText(
    'MARINA LICENSURE EXAMINATION\\nFOR MARINE DECK OFFICERS',
    { maxWidth: 706, preferredSize: 47, minSize: 28, maxLines: 2 },
    (text, size) => text.length * size * 0.4,
  )
  assert.deepEqual(value.lines, ['MARINA LICENSURE EXAMINATION', 'FOR MARINE DECK OFFICERS'])
  assert.equal(value.fontSize, 47)
})

test('poster text uses the supplied sample alignment and relative sizing', () => {
  assert.equal(POSTER_TEXT_LAYOUT.name.x, POSTER_TEXT_LAYOUT.degree.x)
  assert.equal(POSTER_TEXT_LAYOUT.name.x, 430)
  assert.equal(POSTER_TEXT_LAYOUT.degree.fontSize, 36)
  assert.equal(POSTER_TEXT_LAYOUT.date.x, 580)
  assert.equal(POSTER_TEXT_LAYOUT.exam.fontSize, 47)
  assert.equal(POSTER_TEXT_LAYOUT.exam.maxLines, 2)
})
