import { fitPosterText } from './posterLayout.mjs'
import { formatPosterDate, fullPosterName } from './posterTracks.mjs'
import type { PosterTrack } from './posterTracks.mjs'

const ART_SIZE = 1254
export const POSTER_EXPORT_SIZE = 2048

export type PosterContent = {
  track: PosterTrack
  name: string
  degree: string
  date: string
  school: string
  company: string
  portrait: HTMLImageElement | null
  scale: number
  xOffset: number
  yOffset: number
}

export function loadPosterArtwork(): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('Could not load Hyperion artwork. Refresh the page.'))
    image.src = '/posters/hyperion-background.webp'
  })
}

function drawFittedText(ctx: CanvasRenderingContext2D, text: string, options: {
  x: number; baseline: number; maxWidth: number; fontSize: number; minSize: number
  maxLines?: number; lineHeight?: number; family: string; color: string; weight?: string; italic?: boolean
}) {
  if (!text.trim()) return
  const fontAt = (size: number) => `${options.italic ? 'italic ' : ''}${options.weight || 'normal'} ${size}px ${options.family}`
  const measureWidth = (value: string, size: number) => {
    ctx.font = fontAt(size)
    return ctx.measureText(value).width
  }
  const layout = fitPosterText(text.trim(), {
    maxWidth: options.maxWidth,
    preferredSize: options.fontSize,
    minSize: options.minSize,
    maxLines: options.maxLines || 1,
  }, measureWidth)
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
  const scale = Math.max(0.7, Math.min(1.4, data.scale))
  const width = 610 * scale
  const height = 860 * scale
  const x = 730 + data.xOffset - (width - 610) / 2
  const y = 235 + data.yOffset - (height - 860) / 2
  const targetRatio = width / height
  const sourceRatio = portrait.naturalWidth / portrait.naturalHeight
  const cropWidth = sourceRatio > targetRatio ? portrait.naturalHeight * targetRatio : portrait.naturalWidth
  const cropHeight = sourceRatio > targetRatio ? portrait.naturalHeight : portrait.naturalWidth / targetRatio
  const cropX = (portrait.naturalWidth - cropWidth) / 2
  const cropY = Math.max(0, (portrait.naturalHeight - cropHeight) * 0.15)

  // A soft left and lower edge lets the uniform meet the maritime artwork
  // naturally without a visible photo box or covering the closing message.
  const layer = document.createElement('canvas')
  layer.width = ART_SIZE
  layer.height = ART_SIZE
  const layerCtx = layer.getContext('2d')
  if (!layerCtx) return
  layerCtx.drawImage(portrait, cropX, cropY, cropWidth, cropHeight, x, y, width, height)

  layerCtx.globalCompositeOperation = 'destination-in'
  const sideFade = layerCtx.createLinearGradient(705, 0, 905, 0)
  sideFade.addColorStop(0, 'rgba(0, 0, 0, 0)')
  sideFade.addColorStop(1, 'rgba(0, 0, 0, 1)')
  layerCtx.fillStyle = sideFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)

  const lowerFade = layerCtx.createLinearGradient(0, 865, 0, 1030)
  lowerFade.addColorStop(0, 'rgba(0, 0, 0, 1)')
  lowerFade.addColorStop(1, 'rgba(0, 0, 0, 0)')
  layerCtx.fillStyle = lowerFade
  layerCtx.fillRect(0, 0, ART_SIZE, ART_SIZE)
  layerCtx.globalCompositeOperation = 'source-over'
  ctx.drawImage(layer, 0, 0)
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
  if (data.portrait) drawPortrait(ctx, data.portrait, data)

  const name = fullPosterName(data.track.id, data.name).toUpperCase()
  drawFittedText(ctx, name, { x: 412, baseline: 448, maxWidth: 728, fontSize: 54, minSize: 22, maxLines: 2, lineHeight: 42, family: 'Georgia, serif', color: '#ffffff', weight: 'bold' })
  drawFittedText(ctx, data.degree, { x: 408, baseline: 497, maxWidth: 720, fontSize: 28, minSize: 19, family: 'Georgia, serif', color: '#f6ca68', weight: 'bold', italic: true })
  drawFittedText(ctx, formatPosterDate(data.date), { x: 637, baseline: 663, maxWidth: 308, fontSize: 32, minSize: 19, family: 'Georgia, serif', color: '#071c42', weight: 'bold', italic: true })

  const examLines = data.track.examTitle.replace(/\n/g, ' ')
  drawFittedText(ctx, examLines, { x: 402, baseline: 789, maxWidth: 706, fontSize: 47, minSize: 28, maxLines: 2, lineHeight: 47, family: 'Impact, "Arial Narrow", sans-serif', color: '#071d43', weight: 'bold' })
  drawFittedText(ctx, data.school.toUpperCase(), { x: 480, baseline: data.company ? 929 : 952, maxWidth: 552, fontSize: 29, minSize: 18, maxLines: 2, lineHeight: 28, family: 'Georgia, serif', color: '#082143', weight: 'bold', italic: true })
  drawFittedText(ctx, data.company.toUpperCase(), { x: 480, baseline: 971, maxWidth: 552, fontSize: 20, minSize: 14, family: 'Georgia, serif', color: '#082143', italic: true })

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
