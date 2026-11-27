import test from 'node:test'
import assert from 'node:assert/strict'
import { POSTER_TRACKS } from '../../src/lib/posterTracks.mjs'
import { POSTER_CAPTION_STYLES, createPosterCaption } from '../../src/lib/posterCaptions.mjs'

test('each poster label offers ten distinct, track-specific congratulations', () => {
  assert.equal(new Set(POSTER_CAPTION_STYLES).size, 10)
  const all = new Set()
  for (const track of POSTER_TRACKS) {
    for (const [index] of POSTER_CAPTION_STYLES.entries()) {
      const caption = createPosterCaption(track.id, index, { name: 'Alex Reyes' })
      assert.ok(caption.includes(`${track.prefix} Alex Reyes`), track.label)
      const exam = track.examTitle.split('\n')[1]
      assert.ok(caption.toLowerCase().includes(exam.toLowerCase()), track.label)
      assert.ok(!all.has(caption), `${track.label} option ${index + 1}`)
      all.add(caption)
    }
  }
  assert.equal(all.size, 80)
})

test('captions update from supplied details and omit blank fields', () => {
  assert.equal(createPosterCaption('gmdss', 0, { name: ' ' }), '')
  const values = { name: 'OIC-NW Alex Reyes', date: '2026-11-26', school: ' Maritime College ', company: ' ' }
  const caption = createPosterCaption('gmdss', 0, values)
  assert.match(caption, /OIC-NW Alex Reyes/)
  assert.doesNotMatch(caption, /OIC-NW OIC-NW/)
  assert.match(caption, /November 26, 2026/)
  assert.match(caption, /Maritime College/)
  assert.doesNotMatch(caption, /Company/)
  const updated = createPosterCaption('gmdss', 0, { ...values, date: '', school: '', company: 'Sample Maritime' })
  assert.match(updated, /Sample Maritime/)
  assert.doesNotMatch(updated, /Examination date|School/)
})
