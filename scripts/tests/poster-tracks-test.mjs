import test from 'node:test'
import assert from 'node:assert/strict'
import { POSTER_TRACKS, POSTER_DEGREES, fullPosterName, formatPosterDate } from '../../src/lib/posterTracks.mjs'

test('poster generator exposes only the four requested license tracks', () => {
  assert.deepEqual(POSTER_TRACKS.map(track => [track.label, track.prefix]), [
    ['OIC-NW', 'OIC-NW'],
    ['OIC-EW', 'OIC-EW'],
    ['CAPT.', 'CAPT.'],
    ['C/E', 'C/E'],
  ])
  assert.equal(POSTER_TRACKS.length, 4)
})

test('degree dropdown contains only Marine Transportation and Marine Engineering', () => {
  assert.deepEqual(POSTER_DEGREES, [
    'Bachelor of Science in Marine Transportation',
    'Bachelor of Science in Marine Engineering',
  ])
  assert.deepEqual([...new Set(POSTER_TRACKS.map(track => track.defaultDegree))].sort(), [...POSTER_DEGREES].sort())
})

test('deck and engine exam headings follow the selected track', () => {
  const deck = POSTER_TRACKS.find(track => track.id === 'oic_nw')
  const engine = POSTER_TRACKS.find(track => track.id === 'chief_engineer')
  assert.match(deck.examTitle, /MARINE DECK OFFICERS/)
  assert.match(engine.examTitle, /MARINE ENGINE OFFICERS/)
})

test('rank prefix is automatic, but never duplicated', () => {
  assert.equal(fullPosterName('oic_nw', '  Sheldon   R. Abarquez  '), 'OIC-NW Sheldon R. Abarquez')
  assert.equal(fullPosterName('oic_nw', 'OIC-NW Sheldon R. Abarquez'), 'OIC-NW Sheldon R. Abarquez')
  assert.equal(fullPosterName('master_mariner', 'Juan Dela Cruz'), 'CAPT. Juan Dela Cruz')
  assert.equal(fullPosterName('chief_engineer', 'Juan Dela Cruz'), 'C/E Juan Dela Cruz')
  assert.equal(fullPosterName('chief_engineer', ' '), '')
})

test('calendar dates do not shift with local timezone', () => {
  assert.equal(formatPosterDate('2026-11-26'), 'November 26, 2026')
  assert.equal(formatPosterDate('2026-02-30'), '')
  assert.equal(formatPosterDate(''), '')
})
