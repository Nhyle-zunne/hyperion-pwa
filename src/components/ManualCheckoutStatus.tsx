import { Link } from 'react-router-dom'
import { claimStatusLabel, isOpenManualClaim, type ManualCheckoutClaim } from '../lib/manualCheckoutClaims'
import './ManualCheckoutStatus.css'

const messengerUrl = 'https://m.me/HyperionMaritime'
const durations = { week: 'Weekly', month: 'Monthly', year: 'Yearly', lifetime: 'Lifetime' }

export function ManualCheckoutNotice({ claims, showHistoryLink = true }: { claims: readonly ManualCheckoutClaim[]; showHistoryLink?: boolean }) {
  const open = claims.filter(claim => isOpenManualClaim(claim))
  if (!open.length) return null
  return <section className="manual-checkout-notice" role="status" aria-label="Pending payment verification">
    <div className="manual-checkout-notice-heading">
      <strong>{open.length === 1 ? 'You have a pending purchase' : `You have ${open.length} pending purchases`}</strong>
      <span className="manual-checkout-status is-pending">PENDING VERIFICATION</span>
    </div>
    <p>If you have sent your receipt, please allow 24–48 hours for verification and license activation. Do not pay again. If you have not sent it yet, <a href={messengerUrl} target="_blank" rel="noopener noreferrer">open Messenger</a> and include your Hyperion account email. If access is still inactive after 48 hours, message us to follow up.</p>
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
          : <p>This request was not approved. Contact Hyperion before making another payment.</p>}
      </article>
    })}
  </div>
}
