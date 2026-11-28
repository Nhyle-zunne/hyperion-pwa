import test from 'node:test'
import assert from 'node:assert/strict'
import { POSTER_TRACKS } from '../../src/lib/posterTracks.mjs'
import { POSTER_CAPTION_STYLES, createPosterCaption } from '../../src/lib/posterCaptions.mjs'

const expectedStyles = [
  'Professional',
  'Sincere',
  'Taglish, Proud',
  'Taglish, Heartfelt',
  'Bold',
  'Nautical',
  'Inspirational',
  'Taglish, Casual and Fun',
  'Faith and Gratitude',
  'Hyperion Brand',
]

const expectedHeadlines = [
  '⚓ Congratulations, Officer! ⚓',
  '💙 You Did It! 💙',
  '🎉 PASADO, OFFICER! 🎉',
  '🥹 Pangarap, Natupad! ⚓',
  '⚓ NEW OFFICER ON DECK! ⚓',
  '🧭 Course Well Steered! 🌊',
  '✨ Dream Achieved! ✨',
  '😎 Congrats, Officer! ⚓',
  '🙏 To God Be the Glory! 🙏',
  '💛 Proud of You! 💙',
]

test('the ten example styles have distinct long-form captions across all eight tracks', () => {
  assert.deepEqual(POSTER_CAPTION_STYLES, expectedStyles)
  const all = new Set()
  for (const track of POSTER_TRACKS) {
    for (const [index] of POSTER_CAPTION_STYLES.entries()) {
      const caption = createPosterCaption(track.id, index, { name: 'Alex Reyes', date: '2026-11-27' })
      assert.ok(caption.includes(`${track.prefix} Alex Reyes`), `${track.id}, style ${index}`)
      assert.match(caption.toLowerCase(), new RegExp(track.examTitle.split('\n')[1].toLowerCase()), `${track.id}, style ${index}`)
      assert.match(caption, /November 27, 2026 MARINA Licensure Examination/, `${track.id}, style ${index}`)
      assert.ok(caption.length > 450, `${track.id}, style ${index} should provide a meaningful explanation`)
      assert.ok(!all.has(caption), `${track.id}, style ${index} should be unique`)
      assert.match(caption, /🌐 HyperionMaritime\.org\n📘 @HyperionMaritime\n#HyperionMaritime/, `${track.id}, style ${index}`)
      assert.match(caption, /#MARINA .*#ProudSeafarer$/, `${track.id}, style ${index}`)
      assert.doesNotMatch(caption, /\*\*|&#x20;|\\\n|\b(?:first take|1 take|100% passing)\b/i)
      all.add(caption)
    }
  }
  assert.equal(all.size, 80)
})

test('OIC-NW presets preserve the provided headlines, school, degree, and canonical footer', () => {
  const details = {
    name: 'Patrick A. Abundo',
    date: '2026-11-27',
    school: 'University of Cebu - METC',
  }
  for (const [index, headline] of expectedHeadlines.entries()) {
    const caption = createPosterCaption('oic_nw', index, details)
    assert.ok(caption.startsWith(headline + '\n\n'), `style ${index}`)
    assert.match(caption, /OIC-NW Patrick A\. Abundo/)
    assert.match(caption, /🏫 University of Cebu - METC/)
    assert.ok(caption.endsWith('🌐 HyperionMaritime.org\n📘 @HyperionMaritime\n#HyperionMaritime #OICNW #MARINA #MarineDeckOfficer #UniversityOfCebuMETC #ProudSeafarer'))
  }
  for (const index of [0, 9]) {
    assert.match(createPosterCaption('oic_nw', index, details), /🎓 BS Marine Transportation/)
  }
  assert.match(createPosterCaption('oic_nw', 9, details), /Learning shouldn't be a luxury\. ⚓/)
  assert.match(createPosterCaption('oic_nw', 2, details), /Nagbunga na ang lahat ng puyat, pagod, at sipag mo/)
})

test('captions update with live fields and omit unprovided details', () => {
  assert.equal(createPosterCaption('gmdss', 0, { name: ' ' }), '')
  assert.equal(createPosterCaption('unknown', 0, { name: 'Alex Reyes' }), '')
  const values = { name: 'OIC-NW Alex Reyes', date: '2026-11-26', school: ' Maritime College ', company: ' Sample Maritime ' }
  const caption = createPosterCaption('gmdss', 0, values)
  assert.match(caption, /OIC-NW Alex Reyes/)
  assert.doesNotMatch(caption, /OIC-NW OIC-NW/)
  assert.match(caption, /November 26, 2026/)
  assert.match(caption, /🏫 Maritime College/)
  assert.match(caption, /🚢 Sample Maritime/)
  assert.match(caption, /#GMDSSGOC #MARINA #RadioOperator #MaritimeCollege #ProudSeafarer/)

  const updated = createPosterCaption('gmdss', 0, { ...values, date: '', school: '', company: '' })
  assert.doesNotMatch(updated, /November 26|🏫|🚢|#MaritimeCollege|Examination date:|School:|Company or sponsor:/)
  assert.match(updated, /the MARINA Licensure Examination for GMDSS Radio Operators/)
  assert.equal(createPosterCaption('oic_nw', 0, { name: 'Alex Reyes', date: '2026-02-30' }).includes('February'), false)
})

test('engine and management captions avoid deck-only titles and use matching metadata', () => {
  const engineer = createPosterCaption('oic_ew', 0, { name: 'Alex Reyes', school: 'St. Mary’s College' })
  assert.match(engineer, /^⚙️ Congratulations, Engineer! ⚙️/)
  assert.match(engineer, /🎓 BS Marine Engineering/)
  assert.match(engineer, /#OICEW #MARINA #MarineEngineer #StMarysCollege #ProudSeafarer/)
  assert.doesNotMatch(engineer, /every watch|Officer on Deck/i)

  const captain = createPosterCaption('master_mariner', 4, { name: 'Alex Reyes' })
  assert.match(captain, /^⚓ NEW CAPTAIN ON DECK! ⚓/)
  assert.match(captain, /#MasterMariner #MARINA #DeckManagement/)

  const chief = createPosterCaption('chief_engineer', 4, { name: 'Alex Reyes' })
  assert.match(chief, /NEW CHIEF ENGINEER ON BOARD/)
  assert.match(chief, /#ChiefEngineer #MARINA #EngineManagement/)
})
