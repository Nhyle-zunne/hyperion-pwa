import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { usePracticeStore } from '../stores/practiceStore'
import { HISTORY_RETENTION_MS, useHistoryStore } from '../stores/historyStore'
import { useUIStore } from '../stores/uiStore'
import { getQuestionCountsByTrack, listAvailableCompetences } from '../lib/questionBank'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW', GMDSS_GOC: 'GMDSS GOC', ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Management', ENGINE_MGT: 'Engine Management'
}
const panel: CSSProperties = { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 0, padding: '1.1rem', marginBottom: '1rem' }
const sectionTitle: React.CSSProperties = { color: 'var(--accent)', fontSize: '.95rem', letterSpacing: '.07em', fontWeight: 900, margin: '0 0 1rem' }
const muted: React.CSSProperties = { color: 'var(--text-muted)' }
const smallButton: React.CSSProperties = { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text)', padding: '.6rem .7rem', fontWeight: 800, minHeight: 40 }

type ConfigSessionRow = {
  id: string
  kind: 'entry' | 'saved'
  mode: 'PRACTICE' | 'DRILL' | 'MOCK'
  track: TrackId
  competenceId: string | null
  part?: number | null
  timestamp: number
  deletedAt?: number
  completed: boolean
  correct: number
  total: number
  answered: number
  percent: number
}

