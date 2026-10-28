export interface EncryptedPayload {
  iv: Uint8Array
  ciphertext: Uint8Array
}

const encoder = new TextEncoder()
const decoder = new TextDecoder('utf-8', { fatal: true })

export async function encryptSessionSnapshot<T>(
  value: T,
  key: CryptoKey,
  iv?: Uint8Array
): Promise<EncryptedPayload> {
  const nonce = iv ? new Uint8Array(iv) : crypto.getRandomValues(new Uint8Array(12))
  if (nonce.byteLength !== 12) throw new Error('AES-GCM requires a 12-byte nonce.')
  const plaintext = encoder.encode(JSON.stringify(value))
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, plaintext)
  return { iv: nonce, ciphertext: new Uint8Array(encrypted) }
}

export async function decryptSessionSnapshot<T>(
  iv: Uint8Array,
  ciphertext: Uint8Array,
  key: CryptoKey
): Promise<T> {
  if (!(iv instanceof Uint8Array) || iv.byteLength !== 12 || !(ciphertext instanceof Uint8Array) || ciphertext.byteLength < 16) {
    throw new Error('Invalid encrypted session snapshot.')
  }
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv, tagLength: 128 }, key, ciphertext)
  return JSON.parse(decoder.decode(plaintext)) as T
}
