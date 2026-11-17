import type { LicenseTerm } from './supabase'

// Display-only duration copy; entitlement and billing periods remain server-owned.
export function storeAccessBenefit(term: LicenseTerm, lifetimeSelected: boolean): string {
  if (lifetimeSelected) return 'No expiration'
  return term === 'week' ? '1 week unlimited access' : term === 'month' ? '1 month unlimited access' : '1 year unlimited access'
}
