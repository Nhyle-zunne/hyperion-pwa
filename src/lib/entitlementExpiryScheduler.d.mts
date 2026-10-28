export const MAX_EXPIRY_REFRESH_TIMEOUT_MS: number;

export function nextExpiryRefreshDelay(
  expiryValues: unknown[],
  now?: number,
  maxDelay?: number
): number | null;
