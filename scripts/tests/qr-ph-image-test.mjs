import test from 'node:test'
import assert from 'node:assert/strict'
import { PNG } from 'pngjs'
import { decodeQrPixels, decodeQrResult, renderQrPng } from '../../src/lib/qrImageEditor.mjs'
import { replaceQrPhRecipientName, parseQrPhPayload } from '../../src/lib/qrPhNameEditor.mjs'

const ORIGINAL = '00020101021127300012com.p2pqrpay0102AB040496025204601653036085802PH5908OLD NAME6004TEST6304F723'

test('generated QR image scans back to the edited recipient and unchanged account data', async () => {
  const updated = replaceQrPhRecipientName(ORIGINAL, 'HYPERION MARITIME')
  const imageUrl = await renderQrPng(updated)
  assert.match(imageUrl, /^data:image\/png;base64,/)
  const png = PNG.sync.read(Buffer.from(imageUrl.split(',')[1], 'base64'))
  const decoded = decodeQrPixels({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height })
  assert.equal(decoded, updated)
  assert.equal(parseQrPhPayload(decoded).recipientName, 'HYPERION MARITIME')
})

test('optional centered logo appears in the downloaded PNG without changing encoded payment data', async () => {
  const updated = replaceQrPhRecipientName(ORIGINAL, 'HYPERION MARITIME')
  const previousDocument = globalThis.document
  const previousCreateImageBitmap = globalThis.createImageBitmap
  const canvas = createTestCanvas()
  let bitmapClosed = false
  globalThis.document = { createElement: tag => tag === 'canvas' ? canvas : null }
  globalThis.createImageBitmap = async () => ({ width: 200, height: 100, close() { bitmapClosed = true } })
  try {
    const imageUrl = await renderQrPng(updated, new Blob(['sample-logo'], { type: 'image/png' }))
    const png = PNG.sync.read(Buffer.from(imageUrl.split(',')[1], 'base64'))
    const decoded = decodeQrPixels({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height })
    assert.equal(decoded, updated)
    assert.equal(parseQrPhPayload(decoded).recipientName, 'HYPERION MARITIME')
    assert.equal(bitmapClosed, true)
    assert.equal(png.width, 1024)
    const center = (512 * png.width + 512) * 4
    assert.deepEqual([...png.data.subarray(center, center + 3)], [220, 40, 40])
    assert.equal(canvas.logoDraws.length, 1)
    const { x, y, width, height } = canvas.logoDraws[0]
    assert.ok(width <= 0.16 * 1024 && height <= 0.16 * 1024)
    assert.ok(Math.abs(x + width / 2 - 512) <= 1)
    assert.ok(Math.abs(y + height / 2 - 512) <= 1)
  } finally {
    globalThis.document = previousDocument
    globalThis.createImageBitmap = previousCreateImageBitmap
  }
})

test('does not download a logo-covered QR if the resulting pixels cannot be decoded', async () => {
  const previousDocument = globalThis.document
  const previousCreateImageBitmap = globalThis.createImageBitmap
  globalThis.document = { createElement: () => createTestCanvas({ unreadable: true }) }
  let bitmapClosed = false
  globalThis.createImageBitmap = async () => ({ width: 100, height: 100, close() { bitmapClosed = true } })
  try {
    await assert.rejects(renderQrPng(ORIGINAL, new Blob(['logo'])), /not readable with this logo/i)
    assert.equal(bitmapClosed, true)
  } finally {
    globalThis.document = previousDocument
    globalThis.createImageBitmap = previousCreateImageBitmap
  }
})

function createTestCanvas({ unreadable = false } = {}) {
  let pixels
  const canvas = {
    width: 0,
    height: 0,
    logoDraws: [],
    getContext() {
      return {
        createImageData: (width, height) => ({ width, height, data: new Uint8ClampedArray(width * height * 4) }),
        clearRect() {},
        putImageData: image => { pixels = new Uint8ClampedArray(image.data) },
        fillRect(x, y, width, height) { paint(x, y, width, height, [255, 255, 255]) },
        drawImage(_image, x, y, width, height) {
          canvas.logoDraws.push({ x, y, width, height })
          paint(x, y, width, height, [220, 40, 40])
        },
        getImageData: () => ({ width: canvas.width, height: canvas.height, data: unreadable ? new Uint8ClampedArray(pixels.length).fill(255) : pixels }),
      }
    },
    toDataURL() {
      const output = new PNG({ width: canvas.width, height: canvas.height })
      output.data = Buffer.from(pixels)
      return `data:image/png;base64,${PNG.sync.write(output).toString('base64')}`
    },
  }
  function paint(x, y, width, height, rgb) {
    for (let row = Math.ceil(y); row < y + height; row++) {
      for (let column = Math.ceil(x); column < x + width; column++) {
        const offset = (row * canvas.width + column) * 4
        pixels.set([...rgb, 255], offset)
      }
    }
  }
  return canvas
}

test('rejects images that do not contain a readable QR code', () => {
  const pixels = new Uint8ClampedArray(80 * 80 * 4).fill(255)
  assert.throws(() => decodeQrPixels({ data: pixels, width: 80, height: 80 }), /QR code/i)
})

test('reads a black-on-transparent QR by compositing its transparent modules over white', async () => {
  const imageUrl = await renderQrPng(ORIGINAL)
  const png = PNG.sync.read(Buffer.from(imageUrl.split(',')[1], 'base64'))
  for (let pixel = 0; pixel < png.data.length; pixel += 4) {
    if (png.data[pixel] > 180) {
      png.data[pixel] = 0
      png.data[pixel + 1] = 0
      png.data[pixel + 2] = 0
      png.data[pixel + 3] = 0
    }
  }
  const decoded = decodeQrPixels({ data: new Uint8ClampedArray(png.data), width: png.width, height: png.height })
  assert.equal(decoded, ORIGINAL)
})

test('rejects QR decoder text that loses bytes from the encoded payment payload', () => {
  assert.throws(() => decodeQrResult({ data: 'AB', binaryData: [65, 66, 255] }), /bytes|decode/i)
})
