import { fitPosterText, posterOffsetFromPercent, posterPortraitBlend, posterPortraitPlacement, POSTER_PORTRAIT_LEFT, POSTER_PORTRAIT_RIGHT, POSTER_TEXT_LAYOUT } from './posterLayout.mjs'
import { formatPosterDate, fullPosterName } from './posterTracks.mjs'
import type { PortraitFrame } from './posterAlpha.mjs'
import type { PosterTrack } from './posterTracks.mjs'

const ART_SIZE = 1254
export const POSTER_EXPORT_SIZE = 2048

export type PosterContent = {
  track: PosterTrack
  name: string
  date: string
  school: string
  company: string
  portrait: HTMLImageElement | null
  portraitFrame?: PortraitFrame
  scalePercent: number
  xOffsetPercent: number
  yOffsetPercent: number
}

export type PosterArtwork = {
  background: HTMLImageElement
  closingMessage: HTMLImageElement
}

function loadArtworkImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load Hyperion artwork. Refresh the page.'))
    image.src = src
  })
}

export async function loadPosterArtwork(): Promise<PosterArtwork> {
  const [background, closingMessage] = await Promise.all([
    loadArtworkImage('/posters/hyperion-poster-artwork.webp'),
    loadArtworkImage('/posters/hyperion-poster-closing-message.webp'),
  ])
  return { background, closingMessage }
}

function drawFittedText(ctx: CanvasRenderingContext2D, text: string, options: {
  x: number; baseline: number; maxWidth: number; fontSize: number; minSize: number
  maxLines?: number; lineHeight?: number; singleLineMinSize?: number; wrappedFontSize?: number; family: string; color: string; weight?: string; italic?: boolean
}) {
  if (!text.trim()) return
  const fontAt = (size: number) => `${options.italic ? 'italic ' : ''}${options.weight || 'normal'} ${size}px ${options.family}`
  const measureWidth = (value: string, size: number) => {
    ctx.font = fontAt(size)
    return ctx.measureText(value).width
  }
  const bounds = {
    maxWidth: options.maxWidth,
    preferredSize: options.fontSize,
    minSize: options.minSize,
    maxLines: options.maxLines || 1,
  }
  const singleLine = options.singleLineMinSize
    ? fitPosterText(text, { ...bounds, minSize: options.singleLineMinSize, maxLines: 1 }, measureWidth)
    : null
  const layout = singleLine ?? fitPosterText(text, { ...bounds, preferredSize: options.wrappedFontSize ?? bounds.preferredSize }, measureWidth)
  if (!layout) throw new Error('One of the text fields is too long. Shorten it before exporting.')

  ctx.font = fontAt(layout.fontSize)
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.fillStyle = options.color
  const lineHeight = options.lineHeight || layout.fontSize * 1.08
  const firstBaseline = options.baseline - (layout.lines.length - 1) * lineHeight / 2
  layout.lines.forEach((line, index) => ctx.fillText(line, options.x, firstBaseline + index * lineHeight))
}

function addPortraitFeather(gradient: CanvasGradient, fadeIn: boolean) {
  for (const [position, opacity] of [[0, 0], [0.25, 0.16], [0.5, 0.5], [0.75, 0.84], [1, 1]]) {
    gradient.addColorStop(position, `rgba(0, 0, 0, ${fadeIn ? opacity : 1 - opacity})`)
  }
}

