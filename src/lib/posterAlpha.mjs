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

/**
 * On an even backdrop, retain contrasting details that touch the detected
 * subject. Grow only a short distance from the model's confident foreground.
 */
export function recoverPortraitEdges(source, cutout) {
  const { width, height, data } = source
  const left = Math.floor(width * 0.03)
  const right = width - 1 - left
  const upper = Math.floor(height * 0.04)
  const lower = Math.floor(height * 0.28)
  const corners = [upper * width + left, upper * width + right, lower * width + left, lower * width + right]
  const reference = corners[0] * 4
  const contrast = offset => Math.max(
    Math.abs(data[offset] - data[reference]),
    Math.abs(data[offset + 1] - data[reference + 1]),
    Math.abs(data[offset + 2] - data[reference + 2])
  )

  if (corners.some(pixel => {
    const offset = pixel * 4
    return data[offset + 3] < 245 || cutout.data[offset + 3] > 32 || contrast(offset) > 18
  })) return

  const pixels = width * height
  const depth = new Uint8Array(pixels)
  const queue = new Uint32Array(pixels)
  let tail = 0
  for (let i = 0; i < pixels; i++) {
    if (cutout.data[i * 4 + 3] < 184) continue
    depth[i] = 1
    queue[tail++] = i
  }

  const maxDepth = Math.min(200, Math.ceil(Math.min(width, height) * 0.12))
  const restore = (pixel, nextDepth) => {
    if (depth[pixel]) return
    const offset = pixel * 4
    if (contrast(offset) < 34 || data[offset + 3] === 0) return
    depth[pixel] = nextDepth
    queue[tail++] = pixel
    cutout.data[offset + 3] = data[offset + 3]
  }
  for (let head = 0; head < tail; head++) {
    const pixel = queue[head]
    if (depth[pixel] > maxDepth) continue
    const nextDepth = depth[pixel] + 1
    const x = pixel % width
    if (x > 0) restore(pixel - 1, nextDepth)
    if (x < width - 1) restore(pixel + 1, nextDepth)
    if (pixel >= width) restore(pixel - width, nextDepth)
    if (pixel < pixels - width) restore(pixel + width, nextDepth)
  }
}

export function findPortraitFrame({ width, height, data }) {
  const step = Math.max(1, Math.floor(Math.max(width, height) / 220))
  const minRowPixels = Math.max(2, Math.ceil(width * 0.035 / step))
  const rows = []
  for (let y = 0; y < height; y += step) {
    let count = 0
    let left = width
    let right = 0
    let edgeLeft = width
    let edgeRight = 0
    for (let x = 0; x < width; x += step) {
      const opacity = data[(y * width + x) * 4 + 3]
      if (opacity >= 40) {
        edgeLeft = Math.min(edgeLeft, x)
        edgeRight = Math.min(width, x + step)
      }
      if (opacity < 153) continue
      count++
      left = Math.min(left, x)
      right = Math.min(width, x + step)
    }
    if (count >= minRowPixels) rows.push({ y, left, right, edgeLeft, edgeRight })
  }

  if (!rows.length) return null
  const top = rows[0].y
  const bottom = Math.min(height, rows[rows.length - 1].y + step)
  const personHeight = bottom - top
  if (personHeight < height * 0.12) return null

  // Read the upper part of the silhouette so broad or uneven shoulders do not set the crop.
  const headBottom = top + Math.min(personHeight * 0.28, width * 0.22)
  const headRows = rows.filter(row => row.y <= headBottom)
  const left = Math.min(...headRows.map(row => row.left))
  const right = Math.max(...headRows.map(row => row.right))
  const headWidth = right - left
  const fullLeft = Math.min(...rows.map(row => row.edgeLeft))
  const fullRight = Math.max(...rows.map(row => row.edgeRight))
  const upperBottom = top + Math.round(headWidth * 2.75)
  const upperRows = rows.filter(row => row.y < upperBottom)
  const upperLeft = Math.min(...upperRows.map(row => row.edgeLeft))
  const upperRight = Math.max(...upperRows.map(row => row.edgeRight))
  // If the lower body widens substantially, fade it out vertically so
  // the remaining portrait can retain its natural sides at a larger scale.
  const cropLowerBody = bottom > upperBottom && fullRight - fullLeft > (upperRight - upperLeft) * 1.1
  return {
    top,
    bottom: cropLowerBody ? upperBottom : bottom,
    headCenter: (left + right) / 2,
    headWidth,
    silhouetteLeft: cropLowerBody ? upperLeft : fullLeft,
    silhouetteRight: cropLowerBody ? upperRight : fullRight,
  }
}
