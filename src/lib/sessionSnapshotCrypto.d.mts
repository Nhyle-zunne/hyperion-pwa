export interface EncryptedPayload {
  iv: Uint8Array
  ciphertext: Uint8Array
}

export function encryptSessionSnapshot<T>(value: T, key: CryptoKey, iv?: Uint8Array): Promise<EncryptedPayload>
export function decryptSessionSnapshot<T>(iv: Uint8Array, ciphertext: Uint8Array, key: CryptoKey): Promise<T>
