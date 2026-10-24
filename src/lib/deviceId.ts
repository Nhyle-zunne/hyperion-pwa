/**
 * Device identity for offline signed keys.
 *
 * Binding (what the key is signed against): 12 uppercase hex chars (6 bytes).
 * Display (what the user copies when requesting a key):
 *   HYPE-XXXX-XXXX-XXXX (PHONE MODEL)
 *
 * Uniqueness: random token is generated once and stored in localStorage for this
 * browser profile. It is stable across visits on the same browser/device profile,
 * but clearing site data or using another browser creates a new code.
 * (Browsers cannot expose a hardware ID like Android ANDROID_ID / Build.MODEL.)
 */

const STORAGE_KEY = 'hyperion_device_token';

function generateToken(): string {
  const arr = new Uint8Array(6);
  crypto.getRandomValues(arr);
  return Array.from(arr)
    .map((b) => b.toString(16).padStart(2, '0').toUpperCase())
    .join('');
}

/** Raw 12-hex token used for HYPE2 key device binding. */
export function getDeviceToken(): string {
  try {
    let token = localStorage.getItem(STORAGE_KEY);
    if (!token || !/^[0-9A-F]{12}$/i.test(token)) {
      token = generateToken();
      localStorage.setItem(STORAGE_KEY, token);
    }
    return token.toUpperCase();
  } catch {
    return generateToken();
  }
}

/** HYPE-XXXX-XXXX-XXXX from the 12-hex token. */
export function formatDeviceCode(token?: string): string {
  const t = (token ?? getDeviceToken()).toUpperCase().replace(/[^0-9A-F]/g, '');
  const padded = (t + '000000000000').slice(0, 12);
  return `HYPE-${padded.slice(0, 4)}-${padded.slice(4, 8)}-${padded.slice(8, 12)}`;
}

/**
 * Best-effort device / browser label for the parenthetical part.
 * On the web we cannot read the real phone model the way Android can;
 * we approximate from UA Client Hints or userAgent.
 */
export function getDeviceModelLabel(): string {
  if (typeof navigator === 'undefined') return 'Web';

  const nav = navigator as Navigator & {
    userAgentData?: {
      mobile?: boolean;
      platform?: string;
      model?: string;
      getHighEntropyValues?: (hints: string[]) => Promise<Record<string, string>>;
    };
  };

  // Chromium UA-CH synchronous fields when present
  if (nav.userAgentData?.model && nav.userAgentData.model.trim()) {
    return sanitizeModel(nav.userAgentData.model);
  }

  const ua = navigator.userAgent || '';

  // iPhone / iPad
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';

  // Android – try model token after "; " before "Build"
  // e.g. ...; SM-S918B Build/UP1A...
  const androidModel = ua.match(/Android[^;]*;\s*([^;)]+?)\s*(?:Build|[)\/])/i);
  if (androidModel?.[1]) {
    const m = androidModel[1].replace(/wv$/i, '').trim();
    if (m && !/^Linux$/i.test(m) && !/Android/i.test(m)) return sanitizeModel(m);
  }

  // Desktop platforms
  if (/Mac OS X/i.test(ua)) return 'Mac';
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/CrOS/i.test(ua)) return 'Chromebook';
  if (/Linux/i.test(ua)) return 'Linux';

  if (nav.userAgentData?.platform) {
    return sanitizeModel(nav.userAgentData.platform);
  }

  return 'Web Browser';
}

function sanitizeModel(raw: string): string {
  return raw
    .replace(/[^\w\s.\-+]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 40) || 'Web';
}

/**
 * Full display code for users to copy when requesting a license:
 * HYPE-XXXX-XXXX-XXXX (PHONE MODEL)
 */
export function getDeviceCodeDisplay(): string {
  return `${formatDeviceCode()} (${getDeviceModelLabel()})`;
}

/** Optional async refinement of model via UA Client Hints (Chrome). */
export async function refreshDeviceModelLabel(): Promise<string> {
  try {
    const nav = navigator as Navigator & {
      userAgentData?: {
        getHighEntropyValues?: (hints: string[]) => Promise<{ model?: string; platform?: string }>;
      };
    };
    if (nav.userAgentData?.getHighEntropyValues) {
      const info = await nav.userAgentData.getHighEntropyValues(['model', 'platform']);
      if (info.model?.trim()) return sanitizeModel(info.model);
      if (info.platform?.trim()) return sanitizeModel(info.platform);
    }
  } catch {
    /* ignore */
  }
  return getDeviceModelLabel();
}
