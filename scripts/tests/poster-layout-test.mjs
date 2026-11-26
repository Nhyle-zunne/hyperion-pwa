import test from 'node:test'
import assert from 'node:assert/strict'
import { fitPosterText, posterOffsetFromPercent, posterPortraitBlend } from '../../src/lib/posterLayout.mjs'

const width = (text, size) => text.length * size * 0.55

test('a typical candidate name stays on one line', () => {
  const value = fitPosterText('OIC-NW SHELDON R. ABARQUEZ', { maxWidth: 800, preferredSize: 54, minSize: 20, maxLines: 2 }, width)
  assert.deepEqual(value.lines, ['OIC-NW SHELDON R. ABARQUEZ'])
  assert.ok(width(value.lines[0], value.fontSize) <= 800)
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
    'MARINA LICENSURE EXAMINATION\nFOR MARINE DECK OFFICERS',
    { maxWidth: 706, preferredSize: 47, minSize: 28, maxLines: 2 },
    (text, size) => text.length * size * 0.4,
  )
  assert.deepEqual(value.lines, ['MARINA LICENSURE EXAMINATION', 'FOR MARINE DECK OFFICERS'])
  assert.equal(value.fontSize, 47)
})


test('short portraits extend from below the shoulders and fade to transparency at the new edge', () => {
  const blend = posterPortraitBlend(271, 236, 782, 0)
  assert.ok(blend.torsoStart > 610 && blend.torsoStart < 675)
  assert.ok(blend.extension >= 200 && blend.extension <= 225)
  assert.ok(blend.fadeStart > 782 - 65)
  assert.equal(blend.fadeEnd, 782 + blend.extension)
})

test('full portraits and head-only crops use a fade without stretching', () => {
  const full = posterPortraitBlend(271, 236, 1165, 0)
  assert.equal(full.extension, 0)
  assert.equal(full.fadeEnd, 1105)
  const head = posterPortraitBlend(271, 236, 620, 0)
  assert.equal(head.extension, 0)
  assert.ok(head.fadeStart < head.fadeEnd)
  assert.equal(head.fadeEnd, 620)
})
