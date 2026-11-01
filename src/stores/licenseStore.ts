import { create } from 'zustand';
import { supabase } from '../lib/supabase';
import {
  clearOfflineEntitlements,
  getCachedOfflineEntitlementSnapshot,
  saveOfflineEntitlements
} from '../lib/offlineQuestionCache';
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
    // Local access follows the actual server-issued subscription expiry. Recheck
    // then so an offline device drops expired tracks without needing a network call.
    scheduleEntitlementExpiryRefresh(userId, expiryValues, (expectedUserId) => {
      void (async () => {
        const isOffline = typeof navigator !== 'undefined' && navigator.onLine === false;
        try {
          if (isOffline) {
            await get().refreshCloudEntitlements();
            set((state) => ({ entitlementExpiryRevision: state.entitlementExpiryRevision + 1 }));
            return;
          }
          if (!supabase) return;
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

  const applyCachedOfflineEntitlements = async (expectedUserId?: string) => {
    const snapshot = await getCachedOfflineEntitlementSnapshot();
    if (!snapshot || (expectedUserId && snapshot.userId !== expectedUserId)) {
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
      return false;
    }
    const offlineIds = snapshot.isAdmin ? [...TRACK_IDS] : Object.keys(snapshot.trackExpiries);
    armEntitlementExpiryRefresh(snapshot.userId, Object.values(snapshot.trackExpiries));
    set({
      cloudTrackIds: offlineIds,
      ...accessFlags(offlineIds),
      entitlementsVerified: true
    });
    // A correctly signed, current lease with no active tracks is still an
    // authoritative cache result; distinguish it from a missing/invalid cache.
    return true;
  };

  const refreshSignedOfflineLease = async (userId: string) => {
    const { data, error } = await supabase!.functions.invoke('question-bank', {
      body: { action: 'offline-license' }
    });
    if (error) throw error;
    if (typeof data?.token !== 'string' || !data.token) {
      throw new Error('The server did not return a signed offline license.');
    }
    if (!await saveOfflineEntitlements(userId, data.token)) {
      throw new Error('The signed offline license could not be saved on this device.');
    }
    const snapshot = await getCachedOfflineEntitlementSnapshot();
    if (!snapshot || snapshot.userId !== userId) {
      throw new Error('The signed offline license could not be verified after saving.');
    }
    const trackIds = snapshot.isAdmin ? [...TRACK_IDS] : Object.keys(snapshot.trackExpiries);
    armEntitlementExpiryRefresh(userId, Object.values(snapshot.trackExpiries));
    return { trackIds, isAdmin: snapshot.isAdmin };
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
    // A signed server lease is the common entitlement source for both purchase
    // channels. Offline startup never depends on Supabase session restoration.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      await applyCachedOfflineEntitlements();
      return;
    }
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
      await applyCachedOfflineEntitlements();
      return;
    }

    if (!session?.user) {
      // No authenticated session means the browser cannot claim the previous
      // account's paid tracks. Only the explicit offline/network-error paths
      // above may restore a signed offline lease.
      clearEntitlementExpiryTimer();
      clearOfflineEntitlements();
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: true });
      return;
    }

    let isAdmin = false;
    try {
      const { data, error } = await supabase.functions.invoke('admin-payment-review', {
        body: { action: 'check-admin' }
      });
      isAdmin = !error && data?.isAdmin === true;
    } catch {
      // An unavailable admin check must not block ordinary signed-license refresh.
    }

    try {
      const signedLease = await refreshSignedOfflineLease(session.user.id);
      if (isAdmin || signedLease.isAdmin) {
        // Admin UI remains all-access online and offline. The signed role claim
        // has no subscription expiry because administrator access is not a plan.
        set({
          cloudTrackIds: [...TRACK_IDS],
          ...accessFlags([...TRACK_IDS]),
          entitlementsVerified: true
        });
        return;
      }
      set({
        cloudTrackIds: signedLease.trackIds,
        ...accessFlags(signedLease.trackIds),
        entitlementsVerified: true
      });
    } catch {
      // Preserve the last valid lease for this exact account when refresh/signing
      // fails. Never erase a paid offline grant before a replacement is verified.
      const restored = await applyCachedOfflineEntitlements(session.user.id);
      if (isAdmin) {
        set({
          cloudTrackIds: [...TRACK_IDS],
          ...accessFlags([...TRACK_IDS]),
          entitlementsVerified: true
        });
      } else if (!restored) {
        set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false });
      }
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
