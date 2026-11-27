import { useEffect, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { claimStatusLabel, isOpenManualClaim, type ManualCheckoutClaim } from '../lib/manualCheckoutClaims'
import type { ManualCheckoutTerm } from '../lib/manualQrCheckout'
import { supabase } from '../lib/supabase'
import './ManualCheckoutStatus.css'

const messengerUrl = 'https://m.me/HyperionMaritime'
const durations = { week: 'Weekly', month: 'Monthly', year: 'Yearly', lifetime: 'Lifetime' }
const termOptions: ManualCheckoutTerm[] = ['week', 'month', 'year', 'lifetime']

export function ManualCheckoutNotice({ claims, showHistoryLink = true, onCancelled }: {
  claims: readonly ManualCheckoutClaim[]; showHistoryLink?: boolean; onCancelled?: () => void
}) {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedSwitchClaim = searchParams.get('switchClaim')
  const [cancellingId, setCancellingId] = useState<string | null>(null)
  const [cancelledIds, setCancelledIds] = useState<string[]>([])
  const [switchingId, setSwitchingId] = useState<string | null>(null)
  const [selectedDurations, setSelectedDurations] = useState<Record<string, ManualCheckoutTerm>>({})
  const [error, setError] = useState('')
  const open = claims.filter(claim => isOpenManualClaim(claim) && !cancelledIds.includes(claim.id))
  useEffect(() => {
    if (requestedSwitchClaim && claims.some(claim => claim.id === requestedSwitchClaim && claim.status === 'awaiting_proof' &&
      isOpenManualClaim(claim) && !cancelledIds.includes(claim.id))) {
      setSwitchingId(requestedSwitchClaim)
    }
  }, [requestedSwitchClaim, claims, cancelledIds])
  if (!open.length && !cancelledIds.length) return null

  const cancel = async (claim: ManualCheckoutClaim, replacementSelection?: string) => {
    if (!supabase || cancellingId || claim.status !== 'awaiting_proof') return
    const prompt = replacementSelection
      ? 'Switch reviewer duration? This cancels your current pending request and opens a new checkout at the updated price. Only continue if you have NOT paid.'
      : 'Cancel this pending purchase? Only continue if you have NOT paid. Cancelling a request does not reverse a bank transfer or refund money.'
    if (!window.confirm(prompt)) return
    setCancellingId(claim.id)
    setError('')
    try {
      const { data, error: requestError } = await supabase.functions.invoke('cancel-manual-checkout-claim', { body: { claimId: claim.id } })
      if (requestError || data?.status !== 'cancelled') throw new Error('Unable to cancel this purchase. Refresh your payment history and contact Hyperion if it is under review.')
      setCancelledIds(previous => [...previous, claim.id])
      onCancelled?.()
      if (replacementSelection) navigate('/checkout/qr?items=' + encodeURIComponent(replacementSelection))
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
          {open.filter(claim => claim.status === 'awaiting_proof').map((claim, index) => <div className="manual-checkout-cancel-row" key={claim.id}>
            <span id={`manual-checkout-claim-${claim.id}`}>{claim.items.map(item => `${item.label} (${durations[item.term]})`).join(', ')}</span>
            <div className="manual-checkout-actions">
              {showHistoryLink && index === 0 && <Link to="/orders">VIEW PAYMENT HISTORY</Link>}
              <button type="button" className="manual-checkout-switch-button" aria-describedby={`manual-checkout-claim-${claim.id}`} aria-expanded={switchingId === claim.id} disabled={Boolean(cancellingId)} onClick={() => { setSelectedDurations({}); setSwitchingId(current => current === claim.id ? null : claim.id) }}>
                SWITCH REVIEWER DURATION
              </button>
              <button type="button" className="manual-checkout-cancel-button" aria-describedby={`manual-checkout-claim-${claim.id}`} disabled={Boolean(cancellingId)} onClick={() => void cancel(claim)}>
                {cancellingId === claim.id ? 'CANCELLING…' : 'CANCEL PURCHASE'}
              </button>
            </div>
            {switchingId === claim.id && <div className="manual-checkout-duration-editor">
              {claim.items.map((item, itemIndex) => <label key={item.code}>{item.label} access duration
                <select autoFocus={requestedSwitchClaim === claim.id && itemIndex === 0} value={selectedDurations[item.code] ?? item.term} onChange={event => setSelectedDurations(current => ({ ...current, [item.code]: event.target.value as ManualCheckoutTerm }))}>
                  {termOptions.map(term => <option key={term} value={term}>{durations[term]}</option>)}
                </select>
              </label>)}
              <button type="button" className="manual-checkout-switch-button" disabled={Boolean(cancellingId) || !claim.items.some(item => (selectedDurations[item.code] ?? item.term) !== item.term)} onClick={() => void cancel(claim, claim.items.map(item => `${item.code}:${selectedDurations[item.code] ?? item.term}`).join(','))}>CONTINUE TO CHECKOUT</button>
            </div>}
          </div>)}
        </div>
      </>}
      {error && <p className="manual-checkout-cancel-error" role="alert">{error}</p>}
    </>}
    {showHistoryLink && !open.some(claim => claim.status === 'awaiting_proof') && <div className="manual-checkout-actions"><Link to="/orders">VIEW PAYMENT HISTORY</Link></div>}
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
