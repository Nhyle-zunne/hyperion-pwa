import type { LicenseTerm, PaidTrack } from './supabase'

// Display-only duration copy; entitlement and billing periods remain server-owned.
export function storeAccessBenefit(term: LicenseTerm, lifetimeSelected: boolean): string {
  if (lifetimeSelected) return 'No expiration'
  return term === 'week' ? '1 week unlimited access' : term === 'month' ? '1 month unlimited access' : '1 year unlimited access'
}

const TRACK_FEATURE_CONTEXT: Record<PaidTrack, { name: string; topic: string }> = {
  oic_nw: { name: 'Deck OIC-NW', topic: 'deck navigation and watchkeeping' },
  engine_ew: { name: 'Engine OIC-EW', topic: 'marine engineering and machinery' },
  gmdss: { name: 'GMDSS GOC', topic: 'maritime radio communications' },
  deck_mgt: { name: 'Deck Management', topic: 'deck leadership and command' },
  engine_mgt: { name: 'Engine Management', topic: 'engine-room management' },
}

// All tracks share the actual premium tools; this copy describes the selected track's content.
export function storePremiumFeaturesForTrack(code: PaidTrack): string[] {
  const { name, topic } = TRACK_FEATURE_CONTEXT[code]
  return [
    `Unlimited ${name} practice sessions`,
    `Unlimited ${name} timed mock exams`,
    `Full ${name} question bank`,
    `Custom ${topic} drills and question ranges`,
    `Quick Scan for ${name} questions`,
    `${name} mistakes notebook and bookmarks`,
    `Full-text search of ${name} questions`,
    `Offline ${name} review after downloading`,
    `${name} study history and cross-device progress sync`,
    `Use your ${name} license on Hyperion web and Android`,
  ]
}
