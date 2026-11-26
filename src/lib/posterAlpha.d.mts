export function applyPortraitAlpha(
  image: { width: number; height: number; data: Uint8ClampedArray },
  mask: Float32Array,
  maskWidth: number,
  maskHeight: number,
): { width: number; height: number; data: Uint8ClampedArray }
