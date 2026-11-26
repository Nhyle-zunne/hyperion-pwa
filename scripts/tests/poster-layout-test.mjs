import test from 'node:test'
import assert from 'node:assert/strict'
import { fitPosterText } from '../../src/lib/posterLayout.mjs'

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

test('unrenderable text gets an explicit failure instead of overflowing', () => {
  const value = fitPosterText('W'.repeat(180), { maxWidth: 160, preferredSize: 32, minSize: 22, maxLines: 1 }, width)
  assert.equal(value, null)
})
