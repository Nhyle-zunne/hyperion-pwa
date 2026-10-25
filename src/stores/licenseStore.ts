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
  return {
    isOicNwUnlocked: trackIds.includes('DECK_OIC_NW'),
    isGmdssUnlocked: trackIds.includes('GMDSS_GOC'),
    isEngineEwUnlocked: trackIds.includes('ENGINE_OIC_EW'),
    isDeckMgtUnlocked: trackIds.includes('DECK_MGT'),
    isEngineMgtUnlocked: trackIds.includes('ENGINE_MGT'),
    isAllAccessUnlocked: TRACK_IDS.every((id) => trackIds.includes(id))
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
    return count ? `${count} active subscription track${count === 1 ? '' : 's'}` : 'No active subscriptions';
  },

  clearLicense: () => set({ cloudTrackIds: [], ...accessFlags([]) })
}));
