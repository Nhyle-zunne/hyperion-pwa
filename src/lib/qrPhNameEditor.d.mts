export function crc16Qr(text: string): string
export function parseQrPhPayload(payload: string): { recipientName: string; country: string; currency: 'PHP' }
export function replaceQrPhRecipientName(payload: string, name: string): string
