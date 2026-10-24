/**
 * Generates / retrieves a stable 12-character hex device token
 * used for binding signed license keys.
 * In browser we use a UUID stored in localStorage (or generate one).
 */

const STORAGE_KEY = 'hyperion_device_token';

function generateToken(): string {
  // 6 random bytes → 12 hex chars
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

export function getDeviceToken(): string {
  try {
    let token = localStorage.getItem(STORAGE_KEY);
    if (!token || !/^[0-9A-F]{12}$/i.test(token)) {
      token = generateToken();
      localStorage.setItem(STORAGE_KEY, token);
    }
    return token.toUpperCase();
  } catch {
    // Fallback if localStorage blocked
    return generateToken();
  }
}
