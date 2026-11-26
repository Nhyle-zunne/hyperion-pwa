import { applyPortraitAlpha } from './posterAlpha.mjs'

const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite'
const WASM_URL = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@1.2.3/wasm'
let segmenterPromise: ReturnType<typeof createSegmenter> | null = null

async function createSegmenter() {
  const { FilesetResolver, ImageSegmenter } = await import('@mediapipe/tasks-vision')
  const wasm = await FilesetResolver.forVisionTasks(WASM_URL)
  return ImageSegmenter.createFromOptions(wasm, {
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

export async function removePortraitBackground(file: File): Promise<Blob> {
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
      const foreground = result.confidenceMasks?.[1]
      if (!foreground) throw new Error('No person was detected in the portrait.')
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height)
      const mask = foreground.getAsFloat32Array()
      const cutout = applyPortraitAlpha(pixels, mask, foreground.width, foreground.height)
      context.putImageData(new ImageData(cutout.data, cutout.width, cutout.height), 0, 0)
      return await canvasBlob(canvas)
    } finally {
      result?.confidenceMasks?.forEach(mask => mask.close())
      result?.categoryMask?.close()
    }
  } finally {
    image.close()
  }
}
