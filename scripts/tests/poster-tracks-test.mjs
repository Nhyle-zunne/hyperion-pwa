import test from 'node:test'
import assert from 'node:assert/strict'
import { POSTER_TRACKS, fullPosterName, formatPosterDate } from '../../src/lib/posterTracks.mjs'

test('every Hyperion licensure track has a distinct poster title', () => {
  assert.deepEqual(POSTER_TRACKS.map(track => [track.id, track.prefix]), [
    ['oic_nw', 'OIC-NW'],
    ['oic_ew', 'OIC-EW'],
    ['chief_mate', 'C/M'],
    ['master_mariner', 'CAPT.'],
    ['second_engineer', '2/E'],
    ['chief_engineer', 'C/E'],
    ['gmdss', ''],
  ])
  assert.equal(new Set(POSTER_TRACKS.map(track => track.id)).size, 7)
})

test('deck and engine degrees and licensure headings follow track selection', () => {
  const deck = POSTER_TRACKS.find(track => track.id === 'chief_mate')
  const engine = POSTER_TRACKS.find(track => track.id === 'chief_engineer')
  const gmdss = POSTER_TRACKS.find(track => track.id === 'gmdss')
  assert.match(deck.defaultDegree, /Marine Transportation/)
  assert.match(deck.examTitle, /MARINE DECK OFFICERS/)
  assert.match(engine.defaultDegree, /Marine Engineering/)
  assert.match(engine.examTitle, /MARINE ENGINE OFFICERS/)
  assert.match(gmdss.examTitle, /GMDSS.*RADIO OPERATORS/)
  assert.equal(gmdss.defaultDegree, '')
})

test('rank prefix is automatic, but never duplicated', () => {
  assert.equal(fullPosterName('oic_nw', '  Sheldon   R. Abarquez  '), 'OIC-NW Sheldon R. Abarquez')
  assert.equal(fullPosterName('oic_nw', 'OIC-NW Sheldon R. Abarquez'), 'OIC-NW Sheldon R. Abarquez')
  assert.equal(fullPosterName('master_mariner', 'Juan Dela Cruz'), 'CAPT. Juan Dela Cruz')
  assert.equal(fullPosterName('gmdss', 'Juan Dela Cruz'), 'Juan Dela Cruz')
  assert.equal(fullPosterName('chief_engineer', ' '), '')
})

test('calendar dates do not shift with local timezone', () => {
  assert.equal(formatPosterDate('2026-11-26'), 'November 26, 2026')
  assert.equal(formatPosterDate('2026-02-30'), '')
  assert.equal(formatPosterDate(''), '')
})
