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
      calls.push({ text, x, y, font: this.font })
    },
    setTransform() {},
    drawImage() {},
    fillRect() {},
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
    degree: 'Bachelor of Science in Marine Transportation',
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
  assert.equal(name.x, 430)
  assert.match(name.font, /58px/)

  const degree = calls.find(call => call.text === data.degree)
  assert.ok(degree)
  assert.equal(degree.x, 430)
  assert.match(degree.font, /36px/)

  const date = calls.find(call => call.text === 'November 26, 2026')
  assert.ok(date)
  assert.equal(date.x, 580)
  assert.match(date.font, /34px/)

  const exam = calls.filter(call => call.text.startsWith('MARINA LICENSURE') || call.text === 'FOR MARINE DECK OFFICERS')
  assert.deepEqual(exam.map(call => call.text), [
    'MARINA LICENSURE EXAMINATION',
    'FOR MARINE DECK OFFICERS',
  ])
  assert.deepEqual(exam.map(call => call.x), [402, 402])
  assert.match(exam[0].font, /47px/)
  assert.ok(exam[1].y > exam[0].y)
})