function drawPortrait(ctx: CanvasRenderingContext2D, portrait: HTMLImageElement, data: PosterContent) {
  const scale = Math.max(70, Math.min(140, data.scalePercent)) / 100
  const xOffset = posterOffsetFromPercent(data.xOffsetPercent, ART_SIZE)
  const yOffset = posterOffsetFromPercent(data.yOffsetPercent, ART_SIZE)

  // A soft left and lower edge lets the uniform meet the maritime artwork
  // naturally without a visible photo box or covering the closing message.
  const layer = document.createElement('canvas')
  layer.width = ART_SIZE
  layer.height = ART_SIZE
  const layerCtx = layer.getContext('2d')
  if (!layerCtx) return
  const frame = data.portraitFrame
  let fadeStart: number
  let fadeEnd: number
  let shoulderBottom = 0
  if (frame) {
    const placement = posterPortraitPlacement(
      frame.headWidth, frame.headCenter - frame.upperBodyLeft, frame.upperBodyRight - frame.headCenter, scale, xOffset
    )
    const portraitScale = placement.scale
    const left = placement.headCenter - frame.headCenter * portraitScale
    const headTop = placement.headTop + yOffset
    shoulderBottom = headTop + frame.headWidth * portraitScale * 1.9
    const top = headTop - frame.top * portraitScale
    const width = portrait.naturalWidth * portraitScale
    const blend = posterPortraitBlend(headTop, frame.headWidth * portraitScale, top + frame.bottom * portraitScale, yOffset)
    fadeStart = blend.fadeStart
    fadeEnd = blend.fadeEnd

    if (blend.extension > 0) {
      const sourceWidth = portrait.naturalWidth
      const sourceTorso = (blend.torsoStart - top) / portraitScale
      layerCtx.drawImage(portrait, 0, 0, sourceWidth, sourceTorso, left, top, width, blend.torsoStart - top)

      // Continue the existing clothing below the shoulders, gradually increasing
      // the stretch toward the part of the cutout covered by the lower feather.
      const torsoHeight = frame.bottom - sourceTorso
      const bands = 12
      const outputY = (fraction: number) =>
        blend.torsoStart + torsoHeight * portraitScale * fraction + blend.extension * fraction ** 2
      for (let band = 0; band < bands; band++) {
        const start = band / bands
        const end = (band + 1) / bands
        layerCtx.drawImage(portrait, 0, sourceTorso + torsoHeight * start, sourceWidth, torsoHeight / bands,
          left, outputY(start), width, outputY(end) - outputY(start))
      }
    } else {
      layerCtx.drawImage(portrait, left, top, width, portrait.naturalHeight * portraitScale)
    }
  } else {
    const halfWidth = portrait.naturalWidth / 2
    const placement = posterPortraitPlacement(halfWidth, halfWidth, halfWidth, scale, xOffset)
    const width = portrait.naturalWidth * placement.scale
    const height = portrait.naturalHeight * placement.scale
    const y = 246 + yOffset
    layerCtx.drawImage(portrait, placement.headCenter - width / 2, y, width, height)
    fadeEnd = Math.min(1105, y + height)
    fadeStart = fadeEnd - 230
  }

  const tintStart = Math.max(shoulderBottom + 35, fadeStart)
  if (frame && tintStart < fadeEnd) {
    // Color only existing portrait pixels below the shoulder boards.
    layerCtx.globalCompositeOperation = 'source-atop'
    const tint = layerCtx.createLinearGradient(0, tintStart, 0, fadeEnd)
    tint.addColorStop(0, 'rgba(54, 105, 187, 0)')
    tint.addColorStop(0.55, 'rgba(54, 105, 187, 0.08)')
    tint.addColorStop(1, 'rgba(54, 105, 187, 0.20)')
    layerCtx.fillStyle = tint
    layerCtx.fillRect(0, tintStart, ART_SIZE, fadeEnd - tintStart)
  }

  layerCtx.globalCompositeOperation = 'destination-in'
  // The wider lower shirt blends out before reaching the text or poster edge.
  const sideFade = layerCtx.createLinearGradient(798, 0, POSTER_PORTRAIT_LEFT, 0)
  addPortraitFeather(sideFade, true)
  layerCtx.fillStyle = sideFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)

  const rightFade = layerCtx.createLinearGradient(POSTER_PORTRAIT_RIGHT, 0, ART_SIZE, 0)
  addPortraitFeather(rightFade, false)
  layerCtx.fillStyle = rightFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)

  const lowerFade = layerCtx.createLinearGradient(0, fadeStart, 0, fadeEnd)
  addPortraitFeather(lowerFade, false)
  layerCtx.fillStyle = lowerFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)
  // Follow the diagonal of the lower-right trim as the shirt meets the sea.
  const cornerFade = layerCtx.createLinearGradient(1060, 1060, 1118, 1118)
  addPortraitFeather(cornerFade, false)
  layerCtx.fillStyle = cornerFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)
  layerCtx.globalCompositeOperation = 'source-over'
  ctx.drawImage(layer, 0, 0)
}

function drawPosterDividers(ctx: CanvasRenderingContext2D) {
  const rules = [
    { left: 87, right: 754, y: 610, ornament: 403, hollow: true },
    { left: 143, right: 802, y: 813, ornament: 465, hollow: false },
    { left: 142, right: 719, y: 956 },
  ]
  for (const rule of rules) {
    const gold = ctx.createLinearGradient(rule.left, 0, rule.right, 0)
    gold.addColorStop(0, 'rgba(188, 126, 20, 0)')
    gold.addColorStop(0.25, '#c58722')
    gold.addColorStop(0.53, '#f9d974')
    gold.addColorStop(0.76, '#c58722')
    gold.addColorStop(1, 'rgba(188, 126, 20, 0)')
    ctx.fillStyle = gold
    ctx.fillRect(rule.left, rule.y - 1, rule.right - rule.left, 3)
    if (rule.ornament === undefined) continue

    const x = rule.ornament
    ctx.beginPath()
    ctx.moveTo(x - 13, rule.y)
    ctx.lineTo(x, rule.y + 13)
    ctx.lineTo(x + 13, rule.y)
    ctx.lineTo(x, rule.y - 13)
    ctx.closePath()
    ctx.fillStyle = rule.hollow ? '#fff1ba' : '#d39527'
    ctx.fill()
    ctx.strokeStyle = '#fff4c8'
    ctx.lineWidth = 3
    ctx.stroke()
  }
}

