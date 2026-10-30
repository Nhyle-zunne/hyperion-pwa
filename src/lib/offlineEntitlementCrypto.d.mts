export interface OfflineEntitlementClaims {
  v: 1;
  userId: string;
  issuedAt: number;
  tracks: Record<string, number>;
}

export const MAX_OFFLINE_ENTITLEMENT_AGE_MS: number;
export const OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS: number;
export const OFFLINE_CLOCK_PERSIST_INTERVAL_MS: number;

export function effectiveOfflineEntitlementNow(now: number, lastVerifiedAt: number): number | null;

export const OFFLINE_ENTITLEMENT_PUBLIC_KEY: JsonWebKey;

export function verifyOfflineEntitlementToken(
  token: string,
  expectedUserId: string,
  now?: number,
  publicJwk?: JsonWebKey
): Promise<OfflineEntitlementClaims | null>;
