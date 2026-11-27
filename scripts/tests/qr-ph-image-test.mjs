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
