import { useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate, useSearchParams } from 'react-router-dom'
import {
  HISTORY_RETENTION_MS,
  useHistoryStore,
  type HistoryEntry,
  type HistoryItemKind,
  type SavedSessionEntry,
  type SessionMode
} from '../stores/historyStore'
import { getSessionSnapshot, type SessionSnapshot } from '../lib/sessionArchive'
import { authorizeQuestionSet } from '../lib/questionBank'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import type { TrackId } from '../types/question'

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

const MODE_LABEL: Record<SessionMode, string> = {
  PRACTICE: 'Practice',
  DRILL: 'Drill',
  MOCK: 'Mock Exam'
}

type HistoryRow = {
  key: string
  kind: HistoryItemKind
  id: string
  mode: SessionMode
  track: TrackId
  competenceId: string | null
  part?: number | null
  timestamp: number
  deletedAt?: number
  isFreeSession?: boolean
  completed: boolean
  correct: number
  total: number
  answered: number
  percent: number
  durationMs: number
  entry?: HistoryEntry
  saved?: SavedSessionEntry
}

type ReviewState = {
  id: string
  snapshot: SessionSnapshot | null
  index: number
  tab: 'breakdown' | 'questions'
  missedOnly: boolean
}

function formatDate(ts: number) {
  if (!ts) return '—'
  try {
    return new Date(ts).toLocaleString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
      hour: '2-digit', minute: '2-digit'
    })
  } catch {
    return '—'
  }
}

function formatDuration(ms: number) {
  const sec = Math.floor(Math.max(0, ms) / 1000)
  if (sec < 60) return sec + 's'
  const m = Math.floor(sec / 60)
  const s = sec % 60
  if (m < 60) return m + 'm ' + s + 's'
  const h = Math.floor(m / 60)
  return h + 'h ' + (m % 60) + 'm'
}

function rowTitle(row: HistoryRow) {
  const track = TRACK_LABELS[row.track] || row.track
  const scope = row.competenceId ? ' · ' + row.competenceId + (row.part ? ' P' + row.part : '') : ''
  return (row.mode === 'MOCK' ? 'MOCK EXAM' : MODE_LABEL[row.mode].toUpperCase()) + ' · ' + track + scope
}

function getDayKey(timestamp: number) {
  const date = new Date(timestamp)
  return date.getFullYear() + '-' + (date.getMonth() + 1) + '-' + date.getDate()
}

function getPreviousDayKey(day: string) {
  const parts = day.split('-').map(Number)
  const date = new Date(parts[0], parts[1] - 1, parts[2], 12)
  date.setDate(date.getDate() - 1)
  return getDayKey(date.getTime())
}

function buildRows(entries: HistoryEntry[], savedSessions: SavedSessionEntry[]): HistoryRow[] {
  const completed: HistoryRow[] = entries.map(entry => ({
    key: 'entry:' + entry.id,
    kind: 'entry',
    id: entry.id,
    mode: entry.mode,
    track: entry.track,
    competenceId: entry.competenceId,
    part: entry.part,
    timestamp: entry.finishedAt,
    deletedAt: entry.deletedAt,
    isFreeSession: entry.isFreeSession === true,
    completed: true,
    correct: entry.correct,
    total: entry.total,
    answered: entry.answered ?? entry.total,
    percent: entry.percent,
    durationMs: entry.durationMs,
    entry
  }))
  const inProgress: HistoryRow[] = savedSessions.map(session => ({
    key: 'saved:' + session.id,
    kind: 'saved',
    id: session.id,
    mode: session.mode,
    track: session.track,
    competenceId: session.competenceId,
    part: session.part,
    timestamp: session.savedAt,
    deletedAt: session.deletedAt,
    isFreeSession: session.isFreeSession === true,
    completed: false,
    correct: session.correct ?? 0,
    total: session.total,
    answered: session.answered,
    percent: session.answered > 0 ? Math.round(((session.correct ?? 0) / session.answered) * 100) : 0,
    durationMs: Math.max(0, session.savedAt - (session.startedAt ?? session.savedAt)),
    saved: session
  }))
  return [...completed, ...inProgress]
}

