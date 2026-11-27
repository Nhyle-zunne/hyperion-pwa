import jsQR from 'jsqr'
import QRCode from 'qrcode'

export function decodeQrPixels(imageData) {
  let pixels = imageData.data
  let transparent = false
  for (let offset = 3; offset < pixels.length; offset += 4) {
    if (pixels[offset] < 255) { transparent = true; break }
  }
  if (transparent) {
    pixels = new Uint8ClampedArray(pixels)
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3] / 255
      for (let channel = 0; channel < 3; channel++) {
        pixels[offset + channel] = pixels[offset + channel] * alpha + 255 * (1 - alpha)
      }
      pixels[offset + 3] = 255
    }
  }
  const result = jsQR(pixels, imageData.width, imageData.height, { inversionAttempts: 'attemptBoth' })
  if (!result) throw new Error('No readable QR code found. Try a clearer screenshot or crop closer to the QR.')
  return decodeQrResult(result)
}

export function decodeQrResult(result) {
  const bytes = new TextEncoder().encode(result.data)
  if (!result.binaryData || bytes.length !== result.binaryData.length ||
    bytes.some((byte, index) => byte !== result.binaryData[index])) {
    throw new Error('The QR code could not be decoded without losing payment bytes.')
  }
  return result.data
}

export function renderQrPng(payload) {
  return QRCode.toDataURL(payload, {
    errorCorrectionLevel: 'H',
    width: 1024,
    margin: 4,
    color: { dark: '#071F41', light: '#FFFFFF' },
    type: 'image/png',
  })
}
