import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)
export const supabase = supabaseConfigured ? createClient(url!, anonKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null

export type PaidTrack = 'oic_nw' | 'gmdss' | 'engine_ew' | 'deck_mgt' | 'engine_mgt'

export const PAID_PRODUCTS: { code: PaidTrack; label: string; trackLabel: string; annualPrice: number }[] = [
  { code: 'oic_nw', label: 'Deck OIC-NW', trackLabel: 'DECK_OIC_NW', annualPrice: 350 },
  { code: 'gmdss', label: 'GMDSS GOC', trackLabel: 'GMDSS_GOC', annualPrice: 250 },
  { code: 'engine_ew', label: 'Engine OIC-EW', trackLabel: 'ENGINE_OIC_EW', annualPrice: 350 },
  { code: 'deck_mgt', label: 'Deck Management', trackLabel: 'DECK_MGT', annualPrice: 700 },
  { code: 'engine_mgt', label: 'Engine Management', trackLabel: 'ENGINE_MGT', annualPrice: 700 },
]
