import { applyPortraitAlpha, findPortraitFrame } from './posterAlpha.mjs'

import wasmLoaderPath from '@mediapipe/tasks-vision/vision_wasm_internal.js?url'
import wasmBinaryPath from '@mediapipe/tasks-vision/vision_wasm_internal.wasm?url'

// MediaPipe Selfie Segmenter, float16 v1, from the Google AI Edge Image Segmenter model catalog.
const MODEL_URL = '/posters/selfie-segmenter-v1.tflite'
const PORTRAIT_CACHE = 'hyperion-poster-assets-v1'

export async function preparePortraitAssets(online: boolean) {
  if (!('caches' in window) || !('serviceWorker' in navigator)) return false
  const cache = await caches.open(PORTRAIT_CACHE)
  const assets = [MODEL_URL, wasmLoaderPath, wasmBinaryPath]
  const missing = (await Promise.all(assets.map(async url => await cache.match(url) ? null : url)))
    .filter((url): url is string => url !== null)
  if (missing.length && !online) return false
  if (missing.length) await cache.addAll(missing)
  await navigator.serviceWorker.ready
  return true
}

let segmenterPromise: ReturnType<typeof createSegmenter> | null = null

async function createSegmenter() {
  const { ImageSegmenter } = await import('@mediapipe/tasks-vision')
  return ImageSegmenter.createFromOptions({ wasmLoaderPath, wasmBinaryPath }, {
    baseOptions: { modelAssetPath: MODEL_URL, delegate: 'CPU' },
    runningMode: 'IMAGE',
    outputCategoryMask: false,
    outputConfidenceMasks: true,
  })
}

function getSegmenter() {
  if (!segmenterPromise) segmenterPromise = createSegmenter().catch(error => {
    segmenterPromise = null
    throw error
  })
  return segmenterPromise
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Cannot encode the portrait.')), 'image/png')
  })
}

export async function removePortraitBackground(file: File) {
  if (!file.type.startsWith('image/')) throw new Error('Choose a JPEG, PNG or WebP portrait.')
  const image = await createImageBitmap(file)
  try {
    const canvas = document.createElement('canvas')
    const maxSide = 1600
    const ratio = Math.min(1, maxSide / Math.max(image.width, image.height))
    canvas.width = Math.max(1, Math.round(image.width * ratio))
    canvas.height = Math.max(1, Math.round(image.height * ratio))
    const context = canvas.getContext('2d', { willReadFrequently: true })
    if (!context) throw new Error('This browser cannot process the portrait.')
    context.drawImage(image, 0, 0, canvas.width, canvas.height)

    let result
    try {
      const segmenter = await getSegmenter()
      result = segmenter.segment(canvas)
      // The selfie model exposes one confidence mask labeled “selfie”.
      const foreground = result.confidenceMasks?.[0]
      if (!foreground) throw new Error('No person was detected in the portrait.')
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const mask = foreground.getAsFloat32Array()
      const cutout = applyPortraitAlpha(pixels, mask, foreground.width, foreground.height)
      const frame = findPortraitFrame(cutout)
      if (!frame) throw new Error('No person was detected in the portrait.')
      context.putImageData(new ImageData(cutout.data, cutout.width, cutout.height), 0, 0)
      return { blob: await canvasBlob(canvas), frame }
    } finally {
      result?.confidenceMasks?.forEach(mask => mask.close())
      result?.categoryMask?.close()
    }
  } finally {
    image.close()
  }
}
