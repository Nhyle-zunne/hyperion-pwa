/**
 * Decrypts question files stored as "<name>.csv.enc".
 * File layout: 12-byte nonce, then AES-256-GCM ciphertext with its 16-byte tag.
 * Port of AssetCrypto.kt
 */
const a = [186, 37, 40, 56, 208, 70, 77, 77, 49, 140, 108, 238, 27, 237, 38, 131];
const b = [54, 195, 118, 105, 37, 110, 229, 154, 71, 100, 190, 64, 176, 245, 192, 212];

function deriveKeyBytes(): Uint8Array {
  const all = [...a, ...b];
  const result = new Uint8Array(all.length);
  for (let i = 0; i < all.length; i++) {
    const m = ((i * 37 + 11) ^ (i << 3)) & 0xff;
    result[i] = (all[i] ^ m ^ 0x5a) & 0xff;
  }
  return result;
}

let cachedKey: CryptoKey | null = null;

async function getKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  cachedKey = await crypto.subtle.importKey('raw', deriveKeyBytes(), { name: 'AES-GCM' }, false, ['decrypt']);
  return cachedKey;
}

export async function decrypt(encrypted: ArrayBuffer | Uint8Array): Promise<Uint8Array> {
  const data = encrypted instanceof Uint8Array ? encrypted : new Uint8Array(encrypted);
  if (data.length < 28) throw new Error('Encrypted data too short');
  const nonce = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const key = await getKey();
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce, tagLength: 128 }, key, ciphertext);
  return new Uint8Array(decrypted);
}

export async function decryptToText(encrypted: ArrayBuffer | Uint8Array): Promise<string> {
  const bytes = await decrypt(encrypted);
  try {
    // Most question files are UTF-8. fatal mode avoids silently corrupting legacy punctuation.
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    // Some valid encrypted GMDSS exports were saved as Windows-1252.
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
