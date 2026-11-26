export function applyPortraitAlpha(
  image: { width: number; height: number; data: Uint8ClampedArray },
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number,
): { width: number; height: number; data: Uint8ClampedArray }

export type PortraitFrame = { top: number; bottom: number; headCenter: number; headWidth: number }

export function findPortraitFrame(image: { width: number; height: number; data: Uint8ClampedArray }): PortraitFrame | null
