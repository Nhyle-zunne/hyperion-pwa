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

export function findPortraitFrame({ width, height, data }) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 220))
  const minRowPixels = Math.max(2, Math.ceil(width * 0.035 / step))
  const rows = []
  for (let y = 0; y < height; y += step) {
    let count = 0
    let left = width
    let right = 0
    for (let x = 0; x < width; x += step) {
      if (data[(y * width + x) * 4 + 3] < 153) continue
      count++
      left = Math.min(left, x)
      right = Math.min(width, x + step)
    }
    if (count >= minRowPixels) rows.push({ y, left, right })
  }

  if (!rows.length) return null
  const top = rows[0].y
  const personHeight = rows[rows.length - 1].y - top + step
  if (personHeight < height * 0.12) return null

  // Read the upper part of the silhouette so broad or uneven shoulders do not set the crop.
  const headBottom = top + Math.min(personHeight * 0.28, width * 0.22)
  const headRows = rows.filter(row => row.y <= headBottom)
  const left = Math.min(...headRows.map(row => row.left))
  const right = Math.max(...headRows.map(row => row.right))
  return { top, headCenter: (left + right) / 2, headWidth: right - left }
}
