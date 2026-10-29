import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { clearOfflineEntitlements, getOfflineEntitledTracks, getOfflineEntitlementExpiry, saveOfflineEntitlements } from '../lib/offlineQuestionCache';
import { nextExpiryRefreshDelay } from '../lib/entitlementExpiryScheduler.mjs';

interface LicenseState {
  isOicNwUnlocked: boolean;
  isGmdssUnlocked: boolean;
  isEngineEwUnlocked: boolean;
  isDeckMgtUnlocked: boolean;
  isEngineMgtUnlocked: boolean;
  isAllAccessUnlocked: boolean;
  cloudTrackIds: string[];
  entitlementsVerified: boolean;
  entitlementExpiryRevision: number;
  checkLicenseStatus: () => void;
  isTrackUnlocked: (track: string) => boolean;
  getRemainingLabel: () => string;
  clearLicense: () => void;
  refreshCloudEntitlements: () => Promise<void>;
}

const TRACK_IDS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'] as const;

let entitlementExpiryTimer: ReturnType<typeof setTimeout> | null = null;

function clearEntitlementExpiryTimer() {
  if (entitlementExpiryTimer !== null) clearTimeout(entitlementExpiryTimer);
  entitlementExpiryTimer = null;
}

function scheduleEntitlementExpiryRefresh(
  userId: string,
  expiryValues: unknown[],
  onExpiry: (userId: string) => void
) {
  clearEntitlementExpiryTimer();
  const delay = nextExpiryRefreshDelay(expiryValues);
  if (delay === null) return;
  entitlementExpiryTimer = setTimeout(() => {
    entitlementExpiryTimer = null;
    onExpiry(userId);
  }, delay);
}

function isMissingGooglePlayEntitlementsTable(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  if (candidate.code !== 'PGRST205' || typeof candidate.message !== 'string') return false;
  const message = candidate.message.toLowerCase();
  return message.includes('google_play_entitlements') && message.includes('schema cache');
}

function canUseOfflineEntitlementsAfterError(error: unknown, responseStatus?: number): boolean {
  const candidate = error as {
    status?: unknown;
    statusCode?: unknown;
    context?: { status?: unknown };
    code?: unknown;
    message?: unknown;
    name?: unknown;
  } | null;
  const rawStatus = responseStatus ?? candidate?.status ?? candidate?.statusCode ?? candidate?.context?.status;
  if (rawStatus !== undefined && rawStatus !== null && rawStatus !== '') {
    const status = Number(rawStatus);
    if (Number.isFinite(status)) return status === 0 || status >= 500;
  }

  // PostgREST/database errors carry a code but may not expose their HTTP status on the
  // error object. Treat coded client/database errors as definitive before considering
  // the browser's offline flag, so an authorization error never grants cached access.
  if (typeof candidate?.code === 'string' && candidate.code.trim() !== '') return false;

  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;

  const message = typeof candidate?.message === 'string' ? candidate.message : String(error ?? '');
  return /failed to fetch|network error|network request failed|networkerror|load failed|timed out|timeout|connection reset|connection refused|enotfound|econn|enetunreach|eai_again|aborted/i.test(message);
}

function accessFlags(trackIds: string[]) {
  const all = trackIds.includes('ALL') || TRACK_IDS.every((id) => trackIds.includes(id));
  return {
    isOicNwUnlocked: all || trackIds.includes('DECK_OIC_NW'),
    isGmdssUnlocked: all || trackIds.includes('GMDSS_GOC'),
    isEngineEwUnlocked: all || trackIds.includes('ENGINE_OIC_EW'),
    isDeckMgtUnlocked: all || trackIds.includes('DECK_MGT'),
    isEngineMgtUnlocked: all || trackIds.includes('ENGINE_MGT'),
    isAllAccessUnlocked: all
  };
}