export default function HistoryScreen() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const entries = useHistoryStore(state => state.entries)
  const savedSessions = useHistoryStore(state => state.savedSessions)
  const markDeleted = useHistoryStore(state => state.markDeleted)
  const restoreDeleted = useHistoryStore(state => state.restoreDeleted)
  const permanentlyDelete = useHistoryStore(state => state.permanentlyDelete)
  const clear = useHistoryStore(state => state.clear)
  const purgeExpiredDeleted = useHistoryStore(state => state.purgeExpiredDeleted)
  const refreshCloudEntitlements = useLicenseStore(state => state.refreshCloudEntitlements)
  const cloudTrackIds = useLicenseStore(state => state.cloudTrackIds)
  const entitlementsVerified = useLicenseStore(state => state.entitlementsVerified)
  const openPaywall = useUIStore(state => state.openPaywall)

  const [selectionMode, setSelectionMode] = useState(false)
  const [selectedKeys, setSelectedKeys] = useState<string[]>([])
  const [showRecentlyDeleted, setShowRecentlyDeleted] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<HistoryRow | null>(null)
  const [showClearConfirm, setShowClearConfirm] = useState(false)
  const [progressDetails, setProgressDetails] = useState<SavedSessionEntry | null>(null)
  const [review, setReview] = useState<ReviewState | null>(null)
  const skipNextClick = useRef(false)

  useEffect(() => { purgeExpiredDeleted() }, [purgeExpiredDeleted])

  const allRows = useMemo(() => buildRows(entries, savedSessions), [entries, savedSessions])
  const activeRows = useMemo(
    () => allRows.filter(row => !row.deletedAt).sort((a, b) => b.timestamp - a.timestamp),
    [allRows]
  )
  const deletedRows = useMemo(
    () => allRows.filter(row => row.deletedAt).sort((a, b) => (b.deletedAt ?? 0) - (a.deletedAt ?? 0)),
    [allRows]
  )
  const completedRows = useMemo(
    () => activeRows.filter(row => row.completed),
    [activeRows]
  )
  const passedCount = completedRows.filter(row => row.percent >= 70).length
  const avgPercent = completedRows.length
    ? Math.round(completedRows.reduce((sum, row) => sum + row.percent, 0) / completedRows.length)
    : 0
  const bestPercent = completedRows.length ? Math.max(...completedRows.map(row => row.percent)) : 0
  const byMode: Record<SessionMode, number> = { PRACTICE: 0, DRILL: 0, MOCK: 0 }
  for (const row of activeRows) byMode[row.mode]++

  const currentStreak = useMemo(() => {
    const dates = new Set(activeRows.map(row => getDayKey(row.timestamp)))
    if (!dates.size) return 0
    let cursor = getDayKey(Date.now())
    if (!dates.has(cursor)) cursor = getPreviousDayKey(cursor)
    let streak = 0
    while (dates.has(cursor)) {
      streak++
      cursor = getPreviousDayKey(cursor)
    }
    return streak
  }, [activeRows])

  const canOpenQuestionReview = async (row: HistoryRow, snapshot: SessionSnapshot | null) => {
    // If there is no saved question content, showing the score/metadata does not
    // disclose the bank. Never trust a locally editable isFreeSession flag.
    if (!snapshot?.questions?.length) return true
    await refreshCloudEntitlements()
    return authorizeQuestionSet(row.track, snapshot.questions)
  }

  const openReview = async (id: string) => {
    const row = allRows.find(item => item.id === id && item.kind === 'entry')
    if (!row) return
    const snapshot = await getSessionSnapshot(id)
    if (!await canOpenQuestionReview(row, snapshot)) {
      openPaywall('Reviewing these saved questions requires a current license, unless the questions belong to the free reviewer sample.')
      return
    }
    setReview({ id, snapshot, index: 0, tab: 'questions', missedOnly: false })
    const nextParams = new URLSearchParams(params)
    nextParams.set('review', id)
    setParams(nextParams, { replace: true })
  }

  useEffect(() => {
    const id = params.get('review')
    if (!id || review?.id === id) return
    const entry = entries.find(item => item.id === id && !item.deletedAt)
    if (!entry) return
    let cancelled = false
    void (async () => {
      const row: HistoryRow = {
        key: 'entry:' + id, kind: 'entry', id, mode: entry.mode, track: entry.track,
        competenceId: entry.competenceId, timestamp: entry.finishedAt, deletedAt: entry.deletedAt,
        completed: true, correct: entry.correct, total: entry.total, answered: entry.answered ?? entry.total,
        percent: entry.percent, durationMs: entry.durationMs, entry, isFreeSession: entry.isFreeSession === true
      }
      const snapshot = await getSessionSnapshot(id)
      const allowed = await canOpenQuestionReview(row, snapshot)
      if (cancelled) return
      if (!allowed) {
        openPaywall('Reviewing these saved questions requires a current license, unless the questions belong to the free reviewer sample.')
        const nextParams = new URLSearchParams(params)
        nextParams.delete('review')
        setParams(nextParams, { replace: true })
        return
      }
      if (!cancelled) setReview({ id, snapshot, index: 0, tab: 'questions', missedOnly: false })
    })()
    return () => { cancelled = true }
  }, [params, entries, review?.id, refreshCloudEntitlements, openPaywall])

  useEffect(() => {
    const snapshot = review?.snapshot
    if (!review || !snapshot?.questions?.length) return
    let cancelled = false
    void (async () => {
      const allowed = await authorizeQuestionSet(snapshot.track, snapshot.questions)
      if (cancelled || allowed) return
      setReview(null)
      const nextParams = new URLSearchParams(params)
      nextParams.delete('review')
      setParams(nextParams, { replace: true })
      openPaywall('This saved question review is no longer available without an active track license.')
    })()
    return () => { cancelled = true }
  }, [review?.id, review?.snapshot, cloudTrackIds, entitlementsVerified, params, setParams, openPaywall])

  const closeReview = () => {
    setReview(null)
    const nextParams = new URLSearchParams(params)
    nextParams.delete('review')
    setParams(nextParams, { replace: true })
  }

  const toggleSelected = (row: HistoryRow) => {
    setSelectedKeys(current => current.includes(row.key)
      ? current.filter(key => key !== row.key)
      : [...current, row.key])
  }

  const resumeSession = (session: SavedSessionEntry) => {
    navigate('/practice/quiz?resume=' + encodeURIComponent(session.id))
  }

  const requestDelete = (row: HistoryRow) => setPendingDelete(row)
  const confirmDelete = () => {
    if (pendingDelete) markDeleted(pendingDelete.kind, pendingDelete.id)
    setPendingDelete(null)
  }

  const toggleSelectionMode = () => {
    setSelectionMode(mode => !mode)
    setSelectedKeys([])
  }

  const deleteSelected = () => {
    selectedKeys.forEach(key => {
      const row = activeRows.find(item => item.key === key)
      if (row) markDeleted(row.kind, row.id)
    })
    setSelectedKeys([])
    setSelectionMode(false)
  }

  const chartRows = [...completedRows].sort((a, b) => a.timestamp - b.timestamp).slice(-20)
  const chartPoints = chartRows.map((row, index) => {
    const x = chartRows.length <= 1 ? 150 : 8 + index * (284 / (chartRows.length - 1))
    const y = 86 - (Math.max(0, Math.min(100, row.percent)) * 0.76)
    return x + ',' + y
  }).join(' ')

  const reviewEntry = review ? entries.find(entry => entry.id === review.id) : undefined
  const reviewQuestions = review?.snapshot?.questions ?? []
  const reviewAnswers = review?.snapshot?.answers ?? {}
  const filteredReviewQuestions = review && review.missedOnly
    ? reviewQuestions.filter(question => !reviewAnswers[question.id]?.isCorrect)
    : reviewQuestions
  const reviewIndex = Math.max(0, Math.min(review?.index ?? 0, Math.max(0, filteredReviewQuestions.length - 1)))
  const currentQuestion = filteredReviewQuestions[reviewIndex]
  const currentAnswer = currentQuestion ? reviewAnswers[currentQuestion.id] : undefined

  const competenceBreakdown = useMemo(() => {
    if (!review?.snapshot) return []
    const grouped = new Map<string, { total: number; correct: number }>()
    for (const question of review.snapshot.questions) {
      const current = grouped.get(question.competenceId) ?? { total: 0, correct: 0 }
      current.total++
      if (review.snapshot.answers[question.id]?.isCorrect) current.correct++
      grouped.set(question.competenceId, current)
    }
    return [...grouped.entries()].map(([id, result]) => ({
      id,
      total: result.total,
      correct: result.correct,
      percent: result.total ? Math.round((result.correct / result.total) * 100) : 0
    }))
  }, [review?.snapshot])

  const secondaryText: CSSProperties = { color: 'var(--text-muted)', fontSize: '.82rem', lineHeight: 1.5 }
  const modalBackdrop: CSSProperties = {
    position: 'fixed', inset: 0, zIndex: 1500, background: 'rgba(0,0,0,.72)',
    display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '1rem'
  }
  const modalStyle: CSSProperties = {
    width: 'min(100%, 680px)', maxHeight: '88dvh', overflowY: 'auto',
    background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)',
    borderTop: '3px solid var(--accent)', padding: '1rem', borderRadius: 10
  }

  return (
    <div className="screen" style={{ paddingBottom: '2rem' }}>
      {selectionMode ? (
        <header style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: '1rem', borderBottom: '3px solid var(--accent)', paddingBottom: '.75rem' }}>
          <div>
            <h1 className="page-title" style={{ margin: 0 }}>{selectedKeys.length} SELECTED</h1>
            <p className="subtitle" style={{ margin: '.2rem 0 0' }}>Choose the session logs to move to Recently Deleted.</p>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
            <button className="btn btn-outline" onClick={() => { setSelectedKeys(activeRows.map(row => row.key)) }}>Select all</button>
            <button className="btn btn-outline" onClick={toggleSelectionMode}>Cancel</button>
            <button className="btn btn-primary" disabled={!selectedKeys.length} onClick={deleteSelected} style={{ color: 'var(--danger)' }}>Delete selected</button>
          </div>
        </header>
      ) : (
        <>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap', marginBottom: '1rem' }}>
            <div>
              <h1 className="page-title" style={{ marginBottom: '.2rem' }}>SESSION LOG &amp; DIAGNOSTICS</h1>
              <p className="subtitle" style={{ margin: 0 }}>{activeRows.length} {activeRows.length === 1 ? 'LOG' : 'LOGS'} · completed attempts and in-progress sessions</p>
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              <button className="btn btn-outline" onClick={() => setShowRecentlyDeleted(true)}>Recently Deleted ({deletedRows.length})</button>
              <button className="btn btn-outline" onClick={toggleSelectionMode} disabled={!activeRows.length}>Select</button>
              <button className="btn btn-outline" onClick={() => setShowClearConfirm(true)} disabled={!activeRows.length} style={{ color: 'var(--danger)' }}>Clear all</button>
            </div>
          </div>

          <section className="card" style={{ marginBottom: '1rem', borderLeft: '4px solid var(--accent)', borderRadius: 10 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{ width: 42, height: 42, display: 'grid', placeItems: 'center', background: 'rgba(245,158,11,.15)', fontSize: '1.45rem' }}>🔥</div>
                <div>
                  <strong>{currentStreak} DAY STUDY STREAK</strong>
                  <div style={secondaryText}>{currentStreak ? 'Keep your daily review going.' : 'Complete a session today to start your streak.'}</div>
                </div>
              </div>
              <span style={{ fontWeight: 900, color: 'var(--accent)', whiteSpace: 'nowrap' }}>{currentStreak} DAYS</span>
            </div>
          </section>

          <section className="card" style={{ marginBottom: '1rem' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
              <strong>CUMULATIVE PERFORMANCE</strong>
              <span style={{ border: '1px solid var(--border)', padding: '.2rem .45rem', fontSize: '.78rem', fontWeight: 900 }}>
                {passedCount} / {completedRows.length} PASSED
              </span>
            </div>
            <div style={{ fontSize: '1.7rem', fontWeight: 900, marginTop: '.65rem', color: avgPercent >= 70 ? 'var(--success)' : 'var(--accent)' }}>
              AVERAGE SCORE: {avgPercent}%
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,minmax(0,1fr))', gap: '.5rem', marginTop: '.8rem' }}>
              <div style={{ background: 'var(--bg-elevated)', padding: '.65rem', borderRadius: 6 }}>
                <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{completedRows.length}</div><div style={secondaryText}>Completed</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '.65rem', borderRadius: 6 }}>
                <div style={{ fontWeight: 900, fontSize: '1.1rem', color: 'var(--success)' }}>{bestPercent}%</div><div style={secondaryText}>Best score</div>
              </div>
              <div style={{ background: 'var(--bg-elevated)', padding: '.65rem', borderRadius: 6 }}>
                <div style={{ fontWeight: 900, fontSize: '1.1rem' }}>{activeRows.filter(row => !row.completed).length}</div><div style={secondaryText}>In progress</div>
              </div>
            </div>
            {chartRows.length > 0 && (
              <div style={{ marginTop: '1rem' }}>
                <div style={{ ...secondaryText, fontWeight: 900, letterSpacing: '.08em', marginBottom: '.4rem' }}>TEST SCORES OVER TIME</div>
                <svg viewBox="0 0 300 100" role="img" aria-label="Completed session scores over time" style={{ width: '100%', height: 110, display: 'block', background: 'var(--bg-elevated)', borderRadius: 6 }}>
                  <line x1="5" y1="33" x2="295" y2="33" stroke="var(--text-muted)" strokeDasharray="4 4" strokeOpacity=".55" />
                  {chartRows.length > 1 && <polyline points={chartPoints} fill="none" stroke="var(--accent)" strokeWidth="2.5" />}
                  {chartRows.map((row, index) => {
                    const x = chartRows.length <= 1 ? 150 : 8 + index * (284 / (chartRows.length - 1))
                    const y = 86 - (Math.max(0, Math.min(100, row.percent)) * .76)
                    return <circle key={row.id} cx={x} cy={y} r="3.5" fill={row.percent >= 70 ? 'var(--success)' : 'var(--danger)'} />
                  })}
                </svg>
                <div style={{ ...secondaryText, textAlign: 'right', marginTop: '.2rem' }}>70% passing reference</div>
              </div>
            )}
            <div style={{ ...secondaryText, marginTop: '.75rem' }}>By mode: P {byMode.PRACTICE} · D {byMode.DRILL} · M {byMode.MOCK}</div>
          </section>

          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, margin: '1.2rem 0 .7rem' }}>
            <h2 style={{ fontSize: '1rem', fontWeight: 900, margin: 0 }}>EXAM ATTEMPTS (LONG PRESS TO SELECT)</h2>
            <button className="btn btn-outline" onClick={() => navigate(-1)}>Back</button>
          </div>
        </>
      )}

      {activeRows.length === 0 ? (
        <div className="card" style={{ textAlign: 'center', padding: '2rem 1rem' }}>
          <div style={{ fontSize: '2rem', color: 'var(--text-muted)', marginBottom: '.65rem' }}>◷</div>
          <strong>NO EXAM SESSIONS RECORDED</strong>
          <p style={{ ...secondaryText, maxWidth: 430, margin: '.5rem auto 0' }}>Complete a Practice, Drill, or Mock Exam to view competency diagnostics and session history here.</p>
          {deletedRows.length > 0 && <button className="btn btn-outline" style={{ marginTop: '1rem' }} onClick={() => setShowRecentlyDeleted(true)}>Open Recently Deleted</button>}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '.7rem' }}>
          {activeRows.map(row => {
            const selected = selectedKeys.includes(row.key)
            const statusText = !row.completed ? 'IN PROGRESS'
              : row.mode === 'MOCK' ? (row.percent >= 70 ? 'PASSED' : 'FAILED')
                : row.percent >= 70 ? 'PASSED' : 'COMPLETED'
            const statusColor = !row.completed ? 'var(--warning, #c2410c)'
              : row.percent >= 70 ? 'var(--success)' : row.mode === 'MOCK' ? 'var(--danger)' : 'var(--accent)'
            const activate = () => {
              if (skipNextClick.current) { skipNextClick.current = false; return }
              if (selectionMode) {
                toggleSelected(row)
              } else if (row.kind === 'saved' && row.saved) {
                setProgressDetails(row.saved)
              } else {
                void openReview(row.id)
              }
            }
            return (
              <article
                key={row.key}
                className="card"
                role="button"
                tabIndex={0}
                aria-pressed={selectionMode ? selected : undefined}
                onClick={activate}
                onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); activate() } }}
                onContextMenu={event => {
                  event.preventDefault()
                  skipNextClick.current = true
                  setSelectionMode(true)
                  setSelectedKeys(current => current.includes(row.key) ? current : [...current, row.key])
                }}
                style={{ borderLeft: '4px solid ' + statusColor, background: selected ? 'var(--bg-elevated)' : 'var(--bg-card)', cursor: 'pointer', padding: '.9rem', outline: 'none' }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '.85rem', letterSpacing: '.05em', fontWeight: 900, overflowWrap: 'anywhere' }}>{rowTitle(row)}</div>
                    <div style={{ ...secondaryText, marginTop: '.25rem' }}>{formatDate(row.timestamp)}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexShrink: 0 }}>
                    {selectionMode && <input type="checkbox" aria-label={'Select ' + rowTitle(row)} checked={selected} onClick={event => event.stopPropagation()} onChange={() => toggleSelected(row)} />}
                    <span style={{ fontSize: '.68rem', fontWeight: 900, color: statusColor, border: '1px solid currentColor', padding: '.2rem .35rem', whiteSpace: 'nowrap' }}>{statusText}</span>
                    <button type="button" aria-label="Delete session log" className="btn btn-outline" onClick={event => { event.stopPropagation(); requestDelete(row) }} style={{ padding: '.2rem .45rem', minHeight: 28 }}>×</button>
                  </div>
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'flex-end', gap: 10, marginTop: '.75rem' }}>
                  <div>
                    <div style={{ fontSize: '1.15rem', fontWeight: 900 }}>
                      {row.correct + ' / ' + row.total + ' items' + (row.completed ? ' (' + row.percent + '%)' : '')}
                    </div>
                    <div style={{ ...secondaryText, marginTop: '.2rem' }}>
                      {row.completed ? 'TIME: ' + formatDuration(row.durationMs) : 'PROGRESS: ' + row.answered + ' / ' + row.total}
                    </div>
                  </div>
                  <span style={{ color: 'var(--accent)', fontSize: '.75rem', fontWeight: 900, letterSpacing: '.06em' }}>
                    {row.completed ? 'VIEW AUDIT »' : 'CONTINUE »'}
                  </span>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {pendingDelete && createPortal(
        <div style={modalBackdrop} role="presentation">
          <section style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="delete-session-title">
            <h2 id="delete-session-title" style={{ marginTop: 0 }}>Move session to Recently Deleted?</h2>
            <p style={secondaryText}>{rowTitle(pendingDelete)} will be recoverable for 3 days before it is permanently deleted.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, color: 'var(--danger)' }} onClick={confirmDelete}>Move to Recently Deleted</button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {showClearConfirm && createPortal(
        <div style={modalBackdrop} role="presentation">
          <section style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="clear-history-title">
            <h2 id="clear-history-title" style={{ marginTop: 0 }}>Clear session history?</h2>
            <p style={secondaryText}>All active and completed session logs will move to Recently Deleted. You can restore them for 3 days.</p>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setShowClearConfirm(false)}>Cancel</button>
              <button className="btn btn-primary" style={{ flex: 1, color: 'var(--danger)' }} onClick={() => { clear(); setShowClearConfirm(false); setSelectedKeys([]); setSelectionMode(false) }}>Clear all</button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {showRecentlyDeleted && createPortal(
        <div style={modalBackdrop} role="presentation" onClick={() => setShowRecentlyDeleted(false)}>
          <section style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="recently-deleted-title" onClick={event => event.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
              <h2 id="recently-deleted-title" style={{ margin: 0 }}>Recently Deleted Sessions</h2>
              <button className="btn btn-outline" onClick={() => setShowRecentlyDeleted(false)}>Close</button>
            </div>
            <p style={secondaryText}>Deleted sessions remain recoverable for 3 days.</p>
            {deletedRows.length === 0 ? <p style={secondaryText}>No recently deleted sessions.</p> : (
              <div style={{ display: 'grid', gap: '.6rem' }}>
                {deletedRows.map(row => {
                  const deletedAt = row.deletedAt ?? Date.now()
                  const days = Math.max(0, Math.ceil((deletedAt + HISTORY_RETENTION_MS - Date.now()) / (24 * 60 * 60 * 1000)))
                  return <div key={row.key} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '.75rem', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                    <div style={{ minWidth: 0 }}>
                      <strong style={{ fontSize: '.85rem', overflowWrap: 'anywhere' }}>{rowTitle(row)}</strong>
                      <div style={secondaryText}>{formatDate(row.timestamp)} · Progress {row.answered}/{row.total}</div>
                      <div style={{ fontSize: '.72rem', color: 'var(--warning, #c2410c)', fontWeight: 800, marginTop: '.25rem' }}>{days <= 0 ? 'EXPIRES TODAY' : 'EXPIRES IN ' + days + (days === 1 ? ' DAY' : ' DAYS')}</div>
                    </div>
                    <div style={{ display: 'grid', gap: 5, flexShrink: 0 }}>
                      <button className="btn btn-primary" onClick={() => { restoreDeleted(row.kind, row.id) }} style={{ padding: '.35rem .55rem' }}>Restore</button>
                      <button className="btn btn-outline" onClick={() => permanentlyDelete(row.kind, row.id)} style={{ padding: '.35rem .55rem', color: 'var(--danger)' }}>Delete forever</button>
                    </div>
                  </div>
                })}
              </div>
            )}
          </section>
        </div>,
        document.body
      )}

      {progressDetails && createPortal(
        <div style={modalBackdrop} role="presentation" onClick={() => setProgressDetails(null)}>
          <section style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="progress-details-title" onClick={event => event.stopPropagation()}>
            <h2 id="progress-details-title" style={{ marginTop: 0 }}>Session in progress</h2>
            <strong>{MODE_LABEL[progressDetails.mode]} · {TRACK_LABELS[progressDetails.track]}</strong>
            <p style={secondaryText}>{progressDetails.competenceId || 'All competences'} · Last updated {formatDate(progressDetails.savedAt)}</p>
            <div className="card" style={{ marginTop: '.8rem' }}>
              <strong>Progress: {progressDetails.answered}/{progressDetails.total} questions answered</strong>
              <p style={secondaryText}>Current question {Math.min(progressDetails.currentIndex + 1, progressDetails.total)} of {progressDetails.total}. Your answers are saved automatically.</p>
            </div>
            <div style={{ display: 'flex', gap: 8, marginTop: '1rem' }}>
              <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => setProgressDetails(null)}>Close</button>
              <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => resumeSession(progressDetails)}>Continue session</button>
            </div>
          </section>
        </div>,
        document.body
      )}

      {review && createPortal(
        <div style={modalBackdrop} role="presentation" onClick={closeReview}>
          <section style={modalStyle} role="dialog" aria-modal="true" aria-labelledby="session-audit-title" onClick={event => event.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <h2 id="session-audit-title" style={{ margin: 0 }}>EXAM ATTEMPT AUDIT</h2>
                <p style={secondaryText}>{reviewEntry ? rowTitle({ ...buildRows([reviewEntry], [])[0], key: 'entry:' + reviewEntry.id }) : 'Completed session'}</p>
              </div>
              <button className="btn btn-outline" onClick={closeReview}>Close</button>
            </div>
            {reviewEntry && (
              <div style={{ background: 'var(--bg-elevated)', borderRadius: 8, padding: '.8rem', margin: '.8rem 0' }}>
                <div style={{ fontSize: '1.45rem', fontWeight: 900, color: reviewEntry.percent >= 70 ? 'var(--success)' : 'var(--danger)' }}>{reviewEntry.percent}%</div>
                <div style={secondaryText}>{reviewEntry.correct}/{reviewEntry.total} correct · {formatDuration(reviewEntry.durationMs)} · {formatDate(reviewEntry.finishedAt)}</div>
              </div>
            )}
            {!review.snapshot ? (
              <p style={secondaryText}>Detailed question-by-question answers are not available for this older history entry, but its score and session summary are preserved.</p>
            ) : (
              <>
                {review.snapshot.mode === 'MOCK' && (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: '.85rem' }}>
                    <button className={review.tab === 'breakdown' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setReview(current => current ? { ...current, tab: 'breakdown' } : current)}>Competence breakdown</button>
                    <button className={review.tab === 'questions' ? 'btn btn-primary' : 'btn btn-outline'} onClick={() => setReview(current => current ? { ...current, tab: 'questions', index: 0 } : current)}>Question review</button>
                  </div>
                )}
                {review.snapshot.mode === 'MOCK' && review.tab === 'breakdown' ? (
                  <div style={{ display: 'grid', gap: '.5rem' }}>
                    {competenceBreakdown.map(item => (
                      <div key={item.id} className="card" style={{ padding: '.75rem' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <strong>{item.id}</strong>
                          <strong style={{ color: item.percent >= 70 ? 'var(--success)' : 'var(--danger)' }}>{item.percent}%</strong>
                        </div>
                        <div style={secondaryText}>{item.correct}/{item.total} correct · {item.percent >= 70 ? 'PASSED' : 'BELOW 70%'}</div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '.85rem', fontWeight: 700, margin: '.8rem 0' }}>
                      <input type="checkbox" checked={review.missedOnly} onChange={event => setReview(current => current ? { ...current, missedOnly: event.target.checked, index: 0 } : current)} />
                      Show missed / unanswered questions only
                    </label>
                    {currentQuestion ? (
                      <div className="card" style={{ padding: '.9rem' }}>
                        <div style={secondaryText}>QUESTION {reviewIndex + 1} OF {filteredReviewQuestions.length} · {currentQuestion.competenceId} · {currentQuestion.topic}</div>
                        <p style={{ fontWeight: 750, lineHeight: 1.6 }}>{currentQuestion.questionText}</p>
                        <div style={{ display: 'grid', gap: '.45rem' }}>
                          {currentQuestion.options.map((option, index) => {
                            const chosen = currentAnswer?.selectedIndex === index
                            const correct = currentQuestion.correctAnswerIndex === index
                            const border = correct ? 'var(--success)' : chosen ? 'var(--danger)' : 'var(--border)'
                            const background = correct ? 'rgba(34,197,94,.12)' : chosen ? 'rgba(239,68,68,.12)' : 'var(--bg-card)'
                            return <div key={index} style={{ border: '1px solid ' + border, background, borderRadius: 6, padding: '.65rem', lineHeight: 1.5 }}>
                              <strong>{String.fromCharCode(65 + index)}.</strong> {option}
                              {correct && <span style={{ color: 'var(--success)', fontWeight: 900 }}> · CORRECT ANSWER</span>}
                              {chosen && !correct && <span style={{ color: 'var(--danger)', fontWeight: 900 }}> · YOUR ANSWER</span>}
                            </div>
                          })}
                        </div>
                        {currentQuestion.explanation && <div style={{ ...secondaryText, marginTop: '.8rem' }}><strong>Explanation:</strong> {currentQuestion.explanation}</div>}
                      </div>
                    ) : <p style={secondaryText}>No questions match this filter.</p>}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginTop: '.75rem' }}>
                      <button className="btn btn-outline" disabled={reviewIndex <= 0} onClick={() => setReview(current => current ? { ...current, index: Math.max(0, current.index - 1) } : current)}>← Previous</button>
                      <span style={secondaryText}>{filteredReviewQuestions.length ? (reviewIndex + 1) + ' / ' + filteredReviewQuestions.length : '0 / 0'}</span>
                      <button className="btn btn-outline" disabled={reviewIndex >= filteredReviewQuestions.length - 1} onClick={() => setReview(current => current ? { ...current, index: Math.min(filteredReviewQuestions.length - 1, current.index + 1) } : current)}>Next →</button>
                    </div>
                  </>
                )}
              </>
            )}
          </section>
        </div>,
        document.body
      )}
    </div>
  )
}
