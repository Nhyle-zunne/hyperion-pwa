export interface OfflineEntitlementClaims {
  v: 1;
  userId: string;
  issuedAt: number;
  admin: boolean;
  tracks: Record<string, number>;
}

export const OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS: number;
export const OFFLINE_CLOCK_PERSIST_INTERVAL_MS: number;

export function effectiveOfflineEntitlementNow(now: number, lastVerifiedAt: number): number | null;
export function resetMonotonicOfflineEntitlementClock(): void;
export function anchorMonotonicOfflineEntitlementClock(trustedEpochMs: number, monotonicNow?: number): void;
export function effectiveOfflineEntitlementNowMonotonic(now: number, lastVerifiedAt: number, monotonicNow?: number): number | null;

export const OFFLINE_ENTITLEMENT_PUBLIC_KEY: JsonWebKey;

export function verifyOfflineEntitlementToken(
  token: string,
  expectedUserId: string,
  now?: number,
  publicJwk?: JsonWebKey
): Promise<OfflineEntitlementClaims | null>;
