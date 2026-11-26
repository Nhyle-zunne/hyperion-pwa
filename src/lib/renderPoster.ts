import { fitPosterText, posterOffsetFromPercent, POSTER_TEXT_LAYOUT } from './posterLayout.mjs'
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

export function loadPosterArtwork(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load Hyperion artwork. Refresh the page.'))
    image.src = '/posters/hyperion-poster-artwork.webp'
  })
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
  if (frame) {
    const portraitScale = 236 / frame.headWidth * scale
    const left = 1000 + xOffset - frame.headCenter * portraitScale
    const top = 271 + yOffset - frame.top * portraitScale
    layerCtx.drawImage(portrait, left, top, portrait.naturalWidth * portraitScale, portrait.naturalHeight * portraitScale)
  } else {
    const baseWidth = 565
    const baseHeight = 840
    const width = baseWidth * scale
    const height = baseHeight * scale
    const x = 735 + xOffset - (width - baseWidth) / 2
    const y = 246 + yOffset - (height - baseHeight) / 2
    const targetRatio = width / height
    const cropWidth = Math.min(portrait.naturalWidth, portrait.naturalHeight * targetRatio)
    const cropHeight = Math.min(portrait.naturalHeight, portrait.naturalWidth / targetRatio)
    const cropX = (portrait.naturalWidth - cropWidth) / 2
    const cropY = (portrait.naturalHeight - cropHeight) * 0.15
    layerCtx.drawImage(portrait, cropX, cropY, cropWidth, cropHeight, x, y, width, height)
  }

  layerCtx.globalCompositeOperation = 'destination-in'
  const sideFade = layerCtx.createLinearGradient(720, 0, 875, 0)
  sideFade.addColorStop(0, 'rgba(0, 0, 0, 0)')
  sideFade.addColorStop(1, 'rgba(0, 0, 0, 1)')
  layerCtx.fillStyle = sideFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)

  const lowerFade = layerCtx.createLinearGradient(0, 875, 0, 1105)
  lowerFade.addColorStop(0, 'rgba(0, 0, 0, 1)')
  lowerFade.addColorStop(1, 'rgba(0, 0, 0, 0)')
  layerCtx.fillStyle = lowerFade
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
  ctx.fillStyle = '#071d3d'
  ctx.fillRect(0, 1166, ART_SIZE, 88)
  ctx.fillStyle = '#f3bc4a'
  ctx.fillRect(0, 1161, ART_SIZE, 5)

  // White Facebook badge and website globe, matching the supplied final sample.
  ctx.beginPath()
  ctx.arc(85, 1212, 24, 0, Math.PI * 2)
  ctx.fillStyle = '#fff'
  ctx.fill()
  ctx.fillStyle = '#071d3d'
  ctx.textAlign = 'center'
  ctx.font = 'bold 44px Arial, sans-serif'
  ctx.fillText('f', 85, 1230)

  ctx.fillStyle = '#fff'
  ctx.textAlign = 'left'
  ctx.font = 'bold 30px Arial, sans-serif'
  ctx.fillText('@HyperionMaritime', 123, 1224)

  const globeX = 710
  const globeY = 1212
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(globeX, globeY, 22, 0, Math.PI * 2)
  ctx.ellipse(globeX, globeY, 9, 22, 0, 0, Math.PI * 2)
  ctx.moveTo(globeX - 20, globeY)
  ctx.lineTo(globeX + 20, globeY)
  ctx.moveTo(globeX - 17, globeY - 11)
  ctx.lineTo(globeX + 17, globeY - 11)
  ctx.moveTo(globeX - 17, globeY + 11)
  ctx.lineTo(globeX + 17, globeY + 11)
  ctx.stroke()
  ctx.font = 'bold 30px Arial, sans-serif'
  ctx.fillText('HyperionMaritime.org', 749, 1224)
}

export function renderPoster(canvas: HTMLCanvasElement, artwork: HTMLImageElement, data: PosterContent) {
  canvas.width = POSTER_EXPORT_SIZE
  canvas.height = POSTER_EXPORT_SIZE
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('Canvas is unavailable in this browser.')
  ctx.setTransform(POSTER_EXPORT_SIZE / ART_SIZE, 0, 0, POSTER_EXPORT_SIZE / ART_SIZE, 0, 0)
  ctx.drawImage(artwork, 0, 0, ART_SIZE, ART_SIZE)
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
