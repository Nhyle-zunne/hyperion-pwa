import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import { getOfflineEntitledTracks, saveOfflineEntitlements } from '../lib/offlineQuestionCache';

interface LicenseState {
  isOicNwUnlocked: boolean;
  isGmdssUnlocked: boolean;
  isEngineEwUnlocked: boolean;
  isDeckMgtUnlocked: boolean;
  isEngineMgtUnlocked: boolean;
  isAllAccessUnlocked: boolean;
  cloudTrackIds: string[];
  entitlementsVerified: boolean;
  checkLicenseStatus: () => void;
  isTrackUnlocked: (track: string) => boolean;
  getRemainingLabel: () => string;
  clearLicense: () => void;
  refreshCloudEntitlements: () => Promise<void>;
}

const TRACK_IDS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'];

function canUseOfflineEntitlementsAfterError(error: unknown): boolean {
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true;
  const status = Number((error as { context?: { status?: number } } | null)?.context?.status || 0);
  // Never fall back to a locally cached license after an authorization/client error.
  // Only genuine network failures and server-side outages may use offline access.
  return status === 0 || status >= 500;
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

export const useLicenseStore = create<LicenseState>()((set, get) => ({
  isOicNwUnlocked: false,
  isGmdssUnlocked: false,
  isEngineEwUnlocked: false,
  isDeckMgtUnlocked: false,
  isEngineMgtUnlocked: false,
  isAllAccessUnlocked: false,
  cloudTrackIds: [],
  entitlementsVerified: false,

  refreshCloudEntitlements: async () => {
    if (!supabase) {
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
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: true });
      return;
    }

    // Admin status is checked server-side against ADMIN_EMAILS; never trust client metadata.
    try {
      const { data, error } = await supabase.functions.invoke('admin-payment-review', { body: { action: 'check-admin' } });
      if (!error && data?.isAdmin === true) {
        const adminOfflineUntil = Date.now() + 7 * 24 * 60 * 60 * 1000;
        saveOfflineEntitlements(session.user.id, Object.fromEntries(TRACK_IDS.map(track => [track, adminOfflineUntil])));
        set({ cloudTrackIds: [...TRACK_IDS], ...accessFlags(TRACK_IDS), entitlementsVerified: true });
        return;
      }
    } catch {
      // If the admin check is unavailable, continue with ordinary subscription lookup.
    }

    try {
      const { data, error } = await supabase
        .from('entitlements')
        .select('track_id, expires_at')
        .eq('user_id', session.user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString());
      if (error) {
        // Fail closed for 4xx authorization/client errors; only use a saved license
        // when offline or when the backend has a network/server outage.
        if (canUseOfflineEntitlementsAfterError(error)) {
          const offlineIds = getOfflineEntitledTracks(session.user.id);
          if (offlineIds.length) {
            set({ cloudTrackIds: offlineIds, ...accessFlags(offlineIds), entitlementsVerified: true });
            return;
          }
        }
        set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
        return;
      }
      const rows = data ?? [];
      const ids = Array.from(new Set(rows.map((row) => row.track_id as string)));
      const expiresByTrack: Record<string, number> = {};
      for (const row of rows) {
        const expiresAt = Date.parse(row.expires_at as string);
        if (Number.isFinite(expiresAt) && expiresAt > Date.now()) {
          expiresByTrack[row.track_id as string] = Math.max(expiresByTrack[row.track_id as string] ?? 0, expiresAt);
        }
      }
      saveOfflineEntitlements(session.user.id, expiresByTrack);
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

  clearLicense: () => set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false })
}));
