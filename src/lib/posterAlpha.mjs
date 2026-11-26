export function applyPortraitAlpha(image, mask, maskWidth, maskHeight) {
  if (!Number.isInteger(maskWidth) || maskWidth < 1 || !Number.isInteger(maskHeight) || maskHeight < 1 ||
      mask.length !== maskWidth * maskHeight || image.data.length !== image.width * image.height * 4) {
    throw new Error('Invalid portrait mask')
  }

  const data = new Uint8ClampedArray(image.data)
  for (let y = 0; y < image.height; y++) {
    const maskY = Math.max(0, Math.min(maskHeight - 1, (y + 0.5) * maskHeight / image.height - 0.5))
    const y0 = Math.floor(maskY)
    const y1 = Math.min(maskHeight - 1, y0 + 1)
    const dy = maskY - y0
    for (let x = 0; x < image.width; x++) {
      const offset = (y * image.width + x) * 4 + 3
      const maskX = Math.max(0, Math.min(maskWidth - 1, (x + 0.5) * maskWidth / image.width - 0.5))
      const x0 = Math.floor(maskX)
      const x1 = Math.min(maskWidth - 1, x0 + 1)
      const dx = maskX - x0
      const top = (mask[y0 * maskWidth + x0] || 0) * (1 - dx) + (mask[y0 * maskWidth + x1] || 0) * dx
      const bottom = (mask[y1 * maskWidth + x0] || 0) * (1 - dx) + (mask[y1 * maskWidth + x1] || 0) * dx
      const confidence = Math.max(0, Math.min(1, top * (1 - dy) + bottom * dy))
      data[offset] = Math.round(data[offset] * confidence)
    }
  }
  return { width: image.width, height: image.height, data }
}
