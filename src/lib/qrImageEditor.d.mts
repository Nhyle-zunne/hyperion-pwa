export function decodeQrPixels(imageData: ImageData): string
export function decodeQrResult(result: { data: string; binaryData: number[] }): string
export function renderQrPng(payload: string): Promise<string>
