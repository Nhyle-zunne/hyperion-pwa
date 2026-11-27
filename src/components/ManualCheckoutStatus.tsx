import { useState } from 'react'
import { Link } from 'react-router-dom'
import { claimStatusLabel, isOpenManualClaim, type ManualCheckoutClaim } from '../lib/manualCheckoutClaims'
import { supabase } from '../lib/supabase'
import './ManualCheckoutStatus.css'

const messengerUrl = 'https://m.me/HyperionMaritime'
const durations = { week: 'Weekly', month: 'Monthly', year: 'Yearly', lifetime: 'Lifetime' }

export function ManualCheckoutNotice({ claims, showHistoryLink = true, onCancelled }: {
  claims: readonly ManualCheckoutClaim[]; showHistoryLink?: boolean; onCancelled?: () => void
}) {
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelledIds, setCancelledIds] = useState<string[]>([])
  const [error, setError] = useState('')
  const open = claims.filter(claim => isOpenManualClaim(claim) && !cancelledIds.includes(claim.id))
  if (!open.length && !cancelledIds.length) return null

  const cancel = async (claim: ManualCheckoutClaim) => {
    if (!supabase || cancellingId || claim.status !== 'awaiting_proof') return
    if (!window.confirm('Cancel this pending purchase? Only continue if you have NOT paid. Cancelling a request does not reverse a bank transfer or refund money.')) return
    setCancellingId(claim.id)
    setError('')
    try {
      const { data, error: requestError } = await supabase.functions.invoke('cancel-manual-checkout-claim', { body: { claimId: claim.id } })
      if (requestError || data?.status !== 'cancelled') throw new Error('Unable to cancel this purchase. Refresh your payment history and contact Hyperion if it is under review.')
      setCancelledIds(previous => [...previous, claim.id])
      onCancelled?.()
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to cancel this purchase. Please try again.')
    } finally {
      setCancellingId(null)
    }
  }

  return <section className="manual-checkout-notice" role="status" aria-label={open.length ? 'Pending payment verification' : 'Purchase cancellation'}>
    {cancelledIds.length > 0 && <p className="manual-checkout-cancel-success">Purchase request cancelled. You can review it in payment history. No bank transfer was refunded.</p>}
    {open.length > 0 && <>
      <div className="manual-checkout-notice-heading">
        <strong>{open.length === 1 ? 'You have a pending purchase' : `You have ${open.length} pending purchases`}</strong>
        <span className="manual-checkout-status is-pending">PENDING VERIFICATION</span>
      </div>
      <p>If you have sent your receipt, please allow 24–48 hours for verification and license activation. Do not pay again. If you have not sent it yet, <a href={messengerUrl} target="_blank" rel="noopener noreferrer">open Messenger</a> and include your Hyperion account email. If access is still inactive after 48 hours, message us to follow up.</p>
      {open.some(claim => claim.status === 'awaiting_proof') && <>
        <p className="manual-checkout-cancel-warning">Only cancel if you have not paid. Cancelling a request does not refund a bank transfer.</p>
        <div className="manual-checkout-cancel-list">
          {open.filter(claim => claim.status === 'awaiting_proof').map(claim => <div className="manual-checkout-cancel-row" key={claim.id}>
            <span>{claim.items.map(item => `${item.label} (${durations[item.term]})`).join(', ')}</span>
            <button type="button" className="manual-checkout-cancel-button" disabled={Boolean(cancellingId)} onClick={() => void cancel(claim)}>
              {cancellingId === claim.id ? 'CANCELLING…' : 'CANCEL PURCHASE'}
            </button>
          </div>)}
        </div>
      </>}
      {error && <p className="manual-checkout-cancel-error" role="alert">{error}</p>}
    </>}
    {showHistoryLink && <Link to="/orders">VIEW PAYMENT HISTORY</Link>}
  </section>
}

export function ManualCheckoutRequestList({ claims, limit }: { claims: readonly ManualCheckoutClaim[]; limit?: number }) {
  const visible = limit ? claims.slice(0, limit) : claims
  if (!visible.length) return null
  return <div className="manual-checkout-requests">
    {visible.map(claim => {
      const status = claim.status === 'awaiting_proof' && !isOpenManualClaim(claim) ? 'expired' : claim.status
      return <article className="manual-checkout-request" key={claim.id}>
        <div className="manual-checkout-request-heading">
          <div>
            <strong>{claim.items.map(item => `${item.label} (${durations[item.term]})`).join(', ')}</strong>
            <div className="manual-checkout-request-meta">Requested {new Date(claim.created_at).toLocaleString()} | ₱{claim.total_amount_php.toLocaleString('en-PH', { minimumFractionDigits: 2 })}</div>
          </div>
          <span className={`manual-checkout-status is-${status}`}>{claimStatusLabel(status)}</span>
        </div>
        <div className="manual-checkout-request-meta">Request ID: {claim.id}</div>
        {status === 'approved' && claim.reviewed_at && <div className="manual-checkout-request-meta">Approved {new Date(claim.reviewed_at).toLocaleString()}</div>}
        {status === 'awaiting_proof' || status === 'pending_verification'
          ? <p>If your receipt has been sent, allow 24–48 hours for review. Do not pay again.</p>
          : status === 'expired' ? <p>This request expired without confirmation. Contact Hyperion before making another payment.</p>
          : status === 'approved' ? <p>Payment verified and access approved. Check your active licenses.</p>
          : status === 'cancelled' ? <p>You cancelled this purchase request. No payment or license was activated.</p>
          : <p>This request was not approved. Contact Hyperion before making another payment.</p>}
      </article>
    })}
  </div>
}
