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

const QR_RENDER_OPTIONS = {
    errorCorrectionLevel: 'H',
    width: 1024,
    margin: 4,
    color: { dark: '#071F41', light: '#FFFFFF' },
    type: 'image/png',
}

export async function renderQrPng(payload, logoFile) {
  if (!logoFile) return QRCode.toDataURL(payload, QR_RENDER_OPTIONS)

  const logo = await createImageBitmap(logoFile)
  try {
    const canvas = document.createElement('canvas')
    await QRCode.toCanvas(canvas, payload, QR_RENDER_OPTIONS)
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser could not draw the logo.')

    const center = canvas.width / 2
    const backingSize = Math.round(canvas.width * 0.18)
    context.fillStyle = '#FFFFFF'
    context.fillRect(Math.round(center - backingSize / 2), Math.round(center - backingSize / 2), backingSize, backingSize)

    const maxLogoSize = canvas.width * 0.15
    const scale = Math.min(maxLogoSize / logo.width, maxLogoSize / logo.height)
    const width = Math.round(logo.width * scale)
    const height = Math.round(logo.height * scale)
    context.drawImage(logo, Math.round(center - width / 2), Math.round(center - height / 2), width, height)

    let isReadable = false
    try { isReadable = decodeQrPixels(context.getImageData(0, 0, canvas.width, canvas.height)) === payload }
    catch { /* An unreadable QR must not be available for download. */ }
    if (!isReadable) {
      throw new Error('The QR code is not readable with this logo. Try a simpler logo.')
    }
    return canvas.toDataURL('image/png')
  } finally {
    logo.close()
  }
}
