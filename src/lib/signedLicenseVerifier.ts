/**
 * Verifies HYPE2 signed keys (ECDSA P-256).
 * Port of SignedLicenseVerifier.kt – public key only, keys cannot be generated from the app.
 */

const PUBLIC_KEY_B64 =
  'BLQK/KdMlP/WSh7NMOOnXPPC7/eJzTU9x4fzIb0ha6M8jgSFBkCWg8G88fYDqSfv0+tgSmuVD9Kzk2fqxIMNLiA=';

const PREFIX = 'HYPE2-';
const DAY_MS = 86_400_000;
const EPOCH_2020_DAYS = 18262; // days from 1970-01-01 to 2020-01-01

const PLANS = ['', 'ALL', 'OIC', 'GOC', 'EW', 'DM', 'EM'];
const DURATIONS = ['', '1W', '1M', '1Y', 'EXP'];

export interface SignedKey {
  tier: string;
  duration: string;
  issueEpoch: number;
  expiryEpoch: number;
}

function decodeBase32(text: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    const v = alphabet.indexOf(c);
    if (v < 0) return null;
    buffer = (buffer << 5) | v;
    bits += 5;
    if (bits >= 8) {
      out.push((buffer >> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return new Uint8Array(out);
}

function rawToDer(raw: Uint8Array): Uint8Array {
  const r = raw.slice(0, 32);
  const s = raw.slice(32, 64);

  function toMinimal(bytes: Uint8Array): Uint8Array {
    let i = 0;
    while (i < bytes.length - 1 && bytes[i] === 0) i++;
    if (bytes[i] & 0x80) {
      const result = new Uint8Array(bytes.length - i + 1);
      result[0] = 0;
      result.set(bytes.slice(i), 1);
      return result;
    }
    return bytes.slice(i);
  }

  const rMin = toMinimal(r);
  const sMin = toMinimal(s);

  const bodyLen = 2 + rMin.length + 2 + sMin.length;
  const der = new Uint8Array(2 + bodyLen);
  let offset = 0;
  der[offset++] = 0x30;
  der[offset++] = bodyLen;
  der[offset++] = 0x02;
  der[offset++] = rMin.length;
  der.set(rMin, offset);
  offset += rMin.length;
  der[offset++] = 0x02;
  der[offset++] = sMin.length;
  der.set(sMin, offset);
  return der;
}

async function importPublicKey(): Promise<CryptoKey> {
  const point = Uint8Array.from(atob(PUBLIC_KEY_B64), (c) => c.charCodeAt(0));
  const spkiHeader = new Uint8Array([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d,
    0x02, 0x01, 0x06, 0x08, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x03, 0x01,
    0x07, 0x03, 0x42, 0x00
  ]);
  const spki = new Uint8Array(spkiHeader.length + point.length);
  spki.set(spkiHeader, 0);
  spki.set(point, spkiHeader.length);

  return crypto.subtle.importKey(
    'spki',
    spki,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

async function signatureIsValid(payload: Uint8Array, rawSignature: Uint8Array): Promise<boolean> {
  try {
    const key = await importPublicKey();
    const derSig = rawToDer(rawSignature);
    return await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      key,
      derSig,
      payload
    );
  } catch {
    return false;
  }
}

export function isSignedFormat(cleanInput: string): boolean {
  return cleanInput.startsWith(PREFIX);
}

/**
 * Returns the key details if the signature, format and device all match, otherwise null.
 * Input must already be trimmed and uppercased.
 */
export async function verify(cleanInput: string, deviceToken: string): Promise<SignedKey | null> {
  try {
    if (!isSignedFormat(cleanInput)) return null;
    const base32 = cleanInput.slice(PREFIX.length).replace(/-/g, '');
    const bytes = decodeBase32(base32);
    if (!bytes || bytes.length !== 77) return null;

    const payload = bytes.slice(0, 13);
    const signature = bytes.slice(13, 77);

    if (!(await signatureIsValid(payload, signature))) return null;
    if (payload[0] !== 2) return null;

    const plan = payload[1] & 0xff;
    const duration = payload[2] & 0xff;
    if (plan < 1 || plan > 6 || duration < 1 || duration > 4) return null;

    const issueDay = ((payload[3] & 0xff) << 8) | (payload[4] & 0xff);
    const expiryDay = ((payload[5] & 0xff) << 8) | (payload[6] & 0xff);
    if (expiryDay <= issueDay) return null;

    const deviceHex = Array.from(payload.slice(7, 13))
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
    if (deviceHex !== deviceToken.trim().toUpperCase()) return null;

    return {
      tier: PLANS[plan],
      duration: DURATIONS[duration],
      issueEpoch: (issueDay + EPOCH_2020_DAYS) * DAY_MS,
      expiryEpoch: (expiryDay + EPOCH_2020_DAYS + 1) * DAY_MS - 1
    };
  } catch {
    return null;
  }
}
