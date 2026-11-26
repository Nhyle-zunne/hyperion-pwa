import test from 'node:test'
import assert from 'node:assert/strict'
import { renderPoster, POSTER_EXPORT_SIZE } from '../../src/lib/renderPoster.ts'
import { POSTER_TRACKS } from '../../src/lib/posterTracks.mjs'

test('renders sample-aligned typography and a large two-line track heading', () => {
  const calls = []
  const context = {
    font: '',
    measureText(text) {
      const size = Number(this.font.match(/(\d+(?:\.\d+)?)px/)?.[1] || 0)
      return { width: text.length * size * 0.4 }
    },
    fillText(text, x, y) {
      calls.push({ text, x, y, font: this.font, align: this.textAlign })
    },
    setTransform() {},
    drawImage() {},
    fillRect(x, y, width, height) { calls.push({ x, y, width, height }) },
    createLinearGradient() { return { addColorStop() {} } },
    closePath() {},
    beginPath() {},
    arc() {},
    fill() {},
    moveTo() {},
    lineTo() {},
    ellipse() {},
    stroke() {},
  }
  const canvas = { width: 0, height: 0, getContext: () => context }
  const data = {
    track: POSTER_TRACKS[0],
    name: 'Sheldon R. Abarquez',
    date: '2026-11-26',
    school: 'University of Cebu METC',
    company: '',
    portrait: null,
    scalePercent: 100,
    xOffsetPercent: 0,
    yOffsetPercent: 0,
  }

  renderPoster(canvas, {}, data)

  assert.equal(canvas.width, POSTER_EXPORT_SIZE)
  assert.equal(canvas.height, POSTER_EXPORT_SIZE)

  const name = calls.find(call => call.text === 'OIC-NW SHELDON R. ABARQUEZ')
  assert.ok(name)
  assert.equal(name.x, 423)
  assert.ok(name.y > 400 && name.y < 470)

  const degree = calls.find(call => call.text === data.track.defaultDegree)
  assert.ok(degree)
  assert.ok(degree.y > name.y && degree.y < 510)

  const date = calls.find(call => call.text === 'for passing the November 26, 2026')
  assert.ok(date)
  assert.equal(date.align, 'center')
  assert.equal(date.x, 421)
  assert.ok(date.y > 575 && date.y < 625)

  const exam = calls.filter(call => call.text?.startsWith('MARINA LICENSURE') || call.text === 'FOR MARINE DECK OFFICERS')
  assert.deepEqual(exam.map(call => call.text), [
    'MARINA LICENSURE EXAMINATION',
    'FOR MARINE DECK OFFICERS',
  ])
  assert.equal(exam[0].x, exam[1].x)
  const dividers = calls.filter(call => call.height === 3).map(call => call.y)
  assert.deepEqual(dividers, [641, 836, 955])
  assert.ok(date.y < dividers[0] && exam[0].y > dividers[0] && exam[1].y < dividers[1])
  assert.ok(exam[1].y > exam[0].y)
  const school = calls.find(call => call.text === 'UNIVERSITY OF CEBU METC')
  assert.ok(school.y > dividers[1] && school.y < dividers[2])

  calls.length = 0
  renderPoster(canvas, {}, { ...data, track: POSTER_TRACKS.find(track => track.id === 'gmdss') })
  assert.ok(calls.some(call => call.text === 'OIC-NW SHELDON R. ABARQUEZ'))
  assert.ok(calls.some(call => call.text === 'FOR GMDSS RADIO OPERATORS'))
  assert.ok(calls.some(call => call.text === 'Bachelor of Science in Marine Transportation'))
})
