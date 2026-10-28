export interface EncryptedPayload {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export function encryptJsonPayload<T>(value: T, key: CryptoKey, iv?: Uint8Array): Promise<EncryptedPayload>
export function decryptJsonPayload<T>(iv: Uint8Array, ciphertext: Uint8Array, key: CryptoKey): Promise<T>
