import test from 'node:test'
import assert from 'node:assert/strict'
import { fitPosterText, posterOffsetFromPercent, posterPortraitBlend, posterPortraitPlacement } from '../../src/lib/posterLayout.mjs'

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


test('short portraits preserve the shoulder boards and extend the shirt below them', () => {
  const blend = posterPortraitBlend(271, 236, 782, 0)
  assert.ok(blend.torsoStart >= 730 && blend.torsoStart < 782)
  const originalShirt = 782 - blend.torsoStart
  assert.ok(blend.extension > 0 && blend.extension <= originalShirt * 0.35)
  assert.ok(blend.extension <= 36)
  assert.ok(blend.fadeStart < 782, 'The fade should already be active at the original bottom edge')
  assert.equal(blend.fadeEnd, 782 + blend.extension)
})

test('full portraits and head-only crops use a fade without stretching', () => {
  const full = posterPortraitBlend(271, 236, 1165, 0)
  assert.equal(full.extension, 0)
  assert.equal(full.fadeEnd, 1110)
  assert.ok(full.fadeStart >= 940 && full.fadeEnd - full.fadeStart >= 115)
  const midTorso = posterPortraitBlend(283, 183, 1012, 0)
  assert.ok(midTorso.fadeEnd >= 1060)
  assert.ok(midTorso.fadeStart >= 920)
  assert.ok(midTorso.torsoStart >= 283 + 183 * 1.95)
  assert.ok(midTorso.extension <= (1012 - midTorso.torsoStart) * 0.28)
  const head = posterPortraitBlend(271, 236, 620, 0)
  assert.equal(head.extension, 0)
  assert.ok(head.fadeStart < head.fadeEnd)
  assert.equal(head.fadeEnd, 620)
})

test('a crop ending near the collar fades without reshaping the shoulder boards', () => {
  const blend = posterPortraitBlend(271, 236, 724, 0)
  assert.equal(blend.extension, 0)
  assert.ok(blend.fadeStart < blend.fadeEnd)
  assert.equal(blend.fadeEnd, 724)
})

test('portrait placement uses the reference head position and fills more of the photo column', () => {
  const reference = posterPortraitPlacement(250, 210, 225)
  assert.equal(reference.headTop, 283)
  assert.ok(Math.abs(reference.headCenter - 1020) <= 12)
  assert.ok(reference.scale >= 1)

  const wide = posterPortraitPlacement(310, 347, 349)
  assert.equal(wide.headTop, 283)
  assert.ok(Math.round(wide.headCenter - 347 * wide.scale) >= 811)
  assert.ok(Math.round(wide.headCenter + 349 * wide.scale) <= 1246)
  assert.ok(wide.scale > 417 / (347 + 349))
})

test('manual zoom and horizontal offsets keep the visible silhouette inside both boundaries', () => {
  for (const xOffset of [-200, 200]) {
    const placement = posterPortraitPlacement(250, 270, 240, 1.4, xOffset)
    assert.ok(Math.round(placement.headCenter - 270 * placement.scale) >= 811)
    assert.ok(Math.round(placement.headCenter + 240 * placement.scale) <= 1246)
  }
})
