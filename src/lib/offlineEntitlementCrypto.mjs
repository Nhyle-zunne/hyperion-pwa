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

// The signed grant stays valid until each track's server-issued subscription expiry.
// Revocations and refunds are refreshed when the device reconnects; offline access
// must not expire merely because the user has been disconnected for several days.
export const OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS = 5 * 60 * 1000;
export const OFFLINE_CLOCK_PERSIST_INTERVAL_MS = 60 * 1000;

/**
 * Uses a persisted wall-clock high-water mark so ordinary device-clock rollback
 * cannot extend a signed offline lease. This is best-effort client protection;
 * the server remains authoritative whenever a connection is available.
 */
export function effectiveOfflineEntitlementNow(now, lastVerifiedAt) {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(lastVerifiedAt) ||
    lastVerifiedAt <= 0 ||
    now < lastVerifiedAt - OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS
  ) return null;
  return Math.max(now, lastVerifiedAt);
}

// performance.now() is monotonic within this browser session and is unaffected by
// manual wall-clock changes. The saved wall-clock high-water mark remains the
// restart/reboot boundary; when a page starts with a clock behind that mark, fail
// closed until the device clock is corrected rather than silently extending a plan.
let monotonicOfflineClockAnchor = null;

function readMonotonicClockNow() {
  return typeof globalThis.performance?.now === 'function'
    ? globalThis.performance.now()
    : Date.now();
}

export function resetMonotonicOfflineEntitlementClock() {
  monotonicOfflineClockAnchor = null;
}

export function anchorMonotonicOfflineEntitlementClock(
  trustedEpochMs,
  monotonicNow = readMonotonicClockNow(),
  fromServer = false
) {
  if (!Number.isFinite(trustedEpochMs) || trustedEpochMs <= 0 || !Number.isFinite(monotonicNow)) {
    monotonicOfflineClockAnchor = null;
    return;
  }
  // Only a *fresh, ECDSA-verified* server grant can override a skewed device
  // clock. Cold offline restores retain the old fail-closed clock rules.
  monotonicOfflineClockAnchor = { trustedEpochMs, monotonicNow, fromServer: fromServer === true };
}

export function effectiveOfflineEntitlementNowMonotonic(
  now,
  lastVerifiedAt,
  monotonicNow = readMonotonicClockNow()
) {
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(lastVerifiedAt) ||
    lastVerifiedAt <= 0 ||
    !Number.isFinite(monotonicNow)
  ) return null;

  if (!monotonicOfflineClockAnchor) {
    const initial = effectiveOfflineEntitlementNow(now, lastVerifiedAt);
    if (initial === null) return null;
    anchorMonotonicOfflineEntitlementClock(initial, monotonicNow);
    return initial;
  }

  const elapsed = Math.max(0, monotonicNow - monotonicOfflineClockAnchor.monotonicNow);
  const monotonicEpoch = monotonicOfflineClockAnchor.trustedEpochMs + elapsed;
  // A fresh, verified server clock is authoritative for this live browser
  // session. Phone clocks can be set hours ahead or behind; neither should
  // revoke a paid grant. Monotonic elapsed time still enforces expiry.
  if (monotonicOfflineClockAnchor.fromServer) return Math.max(lastVerifiedAt, monotonicEpoch);
  // Offline-only restores still honor forward clock adjustments and fail
  // closed on a rollback, without granting extra time from untrusted input.
  return Math.max(now, lastVerifiedAt, monotonicEpoch);
}

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
      (claims.admin !== undefined && typeof claims.admin !== 'boolean') ||
      !claims.tracks ||
      typeof claims.tracks !== 'object' ||
      Array.isArray(claims.tracks) ||
      (claims.admin === true && Object.keys(claims.tracks).length !== 0)
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
      admin: claims.admin === true,
      tracks: verifiedTracks
    };
  } catch {
    return null;
  }
}
