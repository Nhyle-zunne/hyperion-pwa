export interface OfflineEntitlementClaims {
  v: 1;
  userId: string;
  issuedAt: number;
  tracks: Record<string, number>;
}

export const MAX_OFFLINE_ENTITLEMENT_AGE_MS: number;

export const OFFLINE_ENTITLEMENT_PUBLIC_KEY: JsonWebKey;

export function verifyOfflineEntitlementToken(
  token: string,
  expectedUserId: string,
  now?: number,
  publicJwk?: JsonWebKey
): Promise<OfflineEntitlementClaims | null>;
