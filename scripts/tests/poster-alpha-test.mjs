import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPortraitAlpha, findPortraitFrame, recoverPortraitEdges } from '../../src/lib/posterAlpha.mjs'

test('background removal changes alpha without changing face, hair, or uniform RGB', () => {
  const image = { width: 2, height: 2, data: Uint8ClampedArray.from([
    30, 50, 70, 255, 80, 90, 100, 255,
    120, 130, 140, 255, 200, 210, 220, 255,
  ]) }
  const originalRGB = [30, 50, 70, 80, 90, 100, 120, 130, 140, 200, 210, 220]
  const result = applyPortraitAlpha(image, Float32Array.from([0, 1, 0.5, 1]), 2, 2)
  assert.deepEqual(Array.from(result.data).filter((_, i) => i % 4 !== 3), originalRGB)
  assert.deepEqual(Array.from(result.data).filter((_, i) => i % 4 === 3), [0, 255, 128, 255])
})

test('source transparency is preserved and a smaller segmentation mask scales', () => {
  const image = { width: 2, height: 1, data: Uint8ClampedArray.from([255, 0, 0, 0, 0, 0, 255, 64]) }
  const result = applyPortraitAlpha(image, Float32Array.from([0.5]), 1, 1)
  assert.deepEqual(Array.from(result.data), [255, 0, 0, 0, 0, 0, 255, 32])
})

test('mask dimensions must be valid and match its data length', () => {
  const image = { width: 1, height: 1, data: Uint8ClampedArray.from([1, 2, 3, 255]) }
  assert.throws(() => applyPortraitAlpha(image, Float32Array.from([]), 1, 1), /Invalid portrait mask/)
})

test('upscaled masks blend at the edge instead of producing a hard staircase', () => {
  const image = { width: 4, height: 1, data: Uint8ClampedArray.from([
    20, 40, 60, 255, 20, 40, 60, 255, 20, 40, 60, 255, 20, 40, 60, 255,
  ]) }
  const result = applyPortraitAlpha(image, Float32Array.from([0, 1]), 2, 1)
  assert.deepEqual(Array.from(result.data).filter((_, i) => i % 4 === 3), [0, 64, 191, 255])
})

test('framing finds the head above offset shoulders and ignores faint background pixels', () => {
  const width = 100
  const height = 120
  const data = new Uint8ClampedArray(width * height * 4)
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const head = y >= 26 && y < 67 && x >= 48 && x < 72
      const shoulders = y >= 65 && y < 114 && x >= 28 && x < 98
      data[(y * width + x) * 4 + 3] = head || shoulders ? 255 : 24
    }
  }
  assert.deepEqual(findPortraitFrame({ width, height, data }), { top: 26, bottom: 114, headCenter: 60, headWidth: 24 })
  assert.equal(findPortraitFrame({ width, height, data: data.fill(0) }), null)
})

test('restores connected gold uniform trim without recovering the plain background or disconnected details', () => {
  const width = 50
  const height = 50
  const data = new Uint8ClampedArray(width * height * 4)
  const cutout = new Uint8ClampedArray(data.length)
  const color = (x, y, rgb, alpha) => {
    const i = (y * width + x) * 4
    data.set([...rgb, 255], i)
    cutout.set([...rgb, alpha], i)
  }
  const background = [246, 244, 236]
  const gold = [218, 170, 64]
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) color(x, y, background, 0)
  }
  for (let y = 28; y <= 32; y++) {
    for (let x = 14; x <= 35; x++) color(x, y, x < 19 || x > 30 ? gold : [20, 22, 30], x < 19 || x > 30 ? 32 : 255)
  }
  color(11, 30, gold, 0)
  recoverPortraitEdges({ width, height, data }, { width, height, data: cutout })
  const rgba = (x, y) => [...cutout.slice((y * width + x) * 4, (y * width + x) * 4 + 4)]
  assert.deepEqual(rgba(14, 30), [...gold, 255])
  assert.deepEqual(rgba(35, 30), [...gold, 255])
  assert.deepEqual(rgba(13, 30), [...background, 0])
  assert.deepEqual(rgba(11, 30), [...gold, 0])
})
