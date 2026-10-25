import { create } from 'zustand';
import { supabase } from '../lib/supabase';

interface LicenseState {
  isOicNwUnlocked: boolean;
  isGmdssUnlocked: boolean;
  isEngineEwUnlocked: boolean;
  isDeckMgtUnlocked: boolean;
  isEngineMgtUnlocked: boolean;
  isAllAccessUnlocked: boolean;
  cloudTrackIds: string[];
  checkLicenseStatus: () => void;
  isTrackUnlocked: (track: string) => boolean;
  getRemainingLabel: () => string;
  clearLicense: () => void;
  refreshCloudEntitlements: () => Promise<void>;
}

const TRACK_IDS = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'];

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

  refreshCloudEntitlements: async () => {
    if (!supabase) {
      set({ cloudTrackIds: [], ...accessFlags([]) });
      return;
    }
    const { data: { session } } = await supabase.auth.getSession();
    if (!session?.user) {
      set({ cloudTrackIds: [], ...accessFlags([]) });
      return;
    }

    // Admin status is checked server-side against ADMIN_EMAILS; never trust client metadata.
    try {
      const { data, error } = await supabase.functions.invoke('admin-payment-review', { body: { action: 'check-admin' } });
      if (!error && data?.isAdmin === true) {
        set({ cloudTrackIds: [...TRACK_IDS], ...accessFlags(TRACK_IDS) });
        return;
      }
    } catch {
      // If the admin check is unavailable, continue with ordinary subscription lookup.
    }

    const { data, error } = await supabase
      .from('entitlements')
      .select('track_id')
      .eq('user_id', session.user.id)
      .eq('status', 'active')
      .gt('expires_at', new Date().toISOString());
    const ids = error ? [] : Array.from(new Set((data ?? []).map((row) => row.track_id as string)));
    set({ cloudTrackIds: ids, ...accessFlags(ids) });
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

  clearLicense: () => set({ cloudTrackIds: [], ...accessFlags([]) })
}));
