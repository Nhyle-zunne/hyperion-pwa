import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { withPageLoading } from '../lib/pageLoading'

type ProductCode = 'oic_nw' | 'gmdss' | 'engine_ew' | 'deck_mgt' | 'engine_mgt'
type LicenseTerm = 'week' | 'month' | 'year'
type LicenseStatus = 'active' | 'expired' | 'revoked' | 'none'
type LicenseRecord = {
  product_code: ProductCode
  track_id: string
  exists: boolean
  status: LicenseStatus
  license_term: LicenseTerm | null
  granted_at: string | null
  expires_at: string | null
  order_id: string | null
}
type ManagedUser = {
  id: string
  email: string
  display_name: string | null
  created_at: string
  licenses: Record<ProductCode, LicenseRecord>
}
type AuditRecord = {
  id: string
  user_email: string
  product_code: ProductCode
  track_id: string
  action: 'grant' | 'extend' | 'revoke'
  prior_status: string | null
  new_status: string
  prior_expires_at: string | null
  new_expires_at: string | null
  license_term: LicenseTerm | null
  admin_email: string
  note: string | null
  created_at: string
}
const TRACKS: { code: ProductCode; label: string }[] = [
  { code: 'oic_nw', label: 'Deck OIC-NW' },
  { code: 'gmdss', label: 'GMDSS GOC' },
  { code: 'engine_ew', label: 'Engine OIC-EW' },
  { code: 'deck_mgt', label: 'Deck Management' },
  { code: 'engine_mgt', label: 'Engine Management' }
]
const TERM_OPTIONS: { value: LicenseTerm; label: string }[] = [
  { value: 'week', label: '1 Week' },
  { value: 'month', label: '1 Month' },
  { value: 'year', label: '1 Year' }
]
const TERM_LABEL: Record<LicenseTerm, string> = { week: 'Weekly', month: 'Monthly', year: 'Yearly' }
const STATUS_LABEL: Record<LicenseStatus, string> = { active: 'ACTIVE', expired: 'EXPIRED', revoked: 'REVOKED', none: 'NOT LICENSED' }
function dateLabel(value: string | null) {
  if (!value) return 'No expiry recorded'
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? 'Unknown expiry' : date.toLocaleString()
}
function safeMessage(error: unknown) {
  const value = error instanceof Error ? error.message : ''
  return !value || /supabase|postgrest|postgres|sqlstate|edge function|jwt|fetch failed|row[- ]level security/i.test(value)
    ? 'License administration is temporarily unavailable. Please refresh and try again.'
    : value
}
export default function AdminLicensesScreen() {
  const navigate = useNavigate()
  const [users, setUsers] = useState<ManagedUser[]>([])
  const [selectedUserId, setSelectedUserId] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState<'users' | 'activity'>('users')
  const [audit, setAudit] = useState<AuditRecord[]>([])
  const [query, setQuery] = useState('')
  const [userSort, setUserSort] = useState<'name-asc' | 'joined-desc' | 'joined-asc'>('name-asc')
  const [activeLicenseOnly, setActiveLicenseOnly] = useState(false)
  const [terms, setTerms] = useState<Record<string, LicenseTerm>>({})
  const [notes, setNotes] = useState<Record<string, string>>({})
  const [busyKey, setBusyKey] = useState('')
  const [loading, setLoading] = useState(true)
  const [authorized, setAuthorized] = useState(false)
  const [message, setMessage] = useState('')
  const [auditWarning, setAuditWarning] = useState('')
  const call = useCallback(async (body: Record<string, unknown>) => {
    if (!supabase) throw new Error('License administration is not configured.')
    const { data, error } = await supabase.functions.invoke('admin-license-management', { body })
    if (error) throw error
    if (data?.error) throw new Error(data.error)
    return data
  }, [])
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const result = await call({ action: 'list' })
      setUsers(Array.isArray(result.users) ? result.users : [])
      setAudit(Array.isArray(result.audit) ? result.audit : [])
      setAuditWarning(result.auditWarning || '')
      setAuthorized(true)
    } catch (error) {
      setAuthorized(false)
      setMessage(safeMessage(error))
    } finally {
      setLoading(false)
    }
  }, [call])
  useEffect(() => { void withPageLoading('Loading license administration', () => load()) }, [load])
  const filteredUsers = useMemo(() => {
    const value = query.trim().toLowerCase()
    const matching = users.filter(user => {
      const matchesSearch = !value || (user.email + ' ' + (user.display_name || '') + ' ' + user.id).toLowerCase().includes(value)
      const hasActiveLicense = Object.values(user.licenses || {}).some(license => license?.status === 'active')
      return matchesSearch && (!activeLicenseOnly || hasActiveLicense)
    })

    return matching.sort((a, b) => {
      if (userSort === 'joined-desc' || userSort === 'joined-asc') {
        const aDate = Date.parse(a.created_at) || 0
        const bDate = Date.parse(b.created_at) || 0
        const delta = userSort === 'joined-desc' ? bDate - aDate : aDate - bDate
        if (delta !== 0) return delta
      }

      const nameOrder = (a.display_name || '').localeCompare(b.display_name || '', undefined, { sensitivity: 'base' })
      return nameOrder || (a.email || '').localeCompare(b.email || '', undefined, { sensitivity: 'base' })
    })
  }, [users, query, userSort, activeLicenseOnly])
  const totals = useMemo(() => {
    const counts = { active: 0, expired: 0, revoked: 0, none: 0 }
    for (const user of users) for (const track of TRACKS) counts[user.licenses[track.code]?.status || 'none']++
    return counts
  }, [users])
  const statusStyle = (status: LicenseStatus): React.CSSProperties => ({
    display: 'inline-flex', alignItems: 'center', padding: '.25rem .4rem',
    border: '1px solid ' + (status === 'active' ? 'var(--success, #15803d)' : status === 'revoked' ? 'var(--danger, #b91c1c)' : 'var(--border)'),
    color: status === 'active' ? 'var(--success, #15803d)' : status === 'revoked' ? 'var(--danger, #b91c1c)' : 'var(--text-muted)',
    background: 'var(--bg-elevated)', fontSize: '.68rem', fontWeight: 900, letterSpacing: '.03em'
  })
  const grant = async (user: ManagedUser, track: typeof TRACKS[number]) => {
    const key = user.id + ':' + track.code
    const license = user.licenses[track.code]
    const term = terms[key] || 'month'
    const verb = license.status === 'active' ? 'extend' : 'activate'
    const baseText = license.status === 'active' ? 'The new term will be added after the current expiry date.' : 'The selected term will begin now.'
    if (!window.confirm(verb.toUpperCase() + ' ' + track.label + ' for ' + user.email + ' for ' + TERM_LABEL[term] + '? ' + baseText)) return
    setBusyKey(key)
    setMessage('')
    try {
      const result = await withPageLoading('Updating license', () => call({ action: 'grant', userId: user.id, productCode: track.code, term, note: notes[key] || '' }))
      setMessage(track.label + ' license updated for ' + user.email + '. Expires ' + dateLabel(result.expiresAt) + (result.warning ? ' Warning: ' + result.warning : ''))
      await load()
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusyKey('')
    }
  }
  const revoke = async (user: ManagedUser, track: typeof TRACKS[number]) => {
    const key = user.id + ':' + track.code
    if (!window.confirm('Revoke ' + track.label + ' access for ' + user.email + '? The payment record will not be changed.')) return
    setBusyKey(key)
    setMessage('')
    try {
      const result = await withPageLoading('Revoking license', () => call({ action: 'revoke', userId: user.id, productCode: track.code, note: notes[key] || '' }))
      setMessage(track.label + ' access revoked for ' + user.email + (result.warning ? ' Warning: ' + result.warning : ''))
      await load()
    } catch (error) {
      setMessage(safeMessage(error))
    } finally {
      setBusyKey('')
    }
  }
  const card: React.CSSProperties = {
    background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 10,
    padding: '1rem', marginBottom: '1rem', minWidth: 0
  }
  const field: React.CSSProperties = {
    width: '100%', boxSizing: 'border-box', padding: '.65rem .7rem', marginTop: '.3rem',
    background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)',
    borderRadius: 6, font: 'inherit', minHeight: 40
  }
  return <div className="screen" style={{ width: 'min(calc(100% - 1rem), 1180px)', maxWidth: 1180, margin: '0 auto', paddingBottom: '2rem' }}>
    <style>{`
      .admin-user-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:.5rem}
      .admin-user-card{display:block;width:100%;min-width:0;text-align:left;background:var(--bg-card);border:1px solid var(--border);border-radius:8px;padding:.7rem .8rem;color:var(--text);cursor:pointer}
      .admin-user-card:hover{border-color:var(--accent);background:var(--bg-elevated)}
      .admin-license-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:.65rem}
      .admin-license-tile{border:1px solid var(--border);padding:.7rem;min-width:0;background:var(--bg-card)}
      .admin-license-tile button{min-height:38px}
      .admin-license-modal{width:min(100%,900px);max-height:90dvh;overflow:hidden;display:flex;flex-direction:column;background:var(--bg-card);color:var(--text);border:1px solid var(--border);border-top:3px solid var(--accent);border-radius:12px;box-shadow:0 24px 70px rgba(0,0,0,.4)}
      .admin-license-modal-body{overflow:auto;padding:1rem}
      @media(max-width:900px){.admin-user-grid{grid-template-columns:repeat(2,minmax(0,1fr))}}
      @media(max-width:760px){.admin-license-grid{grid-template-columns:1fr}.admin-license-modal{max-height:92dvh}.admin-license-modal-body{padding:.7rem}}
      @media(max-width:520px){.admin-user-grid{grid-template-columns:1fr}}
    `}</style>
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap', marginBottom: '.8rem' }}>
      <button type="button" onClick={() => navigate('/account')} style={{ color: 'var(--text-muted)' }}>← Account</button>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn btn-primary" onClick={() => navigate('/admin/licenses')}>USER LICENSES</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/payments')}>PAYMENT SUBMISSIONS</button>
        <button type="button" className="btn btn-outline" onClick={() => navigate('/admin/questions')}>QUESTION BANK</button>
      </div>
    </div>
    <h1 className="page-title" style={{ textAlign: 'left' }}>User License Management</h1>
    <p className="subtitle">Manage every registered Hyperion account and its track access. Manual changes apply immediately and are recorded separately from payment submissions.</p>
    {message && <div role="status" aria-live="polite" style={{ ...card, borderColor: /Warning:/i.test(message) ? 'var(--warning, #c2410c)' : 'var(--border)' }}>{message}</div>}
    {!authorized ? <section style={card}>
      <p>{loading ? 'Loading accounts and license statuses…' : 'The user-license dashboard could not load. Confirm that you are signed in with an email listed in the server-side ADMIN_EMAILS secret.'}</p>
      <button type="button" className="btn btn-outline" disabled={loading} onClick={() => { setMessage(''); void load() }}>Retry</button>
    </section> : <>
      <section style={{ ...card, background: 'var(--bg-elevated)' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '.5rem' }}>
          {[
            ['USERS', users.length],
            ['ACTIVE TRACK LICENSES', totals.active],
            ['EXPIRED', totals.expired],
            ['REVOKED', totals.revoked]
          ].map(([label, value]) => <div key={label} style={{ minWidth: 0, border: '1px solid var(--border)', background: 'var(--bg-card)', padding: '.65rem' }}>
            <div style={{ fontWeight: 900, fontSize: '1.2rem' }}>{value}</div>
            <div style={{ fontSize: '.62rem', fontWeight: 850, color: 'var(--text-muted)', overflowWrap: 'anywhere' }}>{label}</div>
          </div>)}
        </div>
      </section>
      <div role="tablist" aria-label="License administration sections" style={{ display: 'flex', gap: 6, borderBottom: '1px solid var(--border)', marginBottom: '1rem', overflowX: 'auto' }}>
        <button
          type="button"
          role="tab"
          id="admin-license-users-tab"
          aria-selected={activeTab === 'users'}
          aria-controls="admin-license-users-panel"
          onClick={() => { setActiveTab('users'); setSelectedUserId(null) }}
          style={{ flex: '1 0 160px', padding: '.8rem .9rem', border: '1px solid var(--border)', borderBottom: activeTab === 'users' ? '3px solid var(--accent)' : '1px solid var(--border)', background: activeTab === 'users' ? 'var(--bg-card)' : 'var(--bg-elevated)', color: 'var(--text)', fontWeight: 900, cursor: 'pointer', textAlign: 'center' }}
        >REGISTERED USERS ({users.length})</button>
        <button
          type="button"
          role="tab"
          id="admin-license-activity-tab"
          aria-selected={activeTab === 'activity'}
          aria-controls="admin-license-activity-panel"
          onClick={() => { setActiveTab('activity'); setSelectedUserId(null) }}
          style={{ flex: '1 0 190px', padding: '.8rem .9rem', border: '1px solid var(--border)', borderBottom: activeTab === 'activity' ? '3px solid var(--accent)' : '1px solid var(--border)', background: activeTab === 'activity' ? 'var(--bg-card)' : 'var(--bg-elevated)', color: 'var(--text)', fontWeight: 900, cursor: 'pointer', textAlign: 'center' }}
        >ADMIN LICENSE ACTIVITY ({audit.length})</button>
      </div>
      {activeTab === 'users' && <div id="admin-license-users-panel" role="tabpanel" aria-labelledby="admin-license-users-tab">
      <label style={{ display: 'block', marginBottom: '1rem', color: 'var(--text-muted)', fontWeight: 800 }}>SEARCH USERS BY NAME, EMAIL, OR USER ID
        <input value={query} onChange={event => setQuery(event.target.value)} placeholder="Type an email, name, or user ID…" style={field} />
      </label>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap', marginBottom: '.7rem' }}>
        <h2 style={{ margin: 0, fontSize: '1rem' }}>{activeLicenseOnly ? 'Users with active licenses' : 'Registered users'} ({filteredUsers.length})</h2>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap', flex: '1 1 560px' }}>
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 7, color: 'var(--text-muted)', fontSize: '.8rem', fontWeight: 800 }}>
            SORT
            <select aria-label="Sort users" value={userSort} onChange={event => setUserSort(event.target.value as typeof userSort)} style={{ ...field, width: 'auto', minWidth: 180, margin: 0, padding: '.55rem .65rem', fontSize: '.82rem' }}>
              <option value="name-asc">Alphabetical (A–Z)</option>
              <option value="joined-desc">Date joined (newest first)</option>
              <option value="joined-asc">Date joined (oldest first)</option>
            </select>
          </label>
          <button
            type="button"
            className={activeLicenseOnly ? 'btn btn-primary' : 'btn btn-outline'}
            aria-pressed={activeLicenseOnly}
            onClick={() => { setActiveLicenseOnly(value => !value); setSelectedUserId(null) }}
            style={{ whiteSpace: 'nowrap' }}
          >
            {activeLicenseOnly ? '✓ Active licenses only' : 'Active licenses only'}
          </button>
          <button type="button" className="btn btn-outline" disabled={loading} onClick={() => void withPageLoading('Refreshing users and licenses', () => load())}>{loading ? 'Refreshing…' : 'Refresh users'}</button>
        </div>
      </div>
      {loading ? <section style={card}>Loading license records…</section> : filteredUsers.length ? (
        <div className="admin-user-grid">
          {filteredUsers.map(user => <button
            key={user.id}
            type="button"
            className="admin-user-card"
            onClick={() => setSelectedUserId(user.id)}
            aria-label={'Manage licenses for ' + (user.display_name || user.email || 'Hyperion user')}
          >
            <strong style={{ display: 'block', fontSize: '.9rem', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{user.display_name || 'Hyperion user'}</strong>
            <span style={{ display: 'block', marginTop: '.2rem', color: 'var(--text-muted)', fontSize: '.8rem', lineHeight: 1.35, overflowWrap: 'anywhere' }}>{user.email || '(email unavailable)'}</span>
          </button>)}
        </div>
      ) : <section style={card}>No registered users match this search.</section>}

      {selectedUserId && (() => {
        const user = users.find(item => item.id === selectedUserId)
        if (!user) return null
        return <div
          role="presentation"
          onClick={() => setSelectedUserId(null)}
          style={{ position: 'fixed', inset: 0, zIndex: 6000, display: 'grid', placeItems: 'center', padding: '1rem', background: 'rgba(3,8,18,.72)', boxSizing: 'border-box' }}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-labelledby="admin-license-modal-title"
            className="admin-license-modal"
            onClick={event => event.stopPropagation()}
          >
            <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12, padding: '1rem', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
              <div style={{ minWidth: 0 }}>
                <h2 id="admin-license-modal-title" style={{ margin: 0, fontSize: '1.15rem', overflowWrap: 'anywhere' }}>{user.display_name || 'Hyperion user'}</h2>
                <div style={{ marginTop: '.25rem', color: 'var(--text-muted)', fontSize: '.88rem', overflowWrap: 'anywhere' }}>{user.email || '(email unavailable)'}</div>
                <div style={{ marginTop: '.25rem', color: 'var(--text-muted)', fontSize: '.72rem' }}>Joined {dateLabel(user.created_at)}</div>
              </div>
              <button type="button" className="btn btn-outline" onClick={() => setSelectedUserId(null)} aria-label="Close user license details" style={{ flexShrink: 0 }}>CLOSE ✕</button>
            </header>
            <div className="admin-license-modal-body">
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 8, marginBottom: '.9rem' }}>
                <strong>LICENSES &amp; SUBSCRIPTIONS</strong>
                <details>
                  <summary style={{ cursor: 'pointer', color: 'var(--accent)', fontSize: '.75rem', fontWeight: 800 }}>USER ID</summary>
                  <code style={{ display: 'block', maxWidth: 360, overflowWrap: 'anywhere', fontSize: '.7rem', marginTop: '.3rem' }}>{user.id}</code>
                </details>
              </div>
              <div className="admin-license-grid">
                {TRACKS.map(track => {
                  const license = user.licenses[track.code]
                  const key = user.id + ':' + track.code
                  const term = terms[key] || 'month'
                  const busy = busyKey === key
                  return <div key={track.code} className="admin-license-tile">
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
                      <strong style={{ fontSize: '.85rem' }}>{track.label}</strong>
                      <span style={statusStyle(license.status)}>{STATUS_LABEL[license.status]}</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', lineHeight: 1.45, margin: '.45rem 0' }}>
                      {license.license_term ? TERM_LABEL[license.license_term] + ' · ' : ''}
                      {license.exists ? (license.expires_at ? 'Expires ' + dateLabel(license.expires_at) : 'No expiry recorded') : 'No license record'}
                    </div>
                    <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 800, color: 'var(--text-muted)' }}>DURATION TO GRANT
                      <select value={term} onChange={event => setTerms(old => ({ ...old, [key]: event.target.value as LicenseTerm }))} style={{ ...field, marginBottom: '.55rem' }}>
                        {TERM_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    </label>
                    <label style={{ display: 'block', fontSize: '.72rem', fontWeight: 800, color: 'var(--text-muted)' }}>ADMIN NOTE (OPTIONAL)
                      <input value={notes[key] || ''} onChange={event => setNotes(old => ({ ...old, [key]: event.target.value }))} placeholder="Reason for manual change" style={field} />
                    </label>
                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', marginTop: '.65rem' }}>
                      <button type="button" className="btn btn-primary" disabled={!!busyKey} onClick={() => void grant(user, track)} style={{ flex: '1 1 145px', fontSize: '.72rem' }}>{busy ? 'SAVING…' : license.status === 'active' ? 'EXTEND LICENSE' : 'ACTIVATE LICENSE'}</button>
                      {license.exists && license.status !== 'revoked' && <button type="button" className="btn btn-outline" disabled={!!busyKey} onClick={() => void revoke(user, track)} style={{ flex: '1 1 95px', borderColor: 'var(--danger, #b91c1c)', color: 'var(--danger, #b91c1c)', fontSize: '.72rem' }}>REVOKE</button>}
                    </div>
                  </div>
                })}
              </div>
            </div>
          </section>
        </div>
      })()}
      </div>}
      {activeTab === 'activity' && <section id="admin-license-activity-panel" role="tabpanel" aria-labelledby="admin-license-activity-tab" style={card}>
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Recent admin license activity</h2>
        <p style={{ color: 'var(--text-muted)', fontSize: '.8rem' }}>Manual activation, extension, and revocation actions are listed here independently from payment records.</p>
        {auditWarning && <p role="status" style={{ color: 'var(--warning, #c2410c)' }}>{auditWarning}</p>}
        {audit.length ? <div style={{ display: 'grid', gap: '.5rem' }}>
          {audit.map(item => <div key={item.id} style={{ padding: '.65rem', border: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>
            <strong style={{ fontSize: '.8rem' }}>{item.action.toUpperCase()} · {TRACKS.find(track => track.code === item.product_code)?.label || item.product_code}</strong>
            <div style={{ color: 'var(--text-muted)', fontSize: '.78rem', overflowWrap: 'anywhere', marginTop: '.2rem' }}>{item.user_email} · by {item.admin_email}</div>
            <div style={{ color: 'var(--text-muted)', fontSize: '.72rem', marginTop: '.2rem' }}>{dateLabel(item.created_at)}{item.new_expires_at ? ' · Expires ' + dateLabel(item.new_expires_at) : ''}{item.license_term ? ' · ' + TERM_LABEL[item.license_term] : ''}</div>
            {item.note && <div style={{ fontSize: '.75rem', marginTop: '.25rem' }}>Note: {item.note}</div>}
          </div>)}
        </div> : <p style={{ color: 'var(--text-muted)', fontSize: '.82rem' }}>No manual license changes have been recorded yet.</p>}
      </section>}
    </>}
  </div>
}
