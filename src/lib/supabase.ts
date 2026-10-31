import { createClient } from '@supabase/supabase-js'

export const supabaseUrl = import.meta.env.VITE_SUPABASE_URL as string | undefined
export const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey)
export const supabase = supabaseConfigured ? createClient(supabaseUrl!, supabaseAnonKey!, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
}) : null

export type PaidTrack = 'oic_nw' | 'gmdss' | 'engine_ew' | 'deck_mgt' | 'engine_mgt'
export type LicenseTerm = 'week' | 'month' | 'year'
export const LICENSE_TERMS: { code: LicenseTerm; label: string; durationLabel: string }[] = [
  { code: 'week', label: 'Weekly', durationLabel: '7 days' },
  { code: 'month', label: 'Monthly', durationLabel: '1 month' },
  { code: 'year', label: 'Yearly', durationLabel: '12 months' },
]
export function termLabel(term: LicenseTerm): string {
  return term === 'week' ? 'week' : term === 'month' ? 'month' : 'year'
}
export function termDisplay(term: LicenseTerm): string {
  return term === 'week' ? 'Weekly' : term === 'month' ? 'Monthly' : 'Yearly'
}
export function priceForTerm(product: { weeklyPrice: number; monthlyPrice: number; annualPrice: number }, term: LicenseTerm): number {
  return term === 'week' ? product.weeklyPrice : term === 'month' ? product.monthlyPrice : product.annualPrice
}

export const PAID_PRODUCTS: { code: PaidTrack; label: string; trackLabel: string; weeklyPrice: number; monthlyPrice: number; annualPrice: number }[] = [
  { code: 'oic_nw', label: 'Deck OIC-NW', trackLabel: 'DECK_OIC_NW', weeklyPrice: 20, monthlyPrice: 50, annualPrice: 350 },
  { code: 'gmdss', label: 'GMDSS GOC', trackLabel: 'GMDSS_GOC', weeklyPrice: 15, monthlyPrice: 40, annualPrice: 250 },
  { code: 'engine_ew', label: 'Engine OIC-EW', trackLabel: 'ENGINE_OIC_EW', weeklyPrice: 20, monthlyPrice: 50, annualPrice: 350 },
  { code: 'deck_mgt', label: 'Deck Management', trackLabel: 'DECK_MGT', weeklyPrice: 40, monthlyPrice: 100, annualPrice: 700 },
  { code: 'engine_mgt', label: 'Engine Management', trackLabel: 'ENGINE_MGT', weeklyPrice: 40, monthlyPrice: 100, annualPrice: 700 },
]

export function paidProductCodeForTrackId(trackId: string): PaidTrack | null {
  const normalized = trackId.trim().toLowerCase()
  return PAID_PRODUCTS.find(item =>
    item.code === normalized || item.trackLabel.toLowerCase() === normalized
  )?.code ?? null
}