export const useLicenseStore = create<LicenseState>()((set, get) => {
  const armEntitlementExpiryRefresh = (userId: string, expiryValues: unknown[]) => {
    scheduleEntitlementExpiryRefresh(userId, expiryValues, (expectedUserId) => {
      void (async () => {
        if (!supabase) return;
        try {
          const current = await supabase.auth.getSession();
          if (current.data.session?.user.id !== expectedUserId) return;
          await get().refreshCloudEntitlements();
          const latest = await supabase.auth.getSession();
          if (latest.data.session?.user.id === expectedUserId) {
            set((state) => ({ entitlementExpiryRevision: state.entitlementExpiryRevision + 1 }));
          }
        } catch {
          // The next focus/visibility/online refresh retries if the browser was suspended or offline.
        }
      })();
    });
  };

  return ({
  isOicNwUnlocked: false,
  isGmdssUnlocked: false,
  isEngineEwUnlocked: false,
  isDeckMgtUnlocked: false,
  isEngineMgtUnlocked: false,
  isAllAccessUnlocked: false,
  cloudTrackIds: [],
  entitlementsVerified: false,
  entitlementExpiryRevision: 0,

  refreshCloudEntitlements: async () => {
    clearEntitlementExpiryTimer();
    if (!supabase) {
      clearOfflineEntitlements();
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: true });
      return;
    }
    let session;
    try {
      const result = await supabase.auth.getSession();
      session = result.data.session;
    } catch {
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
      return;
    }
    if (!session?.user) {
      clearEntitlementExpiryTimer();
      clearOfflineEntitlements();
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: true });
      return;
    }

    // Admin status is checked server-side against ADMIN_EMAILS; never trust client metadata.
    let isAdmin = false;
    try {
      const { data, error } = await supabase.functions.invoke('admin-payment-review', { body: { action: 'check-admin' } });
      isAdmin = !error && data?.isAdmin === true;
    } catch {
      // If the admin check is unavailable, continue with ordinary subscription lookup.
    }

    if (isAdmin) {
      // Refresh the signed lease from the server. Never synthesize admin expiries in the browser.
      clearOfflineEntitlements(session.user.id);
      try {
        const { data, error } = await supabase.functions.invoke('question-bank', {
          body: { action: 'offline-license' }
        });
        if (!error && typeof data?.token === 'string') {
          const saved = await saveOfflineEntitlements(session.user.id, data.token);
          if (saved) {
            const expiryTimes = await Promise.all(TRACK_IDS.map((track) => getOfflineEntitlementExpiry(session.user.id, track)));
            armEntitlementExpiryRefresh(session.user.id, expiryTimes);
          }
        }
      } catch {
        // Online admin access remains available; offline access stays cleared if signing fails.
      }
      set({ cloudTrackIds: [...TRACK_IDS], ...accessFlags([...TRACK_IDS]), entitlementsVerified: true });
      return;
    }

    try {
      const [websiteResult, playResult] = await Promise.all([
        supabase.from('entitlements')
          .select('track_id, expires_at')
          .eq('user_id', session.user.id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString()),
        supabase.from('google_play_entitlements')
          .select('track_id, expires_at')
          .eq('user_id', session.user.id)
          .eq('status', 'active')
          .gt('expires_at', new Date().toISOString())
      ]);
      // Google Play entitlement syncing is an optional backend extension until its
      // migration is released. Ignore only PostgREST's exact missing-table/schema-cache
      // response; permission failures and other client/server errors must not be hidden.
      const playTableMissing = isMissingGooglePlayEntitlementsTable(playResult.error);
      const error = websiteResult.error || (playTableMissing ? null : playResult.error);
      const errorStatus = websiteResult.error ? websiteResult.status : playResult.status;
      if (error) {
        // Fail closed for authorization/client errors. Only a confirmed network failure or
        // server outage may use a still-valid signed lease cached for this same account.
        if (canUseOfflineEntitlementsAfterError(error, errorStatus)) {
          const offlineIds = await getOfflineEntitledTracks(session.user.id);
          if (offlineIds.length) {
            const expiryTimes = await Promise.all(offlineIds.map((track) =>
              getOfflineEntitlementExpiry(session.user.id, track as (typeof TRACK_IDS)[number])
            ));
            armEntitlementExpiryRefresh(session.user.id, expiryTimes);
            set({ cloudTrackIds: offlineIds, ...accessFlags(offlineIds), entitlementsVerified: true });
            return;
          }
        } else {
          clearOfflineEntitlements(session.user.id);
        }
        set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
        return;
      }
      const rows = [
        ...(websiteResult.data ?? []),
        ...(playTableMissing ? [] : (playResult.data ?? []))
      ];
      const ids = Array.from(new Set(rows.map((row) => row.track_id as string)));

      // Replace any old signed lease with a fresh server-signed version of the current
      // entitlement state. If issuance fails, old offline access must not survive a
      // successful live check that found the license revoked or expired.
      clearOfflineEntitlements(session.user.id);
      try {
        const { data: offlineLicense, error: offlineLicenseError } = await supabase.functions.invoke('question-bank', {
          body: { action: 'offline-license' }
        });
        if (!offlineLicenseError && typeof offlineLicense?.token === 'string') {
          await saveOfflineEntitlements(session.user.id, offlineLicense.token);
        }
      } catch {
        // Keep online access working, but don't retain stale offline access.
      }

      armEntitlementExpiryRefresh(session.user.id, rows.map((row) => row.expires_at));
      set({ cloudTrackIds: ids, ...accessFlags(ids), entitlementsVerified: true });
    } catch {
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
    }
  },

  checkLicenseStatus: () => {
    // Account-based access is refreshed from Supabase after authentication changes.
  },

  isTrackUnlocked: (track: string) => {
    const s = get();
    if (s.isAllAccessUnlocked || s.cloudTrackIds.includes('ALL')) return true;
    switch (track.toUpperCase()) {
      case 'DECK_OIC_NW':
      case 'OIC':
        return s.cloudTrackIds.includes('DECK_OIC_NW');
      case 'GMDSS_GOC':
      case 'GOC':
      case 'GMDSS':
        return s.cloudTrackIds.includes('GMDSS_GOC');
      case 'ENGINE_OIC_EW':
      case 'EW':
        return s.cloudTrackIds.includes('ENGINE_OIC_EW');
      case 'DECK_MGT':
      case 'DM':
        return s.cloudTrackIds.includes('DECK_MGT');
      case 'ENGINE_MGT':
      case 'EM':
        return s.cloudTrackIds.includes('ENGINE_MGT');
      default:
        return false;
    }
  },

  getRemainingLabel: () => {
    const count = get().cloudTrackIds.length;
    return get().isAllAccessUnlocked ? 'Admin · All tracks unlocked' : count ? `${count} active subscription track${count === 1 ? '' : 's'}` : 'No active subscriptions';
  },

  clearLicense: () => {
    clearEntitlementExpiryTimer();
    clearOfflineEntitlements();
    set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
  }
  });
});
