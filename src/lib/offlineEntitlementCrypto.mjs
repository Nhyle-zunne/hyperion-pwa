// Browser-safe verification of server-signed offline entitlement leases.
// The matching private key remains in Supabase and is never bundled with the PWA.
export const OFFLINE_ENTITLEMENT_PUBLIC_KEY = Object.freeze({
  kty: 'EC',
  crv: 'P-256',
  x: 'rRSoQJxUoGwX8-g5IwWOnDik-l_HYqJrN01fOg4vzOY',
  y: 'IEysYJ20UAhm1-CrPoqVTW0ODu5nfa4qBZT1nCM5ZjU',
  ext: true,
  key_ops: ['verify']
});

// A signed lease is intentionally short-lived. Live access is checked against Supabase;
// this 72-hour cap only protects the browser's offline/network-outage fallback after a
// revocation or refund, so an old but still-unexpired token cannot extend cached access.
export const MAX_OFFLINE_ENTITLEMENT_AGE_MS = 72 * 60 * 60 * 1000;

const OFFLINE_TRACK_IDS = new Set([
  'DECK_OIC_NW',
  'GMDSS_GOC',
  'ENGINE_OIC_EW',
  'DECK_MGT',
  'ENGINE_MGT'
]);

let defaultVerificationKey = null;

function decodeBase64Url(value) {
  if (!value || !/^[A-Za-z0-9_-]+$/.test(value)) throw new Error('Invalid base64url data.');
  const base64 = value.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, character => character.charCodeAt(0));
}

async function verificationKey(publicJwk) {
  if (publicJwk === OFFLINE_ENTITLEMENT_PUBLIC_KEY) {
    if (!defaultVerificationKey) {
      defaultVerificationKey = crypto.subtle.importKey(
        'jwk',
        OFFLINE_ENTITLEMENT_PUBLIC_KEY,
        { name: 'ECDSA', namedCurve: 'P-256' },
        false,
        ['verify']
      );
    }
    return defaultVerificationKey;
  }
  return crypto.subtle.importKey(
    'jwk',
    publicJwk,
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['verify']
  );
}

/**
 * Verifies a token whose first segment is base64url(JSON claims), and whose
 * second segment is the raw 64-byte ECDSA P-256 signature over that first segment.
 * The optional time and public-key arguments make the verifier testable with
 * ephemeral keys; production call sites use the pinned default key and system time.
 */
export async function verifyOfflineEntitlementToken(
  token,
  expectedUserId,
  now = Date.now(),
  publicJwk = OFFLINE_ENTITLEMENT_PUBLIC_KEY
) {
  try {
    if (
      typeof token !== 'string' ||
      !token ||
      token.length > 12000 ||
      typeof expectedUserId !== 'string' ||
      !expectedUserId ||
      !Number.isFinite(now)
    ) return null;

    const parts = token.split('.');
    if (parts.length !== 2) return null;

    const payloadBytes = decodeBase64Url(parts[0]);
    const signature = decodeBase64Url(parts[1]);
    if (payloadBytes.length > 8192 || signature.length !== 64) return null;

    const valid = await crypto.subtle.verify(
      { name: 'ECDSA', hash: 'SHA-256' },
      await verificationKey(publicJwk),
      signature,
      new TextEncoder().encode(parts[0])
    );
    if (!valid) return null;

    const claims = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(payloadBytes));
    if (
      claims?.v !== 1 ||
      claims.userId !== expectedUserId ||
      typeof claims.issuedAt !== 'number' ||
      !Number.isFinite(claims.issuedAt) ||
      claims.issuedAt <= 0 ||
      claims.issuedAt > now + 5 * 60 * 1000 ||
      now - claims.issuedAt > MAX_OFFLINE_ENTITLEMENT_AGE_MS ||
      !claims.tracks ||
      typeof claims.tracks !== 'object' ||
      Array.isArray(claims.tracks)
    ) return null;

    const verifiedTracks = {};
    for (const [track, rawExpiry] of Object.entries(claims.tracks)) {
      if (
        !OFFLINE_TRACK_IDS.has(track) ||
        typeof rawExpiry !== 'number' ||
        !Number.isFinite(rawExpiry) ||
        rawExpiry <= claims.issuedAt
      ) return null;
      verifiedTracks[track] = rawExpiry;
    }

    return {
      v: 1,
      userId: claims.userId,
      issuedAt: claims.issuedAt,
      tracks: verifiedTracks
    };
  } catch {
    return null;
  }
}
