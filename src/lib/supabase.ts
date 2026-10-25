import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)
export const supabase = supabaseConfigured ? createClient(url!, anonKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null

export type PaidTrack = 'oic_nw' | 'gmdss' | 'engine_ew' | 'deck_mgt' | 'engine_mgt' | 'all_access'

export const PAID_PRODUCTS: { code: PaidTrack; label: string; trackLabel: string }[] = [
  { code: 'oic_nw', label: 'Deck OIC-NW', trackLabel: 'DECK_OIC_NW' },
  { code: 'gmdss', label: 'GMDSS GOC', trackLabel: 'GMDSS_GOC' },
  { code: 'engine_ew', label: 'Engine OIC-EW', trackLabel: 'ENGINE_OIC_EW' },
  { code: 'deck_mgt', label: 'Deck Management', trackLabel: 'DECK_MGT' },
  { code: 'engine_mgt', label: 'Engine Management', trackLabel: 'ENGINE_MGT' },
  { code: 'all_access', label: 'All-Access Bundle', trackLabel: 'ALL' },
]
