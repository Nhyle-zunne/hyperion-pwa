import test from 'node:test'
import assert from 'node:assert/strict'
import { applyPortraitAlpha } from '../../src/lib/posterAlpha.mjs'

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
