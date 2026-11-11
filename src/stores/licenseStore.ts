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
  entitlementUserId: string | null;
  cloudSyncExpiresAt: number;
  cloudSyncVerified: boolean;
  entitlementExpiryRevision: number;
  checkLicenseStatus: () => void;
  isTrackUnlocked: (track: string) => boolean;
  getRemainingLabel: () => string;
  clearLicense: () => void;
  refreshCloudEntitlements: () => Promise<void>;
  refreshCachedEntitlements: () => Promise<void>;
}

const TRACK_IDS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'] as const;

let refreshGeneration = 0;
let invalidationEpoch = 0;
let authRequestSequence = 0;
let latestResolvedAuthRequest = 0;
let cloudRefresh: { userId: string; generation: number; promise: Promise<void> } | null = null;
let entitlementExpiryTimer: ReturnType<typeof setTimeout> | null = null;

function clearEntitlementExpiryTimer() {
  if (entitlementExpiryTimer !== null) clearTimeout(entitlementExpiryTimer);
  entitlementExpiryTimer = null;
}

function scheduleEntitlementExpiryRefresh(
  userId: string,
  expiryValues: unknown[],
  onExpiry: (userId: string) => void,
  verifiedNow = Date.now()
) {
  clearEntitlementExpiryTimer();
  const delay = nextExpiryRefreshDelay(expiryValues, verifiedNow);
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
  const armEntitlementExpiryRefresh = (userId: string, expiryValues: unknown[], verifiedNow?: number) => {
    // Local access follows the actual server-issued subscription expiry. Recheck
    // then so an offline device drops expired tracks without needing a network call.
    scheduleEntitlementExpiryRefresh(userId, expiryValues, (expectedUserId) => {
      void (async () => {
        try {
          // Signed, owner-bound expiry enforcement is LOCAL. Expiration must
          // never fetch a fresh grant in the background or extend an expired
          // subscription. Renewal is picked up at next login, manual Sync,
          // or successful checkout/purchase restoration.
          if (get().entitlementUserId !== expectedUserId) return;
          await applyCachedOfflineEntitlements(expectedUserId);
          if (get().entitlementUserId === expectedUserId) {
            set((state) => ({ entitlementExpiryRevision: state.entitlementExpiryRevision + 1 }));
          }
        } catch {
          // The next foreground local-cache check still enforces expiry.
        }
      })();
    }, verifiedNow);
  };

  const applyCachedOfflineEntitlements = async (expectedUserId?: string) => {
    const generation = refreshGeneration;
    const snapshot = await getCachedOfflineEntitlementSnapshot(expectedUserId);
    if (generation !== refreshGeneration) return false;
    if (!snapshot || (expectedUserId && snapshot.userId !== expectedUserId)) {
      set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false, entitlementUserId: null, cloudSyncExpiresAt: 0, cloudSyncVerified: false });
      return false;
    }
    const offlineIds = snapshot.isAdmin ? [...TRACK_IDS] : Object.keys(snapshot.trackExpiries);
    armEntitlementExpiryRefresh(snapshot.userId, Object.values(snapshot.trackExpiries), snapshot.verifiedAt);
    set({
      cloudTrackIds: offlineIds,
      ...accessFlags(offlineIds),
      entitlementsVerified: true,
      entitlementUserId: snapshot.userId,
      cloudSyncVerified: get().cloudSyncVerified && get().entitlementUserId === snapshot.userId && offlineIds.length > 0,
      cloudSyncExpiresAt: snapshot.isAdmin ? Infinity : Math.max(0, ...Object.values(snapshot.trackExpiries).filter((value): value is number => typeof value === 'number'))
    });
    // A correctly signed, current lease with no active tracks is still an
    // authoritative cache result; distinguish it from a missing/invalid cache.
    return true;
  };

  const refreshSignedOfflineLease = async (userId: string, generation: number) => {
    const { data, error } = await supabase!.functions.invoke('question-bank', {
      body: { action: 'offline-license' }
    });
    if (error) throw error;
    if (generation !== refreshGeneration) throw new Error('Account access changed during refresh.');
    if (typeof data?.token !== 'string' || !data.token) {
      throw new Error('The server did not return a signed offline license.');
    }
    if (!await saveOfflineEntitlements(userId, data.token, () => generation === refreshGeneration, data.issuedAt)) {
      throw new Error('The signed offline license could not be saved on this device.');
    }
    const snapshot = await getCachedOfflineEntitlementSnapshot(userId);
    if (generation !== refreshGeneration) throw new Error('Account access changed during refresh.');
    if (!snapshot || snapshot.userId !== userId) {
      throw new Error('The signed offline license could not be verified after saving.');
    }
    const trackIds = snapshot.isAdmin ? [...TRACK_IDS] : Object.keys(snapshot.trackExpiries);
    armEntitlementExpiryRefresh(userId, Object.values(snapshot.trackExpiries), snapshot.verifiedAt);
    return { trackIds, isAdmin: snapshot.isAdmin, expiresAt: snapshot.isAdmin ? Infinity : Math.max(0, ...Object.values(snapshot.trackExpiries).filter((value): value is number => typeof value === 'number')) };
  };

  return ({
  isOicNwUnlocked: false,
  isGmdssUnlocked: false,
  isEngineEwUnlocked: false,
  isDeckMgtUnlocked: false,
  isEngineMgtUnlocked: false,
  isAllAccessUnlocked: false,
  cloudTrackIds: [],
  entitlementsVerified: false, entitlementUserId: null, cloudSyncExpiresAt: 0, cloudSyncVerified: false,
  entitlementExpiryRevision: 0,

  refreshCachedEntitlements: async () => {
    await applyCachedOfflineEntitlements();
    set((state) => ({ entitlementExpiryRevision: state.entitlementExpiryRevision + 1 }));
  },

  refreshCloudEntitlements: async () => {
    const observedEpoch = invalidationEpoch;
    const authRequest = ++authRequestSequence;
    // A signed server lease is the common entitlement source for both purchase
    // channels. Offline startup never depends on Supabase session restoration.
    if (typeof navigator !== 'undefined' && navigator.onLine === false) {
      set({ cloudSyncVerified: false });
      await applyCachedOfflineEntitlements();
      return;
    }
    if (!supabase) {
      await applyCachedOfflineEntitlements();
      return;
    }

    let session;
    try {
      const result = await supabase.auth.getSession();
      session = result.data.session;
    } catch {
      if (observedEpoch !== invalidationEpoch || authRequest < latestResolvedAuthRequest) return;
      set({ cloudSyncVerified: false });
      await applyCachedOfflineEntitlements();
      return;
    }

    // Coalesce only after resolving the account. A pending refresh for another
    // account must never be reused, and explicit sign-out invalidates its grant.
    if (observedEpoch !== invalidationEpoch) return;
    // A newer account lookup can supersede a running old-account refresh. An
    // older lookup resolving late must never replace that newer account again.
    if (authRequest < latestResolvedAuthRequest) return cloudRefresh?.promise;
    latestResolvedAuthRequest = authRequest;
    if (session?.user && cloudRefresh?.userId === session.user.id &&
        cloudRefresh.generation === refreshGeneration) return cloudRefresh.promise;
    if (!session?.user) {
      // Missing authentication is not an intentional sign-out: preserve the
      // verified owner-bound offline lease until its actual expiry.
      await applyCachedOfflineEntitlements();
      return;
    }
    const userId = session.user.id;
    const generation = ++refreshGeneration;
    const promise = (async () => {
      // Keep local expiry enforcement running while the network is pending.
      await applyCachedOfflineEntitlements(userId);
      try {
        if (generation !== refreshGeneration) return;
        const signedLease = await refreshSignedOfflineLease(userId, generation);
        if (generation !== refreshGeneration) return;
        // The cryptographically verified lease includes the administrator role;
        // a second admin-payment-review invocation grants no additional assurance.
        set({
          cloudTrackIds: signedLease.trackIds,
          ...accessFlags(signedLease.trackIds),
          entitlementsVerified: true,
          entitlementUserId: userId,
          cloudSyncExpiresAt: signedLease.expiresAt,
          cloudSyncVerified: true
        });
        // Account overview rows are display-only and may have changed after
        // another-device purchase, manual Sync or a successful Google sign-in.
        // Tell cached account screens to drop their previous display snapshot.
        if (typeof window !== 'undefined') {
          window.dispatchEvent(new CustomEvent('hyperion:license-server-refreshed', { detail: { userId } }));
        }
      } catch {
        if (generation !== refreshGeneration) return;
        set({ cloudSyncVerified: false });
        const restored = await applyCachedOfflineEntitlements(userId);
        if (generation !== refreshGeneration) return;
        if (!restored) set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false, entitlementUserId: null, cloudSyncExpiresAt: 0, cloudSyncVerified: false });
      }
    })();
    const job = { userId, generation, promise };
    cloudRefresh = job;
    try { await promise; }
    finally { if (cloudRefresh === job) cloudRefresh = null; }
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
    refreshGeneration++;
    invalidationEpoch++;
    cloudRefresh = null;
    clearEntitlementExpiryTimer();
    clearOfflineEntitlements();
    set({ cloudTrackIds: [], ...accessFlags([]), entitlementsVerified: false, entitlementUserId: null, cloudSyncExpiresAt: 0, cloudSyncVerified: false });
  }
  });
});
