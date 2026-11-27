import type { SupabaseClient } from '@supabase/supabase-js'
import type { ManualCheckoutItem } from './manualQrCheckout'

export type ManualClaimStatus = 'awaiting_proof' | 'pending_verification' | 'approved' | 'rejected' | 'expired' | 'cancelled'

export type ManualCheckoutClaim = {
  id: string
  user_id: string
  selection_key: string
  items: ManualCheckoutItem[]
  total_amount_php: number
  status: ManualClaimStatus
  created_at: string
  expires_at: string
  reviewed_at: string | null
}

const labels: Record<ManualClaimStatus, string> = {
  awaiting_proof: 'PENDING VERIFICATION',
  pending_verification: 'PENDING VERIFICATION',
  approved: 'APPROVED',
  rejected: 'REJECTED',
  expired: 'EXPIRED',
  cancelled: 'CANCELLED',
}

export function claimStatusLabel(status: ManualClaimStatus): string { return labels[status] }

export function isOpenManualClaim(claim: Pick<ManualCheckoutClaim, 'status' | 'expires_at'>, now = Date.now()): boolean {
  return claim.status === 'pending_verification' ||
    (claim.status === 'awaiting_proof' && Date.parse(claim.expires_at) > now)
}

export function pendingManualTracks(claims: readonly Pick<ManualCheckoutClaim, 'status' | 'expires_at' | 'items'>[], now = Date.now()): Set<string> {
  return new Set(claims.filter(claim => isOpenManualClaim(claim, now)).flatMap(claim => claim.items.map(item => item.code)))
}

const inFlight = new Map<string, Promise<ManualCheckoutClaim[]>>()

export function fetchManualCheckoutClaims(client: Pick<SupabaseClient, 'from'>, userId: string): Promise<ManualCheckoutClaim[]> {
  const ongoing = inFlight.get(userId)
  if (ongoing) return ongoing
  const columns = 'id,user_id,selection_key,items,total_amount_php,status,created_at,expires_at,reviewed_at'
  const request = (async () => {
    const [recent, open] = await Promise.all([
      client.from('manual_checkout_claims').select(columns).eq('user_id', userId)
        .order('created_at', { ascending: false }).limit(50),
      client.from('manual_checkout_claims').select(columns).eq('user_id', userId)
        .or(`status.eq.pending_verification,and(status.eq.awaiting_proof,expires_at.gt.${new Date().toISOString()})`)
        .order('created_at', { ascending: false }).limit(10),
    ])
    if (recent.error || open.error) throw new Error('Could not load your payment requests. Please refresh your account.')
    const unique = new Map<string, ManualCheckoutClaim>()
    for (const row of [...(recent.data ?? []), ...(open.data ?? [])] as ManualCheckoutClaim[]) unique.set(row.id, row)
    return [...unique.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
  })()
  inFlight.set(userId, request)
  void request.finally(() => { if (inFlight.get(userId) === request) inFlight.delete(userId) }).catch(() => {})
  return request
}
