import test from 'node:test'
import assert from 'node:assert/strict'
import { POSTER_TRACKS, POSTER_DEGREES, fullPosterName, formatPosterDate } from '../../src/lib/posterTracks.mjs'

test('only the four supported license tracks are available', () => {
  assert.deepEqual(POSTER_TRACKS.map(track => [track.id, track.label, track.prefix]), [
    ['oic_nw', 'OIC-NW', 'OIC-NW'],
    ['oic_ew', 'OIC-EW', 'OIC-EW'],
    ['master_mariner', 'CAPT.', 'CAPT.'],
    ['chief_engineer', 'C/E', 'C/E'],
  ])
  assert.equal(new Set(POSTER_TRACKS.map(track => track.id)).size, 4)
})

test('degree dropdown offers only Marine Transportation and Marine Engineering', () => {
  assert.deepEqual(POSTER_DEGREES.map(degree => degree.label), ['Marine Transportation', 'Marine Engineering'])
  assert.deepEqual(POSTER_DEGREES.map(degree => degree.value), [
    'Bachelor of Science in Marine Transportation',
    'Bachelor of Science in Marine Engineering',
  ])
})

test('deck and engine degrees and licensure headings follow track selection', () => {
  const deck = POSTER_TRACKS.find(track => track.id === 'master_mariner')
  const engine = POSTER_TRACKS.find(track => track.id === 'chief_engineer')
  assert.match(deck.defaultDegree, /Marine Transportation/)
  assert.equal(deck.examTitle, 'MARINA LICENSURE EXAMINATION\\nFOR DECK MANAGEMENT LEVEL')
  assert.match(engine.defaultDegree, /Marine Engineering/)
  assert.equal(engine.examTitle, 'MARINA LICENSURE EXAMINATION\\nFOR ENGINE MANAGEMENT LEVEL')
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

test('each active track uses its correct two-line examination description', () => {
  assert.deepEqual(POSTER_TRACKS.map(track => [track.id, track.examTitle]), [
    ['oic_nw', 'MARINA LICENSURE EXAMINATION\\nFOR MARINE DECK OFFICERS'],
    ['oic_ew', 'MARINA LICENSURE EXAMINATION\\nFOR MARINE ENGINEERS'],
    ['master_mariner', 'MARINA LICENSURE EXAMINATION\\nFOR DECK MANAGEMENT LEVEL'],
    ['chief_engineer', 'MARINA LICENSURE EXAMINATION\\nFOR ENGINE MANAGEMENT LEVEL'],
  ])
})
