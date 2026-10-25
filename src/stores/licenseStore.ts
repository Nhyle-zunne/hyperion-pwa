import { create } from 'zustand'
import { supabase } from '../lib/supabase'

interface LicenseState {
  cloudTrackIds: string[]
  isTrackUnlocked: (track: string) => boolean
  refreshCloudEntitlements: () => Promise<void>
}

export const useLicenseStore = create<LicenseState>()((set, get) => ({
  cloudTrackIds: [],
  refreshCloudEntitlements: async () => {
    if (!supabase) { set({ cloudTrackIds: [] }); return }
    const { data: { session } } = await supabase.auth.getSession()
    if (!session?.user) { set({ cloudTrackIds: [] }); return }
    const { data, error } = await supabase.from('entitlements').select('track_id').eq('user_id', session.user.id).eq('status', 'active').gt('expires_at', new Date().toISOString())
    set({ cloudTrackIds: error ? [] : Array.from(new Set((data ?? []).map(row => row.track_id))) })
  },
  isTrackUnlocked: (track: string) => {
    const ids = get().cloudTrackIds
    if (ids.includes('ALL')) return true
    const t = track.toUpperCase()
    switch (t) {
      case 'DECK_OIC_NW': case 'OIC': return ids.includes('DECK_OIC_NW')
      case 'GMDSS_GOC': case 'GOC': case 'GMDSS': return ids.includes('GMDSS_GOC')
      case 'ENGINE_OIC_EW': case 'EW': return ids.includes('ENGINE_OIC_EW')
      case 'DECK_MGT': case 'DM': return ids.includes('DECK_MGT')
      case 'ENGINE_MGT': case 'EM': return ids.includes('ENGINE_MGT')
      default: return false
    }
  }
}))
