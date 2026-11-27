function readFields(payload) {
  const bytes = new TextEncoder().encode(payload)
  const decode = value => new TextDecoder('utf-8', { fatal: true }).decode(value)
  const fields = []
  for (let offset = 0; offset < bytes.length;) {
    const start = offset
    const header = decode(bytes.subarray(offset, offset + 4))
    if (!/^\d{4}$/.test(header)) throw new Error('Invalid QR Ph payment data.')
    const length = Number(header.slice(2))
    offset += 4 + length
    if (offset > bytes.length) throw new Error('Invalid QR Ph field length.')
    const tag = header.slice(0, 2)
    if (fields.some(field => field.tag === tag)) throw new Error('Duplicate QR Ph payment field.')
    fields.push({ tag, value: decode(bytes.subarray(start + 4, offset)), raw: decode(bytes.subarray(start, offset)) })
  }
  return fields
}

export function crc16Qr(text) {
  let checksum = 0xffff
  for (const byte of new TextEncoder().encode(text)) {
    checksum ^= byte << 8
    for (let bit = 0; bit < 8; bit++) {
      checksum = checksum & 0x8000 ? (checksum << 1) ^ 0x1021 : checksum << 1
      checksum &= 0xffff
    }
  }
  return checksum.toString(16).toUpperCase().padStart(4, '0')
}

function inspect(payload) {
  if (typeof payload !== 'string') throw new Error('Only text-based QR Ph payment codes are supported.')
  const fields = readFields(payload)
  const field = tag => fields.find(item => item.tag === tag)
  const checksum = fields.at(-1)
  const templates = fields.filter(item => Number(item.tag) >= 26 && Number(item.tag) <= 51)
  let supportedAccount = false
  if (templates.length === 1) {
    try {
      const account = readFields(templates[0].value)
      supportedAccount = account.some(item => item.tag === '00' && item.value === 'com.p2pqrpay') &&
        account.some(item => item.tag === '04' && item.value.length >= 4)
    } catch { /* Unsupported or malformed account template. */ }
  }
  if (field('00')?.value !== '01' || field('53')?.value !== '608' || field('58')?.value !== 'PH' ||
    !supportedAccount || !field('59')?.value || checksum?.tag !== '63' || checksum.value.length !== 4) {
    throw new Error('This is not a supported Philippine QR Ph payment code.')
  }
  if (crc16Qr(payload.slice(0, -4)) !== checksum.value.toUpperCase()) {
    throw new Error('The QR Ph checksum is invalid. Upload an original, unmodified QR image.')
  }
  return { fields, nameField: field('59') }
}

export function parseQrPhPayload(payload) {
  const { fields, nameField } = inspect(payload)
  const field = tag => fields.find(item => item.tag === tag)?.value
  return { recipientName: nameField.value, country: field('58'), currency: 'PHP' }
}

export function replaceQrPhRecipientName(payload, name) {
  const { fields, nameField } = inspect(payload)
  const newName = name.trim()
  if (!newName) throw new Error('Enter a recipient name.')
  if (newName.length > 25) throw new Error('The recipient name must be 25 characters or fewer.')
  if (!/^[\x20-\x7E]+$/.test(newName)) {
    throw new Error('Use English letters, numbers and standard punctuation characters.')
  }
  if (newName === nameField.value) return payload
  const body = fields.map(field => field.tag === '59' ? `59${String(newName.length).padStart(2, '0')}${newName}`
    : field.tag === '63' ? '6304' : field.raw).join('')
  return body + crc16Qr(body)
}
