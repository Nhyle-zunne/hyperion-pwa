/**
 * Verifies HYPE2 signed keys (ECDSA P-256).
 * Matches Hyperion Key Tool: payload 13 bytes + IEEE P1363 signature 64 bytes = 77,
 * encoded as HYPE2- + base32 (groups of 8).
 */

const PUBLIC_KEY_B64 =
  'BLQK/KdMlP/WSh7NMOOnXPPC7/eJzTU9x4fzIb0ha6M8jgSFBkCWg8G88fYDqSfv0+tgSmuVD9Kzk2fqxIMNLiA=';

const PREFIX = 'HYPE2-';
const DAY_MS = 86_400_000;
/** Days from Unix epoch (1970-01-01) to 2020-01-01 — same as key tool EPOCH */
const EPOCH_2020_DAYS = 18262;

const PLANS = ['', 'ALL', 'OIC', 'GOC', 'EW', 'DM', 'EM'];
const DURATIONS = ['', '1W', '1M', '1Y', 'EXP'];

export interface SignedKey {
  tier: string;
  duration: string;
  issueEpoch: number;
  expiryEpoch: number;
  deviceHex: string;
}

export type VerifyFailReason =
  | 'format'
  | 'decode'
  | 'signature'
  | 'version'
  | 'plan'
  | 'dates'
  | 'device'
  | 'error';

export interface VerifyResult {
  ok: true;
  key: SignedKey;
}

export interface VerifyFail {
  ok: false;
  reason: VerifyFailReason;
  detail?: string;
}

function decodeBase32(text: string): Uint8Array | null {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const out: number[] = [];
  let buffer = 0;
  let bits = 0;
  for (const c of text) {
    if (c === '=') continue;
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

/** IEEE P1363 (r‖s) → DER, for older runtimes that only accept DER. */
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
  // Uncompressed EC point must start with 0x04
  if (point.length !== 65 || point[0] !== 0x04) {
    throw new Error('Invalid public key point');
  }
  const spkiHeader = new Uint8Array([
    0x30, 0x59, 0x30, 0x13, 0x06, 0x07, 0x2a, 0x86, 0x48, 0xce, 0x3d, 0x02, 0x01, 0x06, 0x08, 0x2a,
    0x86, 0x48, 0xce, 0x3d, 0x03, 0x01, 0x07, 0x03, 0x42, 0x00
  ]);
  const spki = new Uint8Array(spkiHeader.length + point.length);
  spki.set(spkiHeader, 0);
  spki.set(point, spkiHeader.length);

  return crypto.subtle.importKey('spki', spki, { name: 'ECDSA', namedCurve: 'P-256' }, false, [
    'verify'
  ]);
}

/**
 * Key tool uses crypto.subtle.sign → IEEE P1363 (64-byte r‖s).
 * Spec-compliant browsers verify with P1363; some older ones want DER.
 * Try both.
 */
async function signatureIsValid(payload: Uint8Array, rawSignature: Uint8Array): Promise<boolean> {
  if (rawSignature.length !== 64) return false;
  try {
    const key = await importPublicKey();
    const algo: EcdsaParams = { name: 'ECDSA', hash: 'SHA-256' };

    // Primary: IEEE P1363 (what the Hyperion Key Tool produces)
    try {
      if (await crypto.subtle.verify(algo, key, rawSignature, payload)) return true;
    } catch {
      /* try DER */
    }

    // Fallback: DER
    try {
      const derSig = rawToDer(rawSignature);
      if (await crypto.subtle.verify(algo, key, derSig, payload)) return true;
    } catch {
      /* fail */
    }

    return false;
  } catch {
    return false;
  }
}

export function isSignedFormat(cleanInput: string): boolean {
  return cleanInput.toUpperCase().replace(/\s+/g, '').startsWith(PREFIX);
}

/** Normalize pasted key: uppercase, strip spaces/newlines, keep HYPE2- and base32. */
export function normalizeKey(raw: string): string {
  return raw
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '')
    .replace(/[^A-Z0-9-]/g, '');
}

/**
 * Full verify with reason codes (for clearer UI errors).
 */
export async function verifyDetailed(
  rawInput: string,
  deviceToken: string
): Promise<VerifyResult | VerifyFail> {
  try {
    const clean = normalizeKey(rawInput);
    if (!clean.startsWith(PREFIX)) return { ok: false, reason: 'format' };

    const base32 = clean.slice(PREFIX.length).replace(/-/g, '');
    if (base32.length < 120) {
      return { ok: false, reason: 'decode', detail: `key too short (${base32.length} chars)` };
    }

    const bytes = decodeBase32(base32);
    // Accept 77 exact; some encoders may emit an extra partial byte → take first 77
    if (!bytes || bytes.length < 77) {
      return {
        ok: false,
        reason: 'decode',
        detail: `decoded ${bytes?.length ?? 0} bytes, need 77`
      };
    }
    const frame = bytes.length === 77 ? bytes : bytes.slice(0, 77);

    const payload = frame.slice(0, 13);
    const signature = frame.slice(13, 77);

    if (!(await signatureIsValid(payload, signature))) {
      return { ok: false, reason: 'signature' };
    }
    if (payload[0] !== 2) return { ok: false, reason: 'version' };

    const plan = payload[1] & 0xff;
    const duration = payload[2] & 0xff;
    if (plan < 1 || plan > 6 || duration < 1 || duration > 4) {
      return { ok: false, reason: 'plan' };
    }

    const issueDay = ((payload[3] & 0xff) << 8) | (payload[4] & 0xff);
    const expiryDay = ((payload[5] & 0xff) << 8) | (payload[6] & 0xff);
    if (expiryDay <= issueDay) return { ok: false, reason: 'dates' };

    const deviceHex = Array.from(payload.slice(7, 13))
      .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
      .join('');
    const expected = deviceToken.trim().toUpperCase().replace(/[^0-9A-F]/g, '');
    if (deviceHex !== expected) {
      return {
        ok: false,
        reason: 'device',
        detail: `key device ${deviceHex} ≠ this device ${expected}`
      };
    }

    return {
      ok: true,
      key: {
        tier: PLANS[plan],
        duration: DURATIONS[duration],
        issueEpoch: (issueDay + EPOCH_2020_DAYS) * DAY_MS,
        expiryEpoch: (expiryDay + EPOCH_2020_DAYS + 1) * DAY_MS - 1,
        deviceHex
      }
    };
  } catch {
    return { ok: false, reason: 'error' };
  }
}

/**
 * Returns the key details if valid, otherwise null.
 */
export async function verify(cleanInput: string, deviceToken: string): Promise<SignedKey | null> {
  const r = await verifyDetailed(cleanInput, deviceToken);
  return r.ok ? r.key : null;
}