function drawFooter(ctx: CanvasRenderingContext2D) {
  const top = 1166
  const centerY = 1210
  ctx.fillStyle = '#071d3d'
  ctx.fillRect(0, top, ART_SIZE, ART_SIZE - top)
  const divider = ctx.createLinearGradient(0, top - 5, 0, top)
  divider.addColorStop(0, '#fff1ba')
  divider.addColorStop(0.5, '#e8ae36')
  divider.addColorStop(1, '#a96c10')
  ctx.fillStyle = divider
  ctx.fillRect(0, top - 5, ART_SIZE, 5)

  ctx.beginPath()
  ctx.arc(135, centerY, 27, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.fillStyle = '#071d3d'
  ctx.textAlign = 'center'
  ctx.font = 'bold 46px Arial, sans-serif'
  ctx.fillText('f', 135, centerY + 19)

  const globeX = 711
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 2.7
  ctx.beginPath()
  ctx.arc(globeX, centerY, 25, 0, Math.PI * 2)
  ctx.stroke()
  ctx.beginPath()
  ctx.ellipse(globeX, centerY, 11, 25, 0, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = '#fff'
  ctx.fillRect(globeX - 21, centerY - 8, 42, 16)
  ctx.fillStyle = '#071d3d'
  ctx.font = 'bold 11px Arial, sans-serif'
  ctx.fillText('WWW', globeX, centerY + 4)

  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.font = 'bold 33px Arial, sans-serif'
  ctx.fillText('@HyperionMaritime', 180, centerY + 11)
  ctx.fillText('HyperionMaritime.org', 751, centerY + 11)
}

export function renderPoster(canvas: HTMLCanvasElement, artwork: PosterArtwork, data: PosterContent) {
  canvas.width = POSTER_EXPORT_SIZE
  canvas.height = POSTER_EXPORT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.setTransform(POSTER_EXPORT_SIZE / ART_SIZE, 0, 0, POSTER_EXPORT_SIZE / ART_SIZE, 0, 0)
  ctx.drawImage(artwork.background, 0, 0, ART_SIZE, ART_SIZE)
  drawPosterDividers(ctx)
  if (data.portrait) drawPortrait(ctx, data.portrait, data)

  const name = fullPosterName(data.track.id, data.name).toUpperCase()
  drawFittedText(ctx, name, { ...POSTER_TEXT_LAYOUT.name, family: 'Georgia, serif', color: '#ffffff', weight: 'bold' })
  drawFittedText(ctx, data.track.defaultDegree, { ...POSTER_TEXT_LAYOUT.degree, family: 'Georgia, serif', color: '#f6ca68', weight: 'bold', italic: true })
  const date = formatPosterDate(data.date)
  if (date) drawFittedText(ctx, `for passing the ${date}`, { ...POSTER_TEXT_LAYOUT.date, family: 'Georgia, serif', color: '#071c42', weight: 'bold', italic: true })
  drawFittedText(ctx, data.track.examTitle, { ...POSTER_TEXT_LAYOUT.exam, family: 'Impact, "Arial Narrow", "Nimbus Sans Narrow", sans-serif', color: '#071d43', weight: 'bold' })
  drawFittedText(ctx, data.school.toUpperCase(), { ...POSTER_TEXT_LAYOUT.school, family: 'Georgia, serif', color: '#082143', weight: 'bold', italic: true })
  drawFittedText(ctx, data.company.toUpperCase(), { ...POSTER_TEXT_LAYOUT.company, family: 'Georgia, serif', color: '#082143', italic: true })

  const closingWidth = 850
  const closingHeight = closingWidth * artwork.closingMessage.naturalHeight / artwork.closingMessage.naturalWidth
  ctx.drawImage(artwork.closingMessage, 96, 975, closingWidth, closingHeight)
  drawFooter(ctx)
}

export function downloadPoster(canvas: HTMLCanvasElement, name: string) {
  const safeName = name.trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'candidate'
  canvas.toBlob(blob => {
    if (!blob) return
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = url
    link.download = `Hyperion-Congratulations-${safeName}.png`
    link.click()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
  }, 'image/png')
}