export default function PracticeConfigScreen() {
  const navigate = useNavigate()
  const [params, setSearchParams] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'
  const freeMode = params.get('free') === '1'
  const isDrill = params.get('mode') === 'drill'
  const sessionMode = isDrill ? 'DRILL' : 'PRACTICE'
  const openPaywall = useUIStore(s => s.openPaywall)
  const isUnlocked = useLicenseStore(s => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const refreshCloudEntitlements = useLicenseStore(s => s.refreshCloudEntitlements)
  const startSession = usePracticeStore(s => s.startSession)
  const historyEntries = useHistoryStore(s => s.entries)
  const savedSessions = useHistoryStore(s => s.savedSessions)
  const saveSessionRecord = useHistoryStore(s => s.saveSession)
  const markSessionDeleted = useHistoryStore(s => s.markDeleted)
  const restoreSession = useHistoryStore(s => s.restoreDeleted)
  const permanentlyDeleteSession = useHistoryStore(s => s.permanentlyDelete)
  const purgeExpiredSessions = useHistoryStore(s => s.purgeExpiredDeleted)
  const competences = listAvailableCompetences(trackId)
  const competenceId = params.get('competence') || undefined
  const competence = competences.find(c => c.id === competenceId)
  const selectedPart = trackId === 'GMDSS_GOC' && competenceId ? Number(params.get('part') || '0') || undefined : undefined
  const gmdssParts = competenceId === 'C1' ? Array.from({ length: 10 }, (_, i) => i + 1) : competenceId === 'C2' ? [1, 2] : []
  const [availableQuestionCount, setAvailableQuestionCount] = useState(0)
  const [questionCountError, setQuestionCountError] = useState('')
  const [startItem, setStartItem] = useState(1)
  const [endItem, setEndItem] = useState(1)
  const [randomizeOrder, setRandomizeOrder] = useState(false)
  const [shuffleChoices, setShuffleChoices] = useState(true)
  const [prioritizeUnseen, setPrioritizeUnseen] = useState(false)
  const [intensiveMode, setIntensiveMode] = useState(false)
  const [starting, setStarting] = useState(false)
  const [startError, setStartError] = useState('')
  const [recentlyDeletedOpen, setRecentlyDeletedOpen] = useState(false)
  const [sessionPendingDelete, setSessionPendingDelete] = useState<ConfigSessionRow | null>(null)
  const [sessionPendingPermanentDelete, setSessionPendingPermanentDelete] = useState<ConfigSessionRow | null>(null)

  useEffect(() => { purgeExpiredSessions() }, [purgeExpiredSessions])

  // Migrate older one-slot localStorage progress into the session archive so
  // existing users can continue a session from History and this telemetry panel.
  useEffect(() => {
    try {
      const raw = localStorage.getItem('hyperion-saved-practice')
      if (!raw) return
      const legacy = JSON.parse(raw) as {
        sessionId?: string; questions?: unknown[]; answers?: Record<string, { selectedIndex?: number | null; isCorrect?: boolean }>
        track?: string; competenceId?: string | null; part?: number | null; mode?: string
        currentIndex?: number; startedAt?: number
      }
      const validTracks: TrackId[] = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT']
      if (!Array.isArray(legacy.questions) || !legacy.questions.length || !validTracks.includes(legacy.track as TrackId)) return
      if (!['PRACTICE', 'DRILL', 'MOCK'].includes(legacy.mode || '')) return
      const track = legacy.track as TrackId
      const mode = legacy.mode as 'PRACTICE' | 'DRILL' | 'MOCK'
      const competence = legacy.competenceId ?? null
      const matchingExisting = savedSessions.find(session =>
        session.track === track && session.competenceId === competence && session.mode === mode
      )
      const id = legacy.sessionId || matchingExisting?.id || `legacy-${track}-${competence ?? 'all'}-${mode}`
      if (!legacy.sessionId) {
        legacy.sessionId = id
        localStorage.setItem('hyperion-saved-practice', JSON.stringify(legacy))
      }
      if (savedSessions.some(session => session.id === id)) return
      const answers = legacy.answers ?? {}
      saveSessionRecord({
        id, mode, track, competenceId: competence, part: legacy.part ?? null,
        currentIndex: Math.max(0, legacy.currentIndex ?? 0),
        total: legacy.questions.length,
        answered: Object.values(answers).filter(answer => answer?.selectedIndex != null).length,
        correct: Object.values(answers).filter(answer => answer?.selectedIndex != null && answer?.isCorrect).length,
        startedAt: legacy.startedAt ?? Date.now(),
        savedAt: Date.now()
      })
    } catch { /* Ignore malformed or unavailable legacy progress. */ }
  }, [savedSessions, saveSessionRecord])

  const scopedSessionRows = useMemo<ConfigSessionRow[]>(() => {
    const completed: ConfigSessionRow[] = historyEntries
      .filter(entry => entry.track === trackId && (!competenceId || entry.competenceId === competenceId))
      .map(entry => ({
        id: entry.id, kind: 'entry', mode: entry.mode, track: entry.track,
        competenceId: entry.competenceId, part: entry.part, timestamp: entry.finishedAt,
        deletedAt: entry.deletedAt, completed: true, correct: entry.correct, total: entry.total,
        answered: entry.answered ?? entry.total, percent: entry.percent
      }))
    const saved: ConfigSessionRow[] = savedSessions
      .filter(entry => entry.track === trackId && (!competenceId || entry.competenceId === competenceId))
      .map(entry => ({
        id: entry.id, kind: 'saved', mode: entry.mode, track: entry.track,
        competenceId: entry.competenceId, part: entry.part, timestamp: entry.savedAt,
        deletedAt: entry.deletedAt, completed: false, correct: entry.correct ?? 0, total: entry.total,
        answered: entry.answered, percent: entry.answered > 0
          ? Math.round(((entry.correct ?? 0) / entry.answered) * 100) : 0
      }))
    return [...saved, ...completed].sort((a, b) => {
      if (a.completed !== b.completed) return a.completed ? 1 : -1
      return b.timestamp - a.timestamp
    })
  }, [historyEntries, savedSessions, trackId, competenceId])

  const recentSessions = scopedSessionRows.filter(session => !session.deletedAt).slice(0, 3)
  const recentlyDeletedSessions = scopedSessionRows
    .filter(session => session.deletedAt)
    .sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0))
  useEffect(() => {
    let cancelled = false
    async function load() {
      const restrictedToFreePool = freeMode || !isUnlocked
      setQuestionCountError('')
      try {
        const counts = await getQuestionCountsByTrack(trackId, restrictedToFreePool)
        if (cancelled) return
        const selected = counts.filter(item =>
          (!competenceId || item.competenceId === competenceId) &&
          (selectedPart == null || item.part === selectedPart)
        )
        const count = selected.reduce((sum, item) => sum + item.count, 0)
        setAvailableQuestionCount(count)
        setStartItem(1)
        setEndItem(Math.max(1, count))
        if (!count && !restrictedToFreePool) {
          setQuestionCountError('Protected question storage is not ready. An administrator must finish the one-time question-bank migration.')
        }
      } catch {
        if (cancelled) return
        setAvailableQuestionCount(0)
        setStartItem(1)
        setEndItem(1)
        setQuestionCountError(restrictedToFreePool
          ? 'The free question sample could not be loaded. Please try again.'
          : 'Could not verify the paid question bank. Please refresh or contact the administrator.')
      }
    }
    void load()
    return () => { cancelled = true }
  }, [trackId, competenceId, freeMode, isUnlocked, selectedPart])

  const maxRange = Math.max(1, availableQuestionCount)
  const actualStart = Math.max(1, Math.min(startItem, maxRange))
  const actualEnd = Math.max(actualStart, Math.min(endItem, maxRange))
  const itemCount = actualEnd - actualStart + 1
  const rangePresets = useMemo(() => [
    { label: '1–25', count: 25 }, { label: '1–50', count: 50 },
    { label: '1–100', count: 100 }, { label: `All (1–${maxRange})`, count: maxRange }
  ], [maxRange])

  const start = async () => {
    setStartError('')
    setStarting(true)
    try {
      // Re-check access at the action boundary instead of trusting a stale UI flag.
      await refreshCloudEntitlements()
      const entitlement = useLicenseStore.getState()
      const hasLicense = entitlement.entitlementsVerified && (
        entitlement.isAllAccessUnlocked ||
        entitlement.cloudTrackIds.includes('ALL') ||
        entitlement.isTrackUnlocked(trackId)
      )
      if (isDrill && (!hasLicense || freeMode)) {
        openPaywall('Drill')
        return
      }
      if (!freeMode && !hasLicense) {
        setSearchParams(current => {
          const next = new URLSearchParams(current)
          next.set('purchase', '1')
          next.set('purchase_term', next.get('purchase_term') || 'year')
          return next
        }, { replace: true })
        return
      }

      await startSession({
        mode: sessionMode, track: trackId, competenceId, limit: itemCount,
        startItem: actualStart, part: selectedPart, randomizeOrder: randomizeOrder || prioritizeUnseen,
        shuffleChoices, free: freeMode
      })
      const session = usePracticeStore.getState()
      if (session.error || session.loading || session.questions.length === 0) {
        setStartError(session.error || 'Questions could not be loaded for this session. Please retry.')
        return
      }
      navigate('/practice/quiz')
    } catch {
      setStartError('Could not verify access or load this session. Please try again.')
    } finally { setStarting(false) }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', minHeight: 58, padding: '.6rem .8rem', background: 'var(--bg-elevated)',
    color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 0, font: 'inherit', fontWeight: 800
  }
  const toggleRow = (title: string, description: string, value: boolean, setValue: (v: boolean) => void, badge: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '.75rem', alignItems: 'center', padding: '.75rem 0' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 900, color: 'var(--text)' }}>{title} <span style={{ color: value ? 'var(--accent)' : 'var(--text-muted)', fontSize: '.7rem', border: '1px solid currentColor', padding: '.2rem .35rem', whiteSpace: 'nowrap' }}>{value ? (title.startsWith('Shuffle') ? 'SHUFFLED' : 'ON') : badge}</span></div>
        <div style={{ ...muted, fontSize: '.83rem', lineHeight: 1.5, marginTop: '.25rem' }}>{description}</div>
      </div>
      <button type="button" role="switch" aria-checked={value} onClick={() => setValue(!value)} style={{ background: value ? 'var(--accent)' : 'var(--text-muted)', color: 'white', border: '1px solid #94a3b8', padding: '.45rem .6rem', fontWeight: 900, minWidth: 82 }}>{value ? 'ON  ▥' : '▥  OFF'}</button>
    </div>
  )

  return <div className="screen practice-config-screen" style={{ padding: '0 0 2rem', color: 'var(--text)' }}>
    <button type="button" onClick={() => navigate(competenceId ? `/practice/competences?track=${trackParam}${freeMode ? '&free=1' : ''}` : `/track?track=${trackParam}`)} style={{ ...muted, marginBottom: '.8rem', padding: '.4rem 0' }}>← Back</button>
    <div style={{ ...panel, borderTop: '3px solid #00e5a0', background: 'var(--bg-elevated)', marginBottom: '1.2rem' }}>
      <div style={{ ...muted, background: 'var(--accent-soft)', color: 'var(--text)', display: 'inline-block', padding: '.2rem .5rem', fontWeight: 900, letterSpacing: '.12em', fontSize: '.75rem' }}>STEP 2 OF 2 · {freeMode ? 'FREE REVIEWER' : isDrill ? 'DRILL CONFIGURATION' : 'PRACTICE ALL QUESTIONS'}</div>
      <h1 style={{ fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 900, margin: '.65rem 0 .25rem' }}>{freeMode ? `${TRACK_LABELS[trackId]} Free Reviewer` : isDrill ? 'Configure Drill' : 'Configure Practice: ' + (competence ? competence.label : TRACK_LABELS[trackId])}</h1>
      <div style={{ color: 'var(--accent)', fontWeight: 900, lineHeight: 1.5 }}>{competence ? `${competenceId} · ${availableQuestionCount} Items` : `${TRACK_LABELS[trackId]} · ${availableQuestionCount} Items`}</div>
      <div style={{ ...muted, fontWeight: 650, lineHeight: 1.5, marginTop: '.25rem' }}>{competence?.label || 'Questions from the selected track, using the available question pool.'}</div>
    </div>

    <section style={{ ...panel, background: 'var(--bg-elevated)', padding: '.65rem' }} data-testid="session-telemetry">
      <div style={{ display: 'flex', alignItems: 'center', gap: '.45rem', color: 'var(--text-muted)', fontWeight: 900, letterSpacing: '.05em', fontSize: '.78rem' }}>
        <span style={{ width: 8, height: 8, display: 'inline-block', background: recentSessions.some(session => !session.completed) ? 'var(--success)' : 'var(--text-muted)' }} />
        SESSION LOG &amp; TELEMETRY
      </div>
      <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '.45rem 0 .55rem' }}>
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, fontSize: '.7rem', fontWeight: 900, letterSpacing: '.04em' }}>
          {recentSessions.some(session => !session.completed) && <span style={{ color: 'var(--success)' }}>RESUME</span>}
          <button type="button" onClick={() => setRecentlyDeletedOpen(true)} style={{ color: 'var(--accent)', background: 'transparent', border: 0, padding: 0, fontWeight: 900, cursor: 'pointer' }}>RECENTLY DELETED{recentlyDeletedSessions.length ? ' (' + recentlyDeletedSessions.length + ')' : ''}</button>
          <button type="button" onClick={() => navigate('/history')} style={{ color: 'var(--accent)', background: 'transparent', border: 0, padding: 0, fontWeight: 900, cursor: 'pointer' }}>ARCHIVE »</button>
        </div>
        <span style={{ ...muted, fontSize: '.72rem' }}>LATEST 3 · {competenceId ? 'THIS COMPETENCE' : 'THIS TRACK'}</span>
      </div>

      {recentSessions.length ? (
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', background: 'var(--bg-card)' }}>
          <div role="table" aria-label="Recent session log" style={{ minWidth: 440 }}>
            <div role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(115px,1fr) 56px 62px 74px 38px', alignItems: 'stretch', background: 'var(--bg-elevated)', borderBottom: '1px solid var(--border)' }}>
              {['SESSION', 'PASSING', 'PROGRESS', 'ACTION', 'DEL'].map(label => <div key={label} role="columnheader" style={{ padding: '.4rem .25rem', fontSize: '.62rem', fontWeight: 900, color: 'var(--text-muted)', textAlign: label === 'SESSION' ? 'left' : 'center', borderRight: '1px solid var(--border)' }}>{label}</div>)}
            </div>
            {recentSessions.map((session, index) => {
              const passColor = session.percent >= 70 ? 'var(--success, #15803d)' : 'var(--danger, #dc2626)'
              const label = (session.competenceId || 'ALL COMPETENCES') + (session.part ? ' P' + session.part : '')
              return <div key={session.kind + ':' + session.id} role="row" style={{ display: 'grid', gridTemplateColumns: 'minmax(115px,1fr) 56px 62px 74px 38px', alignItems: 'stretch', background: index % 2 === 0 ? 'var(--bg-card)' : 'var(--bg-elevated)', borderBottom: index < recentSessions.length - 1 ? '1px solid var(--border)' : 0 }}>
                <div role="cell" style={{ minWidth: 0, padding: '.35rem .3rem', borderRight: '1px solid var(--border)' }}>
                  <div style={{ fontSize: '.68rem', fontWeight: 900, color: 'var(--text)', overflowWrap: 'anywhere' }}>{label}</div>
                  <div style={{ fontSize: '.62rem', color: 'var(--text-muted)', marginTop: 2 }}>{new Date(session.timestamp).toLocaleString(undefined, { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</div>
                  <div style={{ fontSize: '.6rem', color: 'var(--text-muted)' }}>{session.mode === 'MOCK' ? 'MOCK EXAM' : session.mode}</div>
                </div>
                <div role="cell" style={{ display: 'grid', placeItems: 'center', padding: '.25rem .1rem', borderRight: '1px solid var(--border)', color: passColor, fontSize: '.68rem', fontWeight: 900 }}>{session.percent.toFixed(1)}%</div>
                <div role="cell" style={{ display: 'grid', placeItems: 'center', padding: '.25rem .1rem', borderRight: '1px solid var(--border)', color: 'var(--text)', fontSize: '.68rem', fontWeight: 800 }}>{session.answered}/{session.total}</div>
                <div role="cell" style={{ display: 'grid', placeItems: 'center', padding: '.2rem', borderRight: '1px solid var(--border)' }}>
                  <button type="button" onClick={() => session.completed ? navigate('/history?review=' + encodeURIComponent(session.id)) : navigate('/practice/quiz?resume=' + encodeURIComponent(session.id))} style={{ border: 0, padding: '.25rem .1rem', background: 'transparent', color: session.completed ? 'var(--accent)' : 'var(--success, #15803d)', fontSize: '.62rem', fontWeight: 900, cursor: 'pointer', whiteSpace: 'nowrap' }}>{session.completed ? 'REVIEW »' : 'RESUME »'}</button>
                </div>
                <div role="cell" style={{ display: 'grid', placeItems: 'center', padding: '.1rem' }}>
                  <button type="button" aria-label="Move session to Recently Deleted" onClick={() => setSessionPendingDelete(session)} style={{ border: 0, background: 'transparent', color: 'var(--text-muted)', fontWeight: 900, fontSize: '1rem', cursor: 'pointer', minWidth: 28 }}>×</button>
                </div>
              </div>
            })}
          </div>
        </div>
      ) : (
        <div style={{ border: '1px solid var(--border)', background: 'var(--bg-card)', padding: '.8rem', fontSize: '.74rem', lineHeight: 1.6 }}>
          <strong style={{ display: 'block', color: 'var(--text-muted)', fontSize: '.7rem', letterSpacing: '.03em' }}>NO SESSIONS RECORDED FOR THIS COMPETENCE</strong>
          <span style={muted}>Active and completed sessions for this competence are preserved here automatically.</span>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '.5rem' }}><button type="button" onClick={() => navigate('/history')} style={{ color: 'var(--accent)', background: 'transparent', border: 0, fontWeight: 900, cursor: 'pointer' }}>OPEN SESSION LOG ARCHIVE »</button></div>
        </div>
      )}
    </section>

    {sessionPendingDelete && <div role="presentation" onClick={() => setSessionPendingDelete(null)} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <section role="dialog" aria-modal="true" aria-labelledby="config-delete-session-title" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 420px)', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: 10, padding: '1rem' }}>
        <h2 id="config-delete-session-title" style={{ marginTop: 0, fontSize: '1.1rem' }}>Delete session log?</h2>
        <p style={{ ...muted, fontSize: '.88rem', lineHeight: 1.5 }}>This session will move to Recently Deleted and can be restored for 3 days.</p>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setSessionPendingDelete(null)}>Cancel</button>
          <button type="button" className="btn btn-primary" style={{ flex: 1 }} onClick={() => { markSessionDeleted(sessionPendingDelete.kind, sessionPendingDelete.id); setSessionPendingDelete(null) }}>Move to Recently Deleted</button>
        </div>
      </section>
    </div>}

    {recentlyDeletedOpen && <div role="presentation" onClick={() => setRecentlyDeletedOpen(false)} style={{ position: 'fixed', inset: 0, zIndex: 1200, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <section role="dialog" aria-modal="true" aria-labelledby="config-recently-deleted-title" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 520px)', maxHeight: '85dvh', overflowY: 'auto', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: 10, padding: '1rem' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}><h2 id="config-recently-deleted-title" style={{ margin: 0, fontSize: '1.1rem' }}>Recently Deleted Sessions</h2><button type="button" className="btn btn-outline" onClick={() => setRecentlyDeletedOpen(false)}>Close</button></div>
        <p style={{ ...muted, fontSize: '.83rem' }}>Deleted sessions remain recoverable for 3 days.</p>
        {recentlyDeletedSessions.length ? <div style={{ display: 'grid', gap: '.6rem' }}>
          {recentlyDeletedSessions.map(session => {
            const days = Math.max(0, Math.ceil(((session.deletedAt ?? Date.now()) + HISTORY_RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)))
            return <div key={session.kind + ':' + session.id} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.7rem', display: 'flex', justifyContent: 'space-between', gap: 8, alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0 }}><strong style={{ fontSize: '.8rem' }}>{session.competenceId || 'ALL COMPETENCES'} · {session.mode}</strong><div style={{ ...muted, fontSize: '.72rem', marginTop: 3 }}>{new Date(session.timestamp).toLocaleString()} · Progress {session.answered}/{session.total}</div><div style={{ color: 'var(--warning, #c2410c)', fontSize: '.68rem', fontWeight: 900, marginTop: 3 }}>{days <= 0 ? 'EXPIRES TODAY' : 'EXPIRES IN ' + days + (days === 1 ? ' DAY' : ' DAYS')}</div></div>
              <div style={{ display: 'grid', gap: 5, flexShrink: 0 }}><button type="button" className="btn btn-primary" style={{ padding: '.35rem .5rem' }} onClick={() => restoreSession(session.kind, session.id)}>Restore</button><button type="button" className="btn btn-outline" style={{ padding: '.35rem .5rem', color: 'var(--danger)' }} onClick={() => setSessionPendingPermanentDelete(session)}>Delete forever</button></div>
            </div>
          })}
        </div> : <p style={muted}>No recently deleted sessions for this track and competence.</p>}
      </section>
    </div>}

    {sessionPendingPermanentDelete && <div role="presentation" onClick={() => setSessionPendingPermanentDelete(null)} style={{ position: 'fixed', inset: 0, zIndex: 1300, background: 'rgba(0,0,0,.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem' }}>
      <section role="dialog" aria-modal="true" aria-labelledby="config-permanent-delete-title" onClick={event => event.stopPropagation()} style={{ width: 'min(100%, 420px)', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderTop: '3px solid var(--danger)', borderRadius: 10, padding: '1rem' }}>
        <h2 id="config-permanent-delete-title" style={{ marginTop: 0, fontSize: '1.1rem' }}>Permanently delete session?</h2>
        <p style={{ ...muted, fontSize: '.88rem', lineHeight: 1.5 }}>This action cannot be undone.</p>
        <div style={{ display: 'flex', gap: 8 }}><button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => setSessionPendingPermanentDelete(null)}>Cancel</button><button type="button" className="btn btn-primary" style={{ flex: 1, color: 'var(--danger)' }} onClick={() => { permanentlyDeleteSession(sessionPendingPermanentDelete.kind, sessionPendingPermanentDelete.id); setSessionPendingPermanentDelete(null) }}>Permanently Delete</button></div>
      </section>
    </div>}

    {trackId === 'GMDSS_GOC' && competenceId && gmdssParts.length > 0 && <section style={panel}>
      <h2 style={sectionTitle}>SELECT QUESTION PART</h2>
      <p style={{ ...muted, lineHeight: 1.5, marginTop: 0 }}>This competence is divided into separate question-bank parts. Choose a part to limit this session to those questions, or choose all parts.</p>
      <select aria-label="GMDSS question part" value={selectedPart ?? 'all'} onChange={e => {
        const next = new URLSearchParams(params)
        if (e.target.value === 'all') next.delete('part')
        else next.set('part', e.target.value)
        setSearchParams(next)
      }} style={{ ...fieldStyle, minHeight: 52 }}>
        <option value="all">All parts · full available pool</option>
        {gmdssParts.map(part => <option key={part} value={part}>Part {part}</option>)}
      </select>
      <div style={{ ...muted, fontSize: '.82rem', marginTop: '.65rem' }}>Available in selection: <strong style={{ color: '#22c55e' }}>{availableQuestionCount.toLocaleString()} questions</strong></div>
    </section>}

    <section style={panel}>
      <h2 style={sectionTitle}>♟ 1. DRILL DELIVERY FORMAT</h2>
      <button
        type="button"
        aria-pressed={!intensiveMode}
        onClick={() => setIntensiveMode(false)}
        style={{
          width: '100%', textAlign: 'left',
          background: !intensiveMode ? 'var(--accent)' : 'var(--bg-card)',
          color: !intensiveMode ? '#ffffff' : 'var(--text)',
          border: `2px solid ${!intensiveMode ? 'var(--accent)' : 'var(--border)'}`,
          padding: '.85rem', marginBottom: '.7rem', transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease'
        }}
      >
        <div style={{ fontWeight: 900, fontSize: '1rem', color: !intensiveMode ? '#ffffff' : 'var(--text)' }}>
          Standard Drill <span style={{ float: 'right', color: !intensiveMode ? '#ffffff' : 'var(--text-muted)', fontSize: '.7rem' }}>FIXED ITEMS</span>
        </div>
        <div style={{ color: !intensiveMode ? 'rgba(255,255,255,.94)' : 'var(--text-muted)', lineHeight: 1.5, marginTop: '.4rem' }}>
          Progress through each question once with immediate answer verification. Concludes with a session summary.
        </div>
      </button>
      <button
        type="button"
        aria-pressed={intensiveMode}
        onClick={() => setIntensiveMode(true)}
        style={{
          width: '100%', textAlign: 'left',
          background: intensiveMode ? 'var(--accent)' : 'var(--bg-card)',
          color: intensiveMode ? '#ffffff' : 'var(--text)',
          border: `2px solid ${intensiveMode ? 'var(--accent)' : 'var(--border)'}`,
          padding: '.85rem', transition: 'background 150ms ease, border-color 150ms ease, color 150ms ease'
        }}
      >
        <div style={{ fontWeight: 900, fontSize: '1rem', color: intensiveMode ? '#ffffff' : 'var(--text)' }}>
          Intensive Mode <span style={{ float: 'right', color: intensiveMode ? '#ffffff' : 'var(--text-muted)', fontSize: '.7rem' }}>RECYCLING QUEUE</span>
        </div>
        <div style={{ color: intensiveMode ? 'rgba(255,255,255,.94)' : 'var(--text-muted)', lineHeight: 1.5, marginTop: '.4rem' }}>
          Missed questions recycle to the end of the queue. The drill only finishes when all questions are mastered.
        </div>
      </button>
      {intensiveMode && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Intensive mode selection is visual only until the review queue behavior is implemented.</p>}
    </section>

    <section style={panel}>
      <h2 style={sectionTitle}>⚒ 2. RANDOMIZATION & SEQUENCING</h2>
      {toggleRow('Randomize Question Order', 'Off follows the original question database order (#1, #2, #3…).', randomizeOrder, setRandomizeOrder, 'SEQUENTIAL')}
      {toggleRow('Shuffle Choices (A/B/C/D)', 'Permutes option letters to prevent letter memorization while preserving correct answer keys.', shuffleChoices, setShuffleChoices, 'ORDERED')}
      {toggleRow('Prioritize Unseen Items', 'Serve unseen questions first to improve question bank coverage.', prioritizeUnseen, setPrioritizeUnseen, 'DEFAULT')}
    </section>

    <section style={panel}>
      <h2 style={sectionTitle}>☷ 3. QUESTION RANGE SELECTOR (#1 TO #{maxRange.toLocaleString()})</h2>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,minmax(0,1fr))', gap: '.4rem', marginBottom: '1.3rem' }}>
        {rangePresets.map(p => {
          const selected = startItem === 1 && endItem === Math.min(maxRange, p.count)
          return <button
            key={p.label}
            type="button"
            className="question-range-preset"
            aria-pressed={selected}
            onClick={() => { setStartItem(1); setEndItem(Math.min(maxRange, p.count)); }}
            style={{ ...smallButton, background: selected ? 'var(--accent)' : 'var(--bg-elevated)', color: selected ? '#ffffff' : 'var(--text)', fontSize: '.78rem', padding: '.45rem .2rem' }}
          >{p.label}</button>
        })}
      </div>
      <div className="question-range-dual" style={{ '--range-start': `${((actualStart - 1) / Math.max(1, maxRange - 1)) * 100}%`, '--range-end': `${((actualEnd - 1) / Math.max(1, maxRange - 1)) * 100}%` } as CSSProperties}>
        <div className="question-range-track" />
        <div className="question-range-selected" />
        <input aria-label="Question range start" className="question-range-thumb question-range-start" type="range" min={1} max={maxRange} value={actualStart} onChange={e => { const n = Math.min(Number(e.target.value), actualEnd); setStartItem(n); }} />
        <input aria-label="Question range end" className="question-range-thumb question-range-end" type="range" min={1} max={maxRange} value={actualEnd} onChange={e => { const n = Math.max(Number(e.target.value), actualStart); setEndItem(n); }} />
      </div>
      <div style={{ display: 'flex', justifyContent: 'space-between', ...muted, fontSize: '.78rem', fontWeight: 800, margin: '.4rem 0 1.2rem' }}><span>Item #{actualStart}</span><span style={{ color: '#22c55e', letterSpacing: '.08em' }}>Selected: {itemCount.toLocaleString()} items</span><span>Item #{actualEnd}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
        <label style={{ ...muted, fontWeight: 800, fontSize: '.8rem' }}>Start Item (#)<input type="number" min={1} max={actualEnd} value={actualStart} onChange={e => { const n = Math.max(1, Math.min(Number(e.target.value) || 1, actualEnd)); setStartItem(n); }} style={{ ...fieldStyle, display: 'block', marginTop: '.35rem' }} /></label>
        <label style={{ ...muted, fontWeight: 800, fontSize: '.8rem' }}>End Item (#)<input type="number" min={actualStart} max={maxRange} value={actualEnd} onChange={e => setEndItem(Math.max(actualStart, Math.min(Number(e.target.value) || actualStart, maxRange)))} style={{ ...fieldStyle, display: 'block', marginTop: '.35rem' }} /></label>
      </div>
      <div style={{ background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', padding: '.65rem .8rem', marginTop: '1rem', fontSize: '.82rem', fontWeight: 800 }}>Session Scope: <span style={{ color: '#22c55e' }}>Item #{actualStart} to #{actualEnd} ({itemCount.toLocaleString()} Questions)</span></div>
      {questionCountError && <p role="status" style={{ color: 'var(--danger)', fontSize: '.84rem', marginBottom: 0 }}>{questionCountError}</p>}
      {freeMode && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Free Reviewer pool: {availableQuestionCount.toLocaleString()} questions for this track and competence. The range is limited to this pool.</p>}
      {!freeMode && !isUnlocked && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Only the free sample is available until a key is activated.</p>}
    </section>

    {startError && <div role="alert" className="card" style={{ marginTop: '.75rem', borderColor: 'var(--warning, #c2410c)' }}>{startError}</div>}
    <button type="button" disabled={starting || availableQuestionCount === 0 || (!freeMode && !isUnlocked)} onClick={start} style={{ width: '100%', minHeight: 58, background: 'var(--accent)', color: 'var(--btn-primary-text)', border: 0, fontSize: '1.05rem', fontWeight: 900, padding: '.8rem', opacity: starting || availableQuestionCount === 0 ? .65 : 1 }}>
      ▶　{starting ? 'Preparing Questions…' : `Start Reviewing (${itemCount.toLocaleString()} Items: #${actualStart}–#${actualEnd})`}
    </button>
  </div>
}
