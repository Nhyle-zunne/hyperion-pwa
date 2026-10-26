import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { usePracticeStore } from '../stores/practiceStore'
import { getQuestionsByTrack, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = { oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW', deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT' }
const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW OPERATIONAL TRACK', GMDSS_GOC: 'GMDSS GOC TRACK',
  ENGINE_OIC_EW: 'OIC-EW OPERATIONAL TRACK', DECK_MGT: 'DECK MANAGEMENT TRACK', ENGINE_MGT: 'ENGINE MANAGEMENT TRACK'
}
const FUNCTION_LABELS: Record<TrackId, Record<string, string>> = {
  DECK_OIC_NW: { F1: 'NAVIGATION AT THE OPERATIONAL LEVEL', F2: 'CARGO HANDLING AND STOWAGE AT THE OPERATIONAL LEVEL', F3: 'CONTROLLING OF OPERATION OF THE SHIP AT THE OPERATIONAL LEVEL' },
  GMDSS_GOC: { GMDSS: 'GMDSS GENERAL OPERATOR CERTIFICATE' },
  ENGINE_OIC_EW: { F1: 'MARINE ENGINEERING AT THE OPERATIONAL LEVEL', F2: 'ELECTRICAL, ELECTRONIC AND CONTROL ENGINEERING AT THE OPERATIONAL LEVEL', F3: 'MAINTENANCE AND REPAIR AT THE OPERATIONAL LEVEL', F4: 'CONTROLLING SHIP OPERATIONS AND CARE FOR PERSONS ON BOARD' },
  DECK_MGT: { F1: 'NAVIGATION AT THE MANAGEMENT LEVEL', F2: 'CARGO HANDLING AND STOWAGE AT THE MANAGEMENT LEVEL', F3: 'CONTROLLING SHIP OPERATIONS AND CARE FOR PERSONS ON BOARD' },
  ENGINE_MGT: { F1: 'MARINE ENGINEERING AT THE MANAGEMENT LEVEL', F2: 'ELECTRICAL, ELECTRONIC AND CONTROL ENGINEERING AT THE MANAGEMENT LEVEL', F3: 'MAINTENANCE AND REPAIR AT THE MANAGEMENT LEVEL', F4: 'CONTROLLING SHIP OPERATIONS AND CARE FOR PERSONS ON BOARD' }
}
// Official mock-exam item distribution mirrored from HYPERION-REVIEWER's
// MaritimeCompetenceRegistry / NewTrackCompetences permit distributions.
const MOCK_EXAM_ITEMS: Record<TrackId, Record<string, number>> = {
  DECK_OIC_NW: { C1: 35, C2: 20, C3: 15, C4: 10, C5: 10, C7: 20, C9: 15, C10: 15, C11: 15, C12: 15, C13: 15, C17: 15 },
  GMDSS_GOC: { C1: 85, C2: 15 },
  ENGINE_OIC_EW: { C1: 14, C2: 10, C3: 10, C4: 30, C5: 10, C6: 20, C7: 15, C8: 24, C9: 15, C10: 10, C11: 10, C15: 10, C16: 22 },
  DECK_MGT: { C1: 10, C2: 10, C3: 10, C4: 10, C5: 10, C6: 10, C8: 10, C9: 10, C10: 20, C11: 10, C12: 15, C13: 10, C14: 10, C15: 15, C16: 10, C17: 10, C18: 10, C20: 10 },
  ENGINE_MGT: { C1: 10, C2: 26, C3: 28, C4: 10, C5: 20, C6: 20, C7: 10, C8: 10, C9: 10, C10: 10, C11: 10, C12: 10, C13: 10, C14: 16 }
}
const mockExamItemCount = (track: TrackId, competenceId: string) => MOCK_EXAM_ITEMS[track][competenceId] ?? (track === 'GMDSS_GOC' ? 50 : 15)

const MOCK_EXAM_PLAN_KEY = 'hyperion-mock-exam-plan-v1'
interface MockCompetenceResult {
  competenceId: string
  functionId: string
  correct: number
  total: number
  percent: number
  completedAt: number
}
interface MockExamPlan {
  trackId: TrackId
  trackParam: string
  selectedFunctions: string[]
  startedAt: number
  status: 'in_progress' | 'submitted'
  results: Record<string, MockCompetenceResult>
}
function readMockExamPlan(trackId?: TrackId): MockExamPlan | null {
  try {
    const raw = localStorage.getItem(MOCK_EXAM_PLAN_KEY)
    if (!raw) return null
    const plan = JSON.parse(raw) as MockExamPlan
    if (!plan || !Array.isArray(plan.selectedFunctions) || !plan.results || !plan.trackId) return null
    if (trackId && plan.trackId !== trackId) return null
    return plan
  } catch {
    return null
  }
}
function writeMockExamPlan(plan: MockExamPlan): void {
  try { localStorage.setItem(MOCK_EXAM_PLAN_KEY, JSON.stringify(plan)) } catch { /* storage may be unavailable */ }
}

function mockQuestionWeight(question: Question): number {
  if (question.difficulty === 'EASY') return 3
  if (question.difficulty === 'MODERATE') return 6
  return 9
}
function weightedMockCompetenceScore(
  questions: Question[],
  answers: Record<string, { selectedIndex: number | null; isCorrect: boolean }>
): { correct: number; total: number; percent: number } {
  let rawScore = 0
  let totalScore = 0
  let correct = 0
  for (const question of questions) {
    const weight = mockQuestionWeight(question)
    totalScore += weight
    const answer = answers[question.id]
    if (answer?.selectedIndex != null && answer.isCorrect) {
      rawScore += weight
      correct += 1
    }
  }
  return {
    correct,
    total: questions.length,
    percent: totalScore > 0 ? Math.round((rawScore / totalScore) * 10000) / 100 : 0
  }
}
const competencesForFunction = (track: TrackId, functionId: string) => {
  const ids: Record<TrackId, Record<string, string[]>> = {
    DECK_OIC_NW: { F1: ['C1','C2','C3','C4','C5','C7','C9'], F2: ['C10','C11'], F3: ['C12','C13','C17'] },
    GMDSS_GOC: { GMDSS: ['C1','C2'] },
    ENGINE_OIC_EW: { F1: ['C1','C2','C3','C4','C5'], F2: ['C6','C7'], F3: ['C8','C9'], F4: ['C10','C11','C15','C16'] },
    DECK_MGT: { F1: ['C1','C2','C3','C4','C5','C6','C8','C9','C10','C11'], F2: ['C12','C13','C14'], F3: ['C15','C16','C17','C18','C20'] },
    ENGINE_MGT: { F1: ['C1','C2','C3','C4'], F2: ['C5','C6'], F3: ['C7','C8','C9'], F4: ['C10','C11','C12','C13','C14'] }
  }
  return (ids[track][functionId] || []).reduce((sum, id) => sum + mockExamItemCount(track, id), 0)
}
type Stage = 'confirm' | 'functions' | 'competences' | 'results'

export default function MockExamScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'
  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const startSession = usePracticeStore((s) => s.startSession)
  const [stage, setStage] = useState<Stage>(() => {
    const requestedStage = params.get('stage')
    const saved = readMockExamPlan(trackId)
    if (requestedStage === 'competences' && saved?.status === 'in_progress') return 'competences'
    if (requestedStage === 'results' && saved?.status === 'submitted') return 'results'
    return 'confirm'
  })
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [examPlan, setExamPlan] = useState<MockExamPlan | null>(() => readMockExamPlan(trackId))
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>(() => {
    const requestedStage = params.get('stage')
    const saved = readMockExamPlan(trackId)
    return (requestedStage === 'competences' || requestedStage === 'results') && saved ? saved.selectedFunctions : []
  })
  const [startingCompetence, setStartingCompetence] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [showFinalSubmitConfirm, setShowFinalSubmitConfirm] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setQuestions([])
    getQuestionsByTrack(trackId).then((items) => {
      if (cancelled) return
      setQuestions(items)
      setLoading(false)
    }).catch(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [trackId])

  const functions = useMemo(() => {
    const counts = new Map<string, number>()
    questions.forEach((q) => counts.set(q.functionId, (counts.get(q.functionId) || 0) + 1))
    return Array.from(counts.entries()).map(([id]) => ({ id, count: competencesForFunction(trackId, id), label: FUNCTION_LABELS[trackId][id] || id }))
  }, [questions])
  const competences = listAvailableCompetences(trackId)
  const visibleCompetences = useMemo(() => competences.map((c) => {
    const items = questions.filter((q) => q.competenceId === c.id && selectedFunctions.includes(q.functionId))
    const functionId = items[0]?.functionId || questions.find((q) => q.competenceId === c.id)?.functionId || 'OTHER'
    return { ...c, functionId, count: items.length }
  }).filter((c) => c.count > 0), [competences, questions, selectedFunctions])
  const groupedCompetences = useMemo(() => functions
    .filter((fn) => selectedFunctions.includes(fn.id))
    .map((fn) => ({ ...fn, competences: visibleCompetences.filter((c) => c.functionId === fn.id) }))
    .filter((fn) => fn.competences.length > 0), [functions, selectedFunctions, visibleCompetences])

  const tableRows = useMemo(() => groupedCompetences.flatMap((group) =>
    group.competences.map((competence) => ({
      ...competence,
      functionId: group.id,
      functionLabel: group.label
    }))
  ), [groupedCompetences])
  const completedCount = tableRows.filter((row) => Boolean(examPlan?.results[row.id])).length
  const allCompetencesCompleted = tableRows.length > 0 && completedCount === tableRows.length

  const toggleFunction = (id: string) => setSelectedFunctions((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id])

  const proceedToCompetences = () => {
    if (!selectedFunctions.length) return
    const plan: MockExamPlan = {
      trackId,
      trackParam,
      selectedFunctions: [...selectedFunctions],
      startedAt: Date.now(),
      status: 'in_progress',
      results: {}
    }
    writeMockExamPlan(plan)
    setExamPlan(plan)
    setStage('competences')
  }

  const submitOverallExam = () => {
    if (!examPlan || !allCompetencesCompleted) return
    const submitted: MockExamPlan = { ...examPlan, status: 'submitted' }
    writeMockExamPlan(submitted)
    setExamPlan(submitted)
    setShowFinalSubmitConfirm(false)
    setStage('results')
    navigate('/mock?track=' + encodeURIComponent(trackParam) + '&stage=results', { replace: true })
  }
  const start = async (competenceId: string) => {
    if (!isUnlocked) { openPaywall('Mock Exam'); return }
    const pool = questions.filter((q) => q.competenceId === competenceId && selectedFunctions.includes(q.functionId))
    const examItemCount = mockExamItemCount(trackId, competenceId)
    if (!pool.length) return
    setStartingCompetence(competenceId)
    setStarting(true)
    try {
      await startSession({
        mode: 'MOCK', track: trackId, competenceId, limit: Math.min(examItemCount, pool.length), startItem: 1,
        timeLimitSec: Math.min(examItemCount, pool.length) * 60,
      })
      if (usePracticeStore.getState().error || !usePracticeStore.getState().questions.length) return
      navigate('/mock/exam')
    } finally { setStarting(false); setStartingCompetence(null) }
  }

  const overlay: React.CSSProperties = { position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(3,8,18,0.78)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'max(0.75rem, env(safe-area-inset-top)) 0.75rem max(0.75rem, env(safe-area-inset-bottom))', animation: 'backdrop-enter 180ms ease-out both', overflowY: 'auto' }
  const dialog: React.CSSProperties = { width: '100%', maxWidth: 570, maxHeight: 'min(88dvh, 900px)', overflowY: 'auto', overscrollBehavior: 'contain', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 16, padding: 'clamp(1rem, 3vw, 1.5rem)', boxShadow: '0 24px 70px rgba(0,0,0,.4)', animation: 'page-enter 220ms ease-out both' }
  const greenLine = { height: 5, background: 'var(--accent)', marginBottom: '1rem' } as const
  const secondaryButton: React.CSSProperties = { minHeight: 48, padding: '0.7rem 1rem', border: '1px solid var(--border)', background: 'transparent', color: 'var(--text)', fontWeight: 800, cursor: 'pointer' }
  const primaryButton: React.CSSProperties = { ...secondaryButton, borderColor: 'var(--accent)', background: 'var(--accent)', color: 'var(--bg)' }

  return (
    <div className="screen" style={{ paddingBottom: '2rem', minHeight: 'calc(100dvh - 64px)', background: 'var(--bg)', color: 'var(--text)' }}>
      <button type="button" onClick={() => navigate('/track?track=' + trackParam)} style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}>← Back to Track</button>
      <div className="card" style={{ width: 'min(100%, 860px)', boxSizing: 'border-box', margin: '0 auto 1rem', borderRadius: 14, borderTop: '3px solid var(--accent)' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.12em', fontWeight: 800 }}>STCW '78 AS AMENDED · OFFICIAL TIMED MOCK</div>
        <h1 className="page-title" style={{ marginTop: 8, marginBottom: 4 }}>{TRACK_LABELS[trackId]}</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>MARINA-format timed mock examination · 70% passing cutoff · 1 minute per item</p>
      </div>
      {stage === 'confirm' && (
        <div className="card" style={{ borderRadius: 14 }}>
          <h2 style={{ marginTop: 0 }}>EXAMINATION PROTOCOL</h2>
          <p style={{ color: 'var(--text-muted)' }}>Choose the functions to include, then select a competence to begin. The timer runs only while answering that competence.</p>
          <p>{loading ? 'Loading question bank…' : questions.length.toLocaleString() + ' questions available across ' + competences.length + ' competences.'}</p>
          <button type="button" className="btn btn-primary" disabled={loading} onClick={() => setStage('confirm')} style={{ width: '100%' }}>START OFFICIAL TIMED MOCK EXAM</button>
        </div>
      )}

      {stage === 'confirm' && <div style={overlay}>
        <section role="dialog" aria-modal="true" aria-labelledby="mock-confirm-title" style={dialog}>
          <div style={greenLine} /><h2 id="mock-confirm-title" style={{ fontSize: '1.35rem', marginTop: 0 }}>START OFFICIAL TIMED MOCK EXAM</h2>
          <p style={{ fontSize: '1.05rem', lineHeight: 1.5 }}>You are about to start an official MARINA format timed mock examination.</p>
          <ul style={{ color: 'var(--text-muted)', fontWeight: 700, paddingLeft: '1.2rem', lineHeight: 1.5 }}><li>Passing Cutoff: 70.0% per competence</li><li>Timing: 1 minute per item</li><li>Session lock-in applies once started</li></ul>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1.5rem' }}>
            <button type="button" style={secondaryButton} onClick={() => navigate('/track?track=' + trackParam)}>CANCEL</button>
            <button type="button" style={primaryButton} onClick={() => setStage('functions')}>PROCEED</button>
          </div>
        </section>
      </div>}

      {stage === 'functions' && <div style={overlay}>
        <section role="dialog" aria-modal="true" aria-labelledby="mock-functions-title" style={dialog}>
          <div style={greenLine} /><h2 id="mock-functions-title" style={{ fontSize: '1.3rem', marginTop: 0 }}>SELECT EXAM FUNCTIONS</h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.45 }}>Choose which functions to include in this Mock Examination. Nothing is selected by default.</p>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8, margin: '1rem 0', fontWeight: 800, color: 'var(--text-muted)' }}>
            <span>{selectedFunctions.length} FUNCTIONS SELECTED</span>
            <button type="button" onClick={() => setSelectedFunctions(selectedFunctions.length === functions.length ? [] : functions.map((f) => f.id))} style={{ border: 0, background: 'transparent', color: 'var(--accent)', fontWeight: 900 }}>{selectedFunctions.length === functions.length ? 'CLEAR ALL' : 'SELECT ALL'}</button>
          </div>
          <div style={{ display: 'grid', gap: 8 }}>
            {functions.map((fn) => <button key={fn.id} type="button" onClick={() => toggleFunction(fn.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', padding: '0.8rem', textAlign: 'left', border: '1px solid ' + (selectedFunctions.includes(fn.id) ? 'var(--accent)' : 'var(--border)'), borderRadius: 10, background: selectedFunctions.includes(fn.id) ? 'var(--bg-elevated)' : 'transparent', color: 'var(--text)' }}>
              <span aria-hidden="true" style={{ width: 22, height: 22, flexShrink: 0, border: '2px solid ' + (selectedFunctions.includes(fn.id) ? 'var(--accent)' : 'var(--text-muted)'), display: 'grid', placeItems: 'center', color: 'var(--accent)' }}>{selectedFunctions.includes(fn.id) ? '✓' : ''}</span>
              <span style={{ flex: 1 }}><strong style={{ display: 'block' }}>{fn.id}</strong><span style={{ display: 'block', fontWeight: 800, lineHeight: 1.35 }}>{fn.label}</span></span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 800, whiteSpace: 'nowrap' }}>{fn.count.toLocaleString()} items</span>
            </button>)}
            {!functions.length && !loading && <p>No functions were found in the loaded question bank.</p>}
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1.25rem' }}>
            <button type="button" style={secondaryButton} onClick={() => setStage('confirm')}>CANCEL</button>
            <button type="button" style={{ ...primaryButton, opacity: selectedFunctions.length ? 1 : 0.45 }} disabled={!selectedFunctions.length || loading} onClick={proceedToCompetences}>PROCEED</button>
          </div>
        </section>
      </div>}

      {(stage === 'competences' || stage === 'results') && <section style={{ margin: '1rem auto 0', width: 'min(100%, 860px)', boxSizing: 'border-box' }}>
        {stage === 'results' && <p style={{ margin: '0 0 .6rem', fontSize: '.85rem', fontWeight: 800, color: 'var(--text-muted)', letterSpacing: '.06em' }}>MOCK EXAM RESULTS · SUBMITTED</p>}
        <div style={{ overflowX: 'auto', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', color: 'var(--text)', fontSize: '.9rem', tableLayout: 'fixed' }}>
            <colgroup>
              <col style={{ width: '15%' }} />
              <col style={{ width: '25%' }} />
              <col style={{ width: '34%' }} />
              <col style={{ width: '12%' }} />
              <col style={{ width: '14%' }} />
            </colgroup>
            <thead>
              <tr style={{ background: 'var(--bg-elevated)', textAlign: 'left' }}>
                <th scope="col" style={{ padding: '.75rem .6rem', borderBottom: '1px solid var(--border)' }}>FUNCTION</th>
                <th scope="col" style={{ padding: '.75rem .6rem', borderBottom: '1px solid var(--border)' }}>STATUS</th>
                <th scope="col" style={{ padding: '.75rem .6rem', borderBottom: '1px solid var(--border)' }}>COMPETENCE</th>
                <th scope="col" style={{ padding: '.75rem .4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>{examPlan?.status === 'submitted' ? 'SCORE' : 'ITEMS'}</th>
                <th scope="col" style={{ padding: '.75rem .4rem', borderBottom: '1px solid var(--border)', textAlign: 'center' }}>ACTION</th>
              </tr>
            </thead>
            <tbody>
              {groupedCompetences.map((group) => {
                const groupSubmitted = examPlan?.status === 'submitted'
                // Per permit PDF: a function fails if any competence in it is below 70%.
                const functionPassed = group.competences.every((competence) => {
                  const result = examPlan?.results[competence.id]
                  return result != null && result.percent >= 70
                })
                const statusText = !groupSubmitted ? 'NOT YET SUBMITTED' : functionPassed ? 'PASSED' : 'FAILED'
                const statusStyle: React.CSSProperties = groupSubmitted
                  ? {
                      background: functionPassed ? '#22c55e' : '#ef4444',
                      color: '#ffffff',
                      borderRight: '1px solid ' + (functionPassed ? '#16a34a' : '#dc2626'),
                      fontWeight: 900
                    }
                  : { background: 'transparent', color: 'var(--text-muted)', fontWeight: 700 }
                return group.competences.map((row, rowIndex) => {
                  const result = examPlan?.results[row.id]
                  const locked = Boolean(result) || groupSubmitted
                  return <tr key={row.id}>
                    {rowIndex === 0 && <td rowSpan={group.competences.length} style={{ padding: '.7rem .55rem', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', textAlign: 'center', fontWeight: 900, overflowWrap: 'anywhere' }}>
                      {group.id}
                    </td>}
                    {rowIndex === 0 && <td rowSpan={group.competences.length} style={{ padding: '.55rem', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', textAlign: 'center', overflowWrap: 'anywhere', ...statusStyle }}>
                      {statusText}
                    </td>}
                    <td style={{ padding: '.7rem .6rem', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', overflowWrap: 'anywhere' }}>
                      <strong style={{ display: 'block' }}>{row.id}</strong>
                      <span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '.82rem', lineHeight: 1.35, marginTop: 3 }}>{row.label.replace(/^C\\d+\\s*[·:-]?\\s*/, '')}</span>
                    </td>
                    <td style={{ padding: '.7rem .35rem', borderBottom: '1px solid var(--border)', verticalAlign: 'middle', textAlign: 'center', fontVariantNumeric: 'tabular-nums', fontWeight: groupSubmitted ? 800 : 500, overflowWrap: 'anywhere' }}>
                      {groupSubmitted ? (result ? result.percent.toFixed(2) + '%' : '—') : mockExamItemCount(trackId, row.id)}
                    </td>
                    <td style={{ padding: '.55rem .3rem', borderBottom: '1px solid var(--border)', textAlign: 'center', verticalAlign: 'middle' }}>
                      {locked
                        ? <span style={{ display: 'inline-block', padding: '.42rem .35rem', borderRadius: 5, background: 'var(--bg-elevated)', color: 'var(--text-muted)', fontSize: '.7rem', fontWeight: 900, letterSpacing: '.02em' }}>LOCKED</span>
                        : <button type="button" className="btn btn-primary" disabled={starting || !row.count} onClick={() => void start(row.id)} style={{ minWidth: 0, width: '100%', padding: '.55rem .3rem', whiteSpace: 'normal', lineHeight: 1.2, fontSize: '.75rem' }}>{startingCompetence === row.id ? 'Starting…' : 'Take Exam'}</button>}
                    </td>
                  </tr>
                })
              })}
              {!tableRows.length && <tr><td colSpan={5} style={{ padding: '1rem', color: 'var(--text-muted)' }}>No competences are available for the selected functions.</td></tr>}
            </tbody>
          </table>
        </div>

        {stage === 'competences' && <div style={{ marginTop: '1rem', padding: '1rem', border: '1px solid var(--border)', borderRadius: 10, background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, marginBottom: 10 }}>
            <strong>{completedCount} / {tableRows.length} competences completed</strong>
            <span style={{ color: 'var(--text-muted)', fontSize: '.84rem' }}>{tableRows.length - completedCount} remaining</span>
          </div>
          {!allCompetencesCompleted && <p style={{ color: 'var(--text-muted)', fontSize: '.85rem', lineHeight: 1.45, margin: '0 0 .75rem' }}>Finish every selected competence to unlock final submission.</p>}
          <button type="button" className="btn btn-primary" disabled={!allCompetencesCompleted} onClick={() => setShowFinalSubmitConfirm(true)} style={{ width: '100%' }}>SUBMIT EXAM</button>
        </div>}
        {stage === 'competences' && completedCount === 0 && <button type="button" style={{ ...secondaryButton, width: '100%', marginTop: 10 }} onClick={() => setStage('functions')}>← CHANGE FUNCTIONS</button>}
        {stage === 'competences' && showFinalSubmitConfirm && <div role="presentation" style={overlay}>
          <section role="dialog" aria-modal="true" aria-labelledby="submit-overall-mock-title" style={dialog}>
            <div style={greenLine} />
            <h2 id="submit-overall-mock-title" style={{ fontSize: '1.3rem', marginTop: 0 }}>Are you sure you want to submit the exam?</h2>
            <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>You have completed all {tableRows.length} selected competence exams. After submitting, this mock exam's results will be finalized.</p>
            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 10, marginTop: '1.25rem' }}>
              <button type="button" style={secondaryButton} onClick={() => setShowFinalSubmitConfirm(false)}>NO</button>
              <button type="button" style={primaryButton} onClick={submitOverallExam}>YES, SUBMIT EXAM</button>
            </div>
          </section>
        </div>}
        {stage === 'results' && <div style={{ display: 'flex', gap: 8, marginTop: '1rem', flexWrap: 'wrap' }}>
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate('/mock?track=' + encodeURIComponent(trackParam))}>RETURN TO MOCK EXAMS</button>
          <button type="button" className="btn btn-outline" style={{ flex: 1 }} onClick={() => navigate('/history')}>VIEW HISTORY</button>
        </div>}
      </section>}

    </div>
  )
}

export function MockExamRunner() {
  const navigate = useNavigate()
  const { questions, answers, finished, timeLeftSec, selectAnswer, finish, tick, score, reset, track, competenceId, mode } = usePracticeStore()
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false)
  const [showLockNotice, setShowLockNotice] = useState(false)
  const completionSavedRef = useRef(false)

  useEffect(() => {
    if (finished) return
    const timer = window.setInterval(() => tick(), 1000)
    return () => window.clearInterval(timer)
  }, [finished, tick])

  useEffect(() => {
    const blockExit = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = '' }
    const blockPop = () => {
      window.history.pushState({ hyperionMockExam: true }, '')
      setShowLockNotice(true)
    }
    const blockAppBack = () => setShowLockNotice(true)
    window.addEventListener('beforeunload', blockExit)
    window.addEventListener('hyperion:request-exit-mock', blockAppBack)
    window.history.pushState({ hyperionMockExam: true }, '')
    window.addEventListener('popstate', blockPop)
    return () => { window.removeEventListener('beforeunload', blockExit); window.removeEventListener('hyperion:request-exit-mock', blockAppBack); window.removeEventListener('popstate', blockPop) }
  }, [])

  useEffect(() => {
    if (!finished || mode !== 'MOCK' || completionSavedRef.current || !track || !competenceId) return
    const plan = readMockExamPlan(track)
    const functionId = questions[0]?.functionId
    if (!plan || plan.status !== 'in_progress' || !functionId || !plan.selectedFunctions.includes(functionId)) return

    const result = weightedMockCompetenceScore(questions, answers)
    const updated: MockExamPlan = {
      ...plan,
      results: {
        ...plan.results,
        [competenceId]: {
          competenceId,
          functionId,
          correct: result.correct,
          total: result.total,
          percent: result.percent,
          completedAt: Date.now()
        }
      }
    }
    writeMockExamPlan(updated)
    completionSavedRef.current = true
    navigate('/mock?track=' + encodeURIComponent(plan.trackParam) + '&stage=competences', { replace: true })
  }, [finished, mode, track, competenceId, questions, answers, score, navigate])

  const answered = questions.reduce((count, q) => count + (answers[q.id]?.selectedIndex != null ? 1 : 0), 0)
  const formatTime = (seconds: number) => String(Math.floor(Math.max(0, seconds) / 60)).padStart(2, '0') + ':' + String(Math.max(0, seconds) % 60).padStart(2, '0')
  const card: React.CSSProperties = { border: '1px solid var(--border)', borderRadius: 10, padding: '1rem', background: 'var(--bg-card)', color: 'var(--text)' }
  const s = score()

  if (finished) return <div className="screen" style={{ paddingBottom: '2rem' }}><h1 className="page-title">Mock Exam Results</h1><div className="card" style={{ textAlign: 'center' }}><div style={{ fontSize: '2.5rem', fontWeight: 800, color: 'var(--accent)' }}>{s.percent}%</div><p>{s.correct} / {s.total} correct</p><p>{s.percent >= 70 ? 'PASS' : 'NOT YET PASSED'} · 70% passing cutoff</p></div><button className="btn btn-primary" style={{ width: '100%', marginTop: 12 }} onClick={() => { reset(); navigate('/mock') }}>Return to Mock Exams</button><button className="btn btn-outline" style={{ width: '100%', marginTop: 8 }} onClick={() => { reset(); navigate('/history') }}>View History</button></div>

  return <div className="screen" style={{ paddingBottom: '7rem', maxWidth: 900, margin: '0 auto' }}>
    <header style={{ position: 'sticky', top: 0, zIndex: 20, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, padding: '0.8rem 0.25rem', background: 'var(--bg)', borderBottom: '3px solid var(--accent)' }}>
      <div><strong style={{ display: 'block' }}>SIMULATED MOCK EXAM</strong><span style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>{answered}/{questions.length} answered</span></div>
      <div aria-live="polite" style={{ fontVariantNumeric: 'tabular-nums', fontWeight: 900, color: timeLeftSec < 60 ? 'var(--danger)' : 'var(--accent)', border: '1px solid var(--border)', padding: '.45rem .7rem', borderRadius: 6 }}>⏱ {formatTime(timeLeftSec)}</div>
    </header>
    <div style={{ ...card, margin: '1rem 0', fontSize: '.9rem', color: 'var(--text-muted)' }}>Answer questions on this continuous scroll page. You cannot return to a previous question or leave the exam. Use <strong>Submit Exam</strong> at the bottom to finish; unanswered items will be counted as incorrect.</div>
    <div style={{ display: 'grid', gap: 12 }}>
      {questions.map((q, index) => {
        const selected = answers[q.id]?.selectedIndex
        return <section
          key={q.id}
          style={{ padding: '1.25rem 0 1.5rem', borderBottom: index < questions.length - 1 ? '1px solid var(--border)' : '0' }}
          aria-labelledby={'mock-question-' + index}
        >
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--text-muted)', fontSize: '.8rem', fontWeight: 800, marginBottom: 8 }}>
            <span>QUESTION {index + 1} OF {questions.length}</span><span>{q.competenceId}</span>
          </div>
          {q.topic && <div style={{ color: 'var(--text-muted)', fontSize: '.82rem', marginBottom: 6 }}>{q.topic}</div>}
          <h2 id={'mock-question-' + index} style={{ fontSize: '1.08rem', lineHeight: 1.55, margin: '0 0 1rem', fontWeight: 800 }}>{q.questionText}</h2>
          <div role="radiogroup" aria-label={'Answers for question ' + (index + 1)} style={{ display: 'grid', gap: 10 }}>
            {q.options.map((option, optionIndex) => {
              const isSelected = selected === optionIndex
              return <button
                key={optionIndex}
                type="button"
                role="radio"
                aria-checked={isSelected}
                disabled={finished}
                onClick={() => selectAnswer(optionIndex)}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 12,
                  width: '100%',
                  textAlign: 'left',
                  padding: '.45rem 0',
                  border: 0,
                  borderRadius: 0,
                  background: 'transparent',
                  color: 'var(--text)',
                  font: 'inherit',
                  lineHeight: 1.5,
                  cursor: finished ? 'default' : 'pointer',
                  boxShadow: 'none',
                  outlineOffset: 3,
                }}
              >
                <span aria-hidden="true" style={{
                  width: 22,
                  height: 22,
                  boxSizing: 'border-box',
                  flex: '0 0 22px',
                  marginTop: 2,
                  borderRadius: '50%',
                  border: '2px solid ' + (isSelected ? 'var(--accent)' : 'var(--text-muted)'),
                  display: 'grid',
                  placeItems: 'center',
                  background: 'transparent',
                }}>
                  {isSelected && <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--accent)' }} />}
                </span>
                <span style={{ flex: 1, minWidth: 0, background: 'transparent', fontWeight: 600 }}>{option}</span>
              </button>
            })}
          </div>
        </section>
      })}
    </div>
    <div style={{ ...card, marginTop: 16, position: 'sticky', bottom: 0, zIndex: 15, boxShadow: '0 -5px 20px rgba(0,0,0,.08)' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12, marginBottom: 10 }}><strong>{answered} / {questions.length} answered</strong><span style={{ color: 'var(--text-muted)', fontSize: '.85rem' }}>{questions.length - answered} unanswered</span></div>
      <button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowSubmitConfirm(true)}>SUBMIT EXAM</button>
    </div>
    {showSubmitConfirm && <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 16 }}><section role="dialog" aria-modal="true" aria-labelledby="submit-mock-title" className="card" style={{ width: 'min(100%, 460px)', padding: 20 }}><h2 id="submit-mock-title" style={{ marginTop: 0 }}>Submit this mock exam?</h2><p>You answered {answered} of {questions.length} questions. {questions.length - answered ? 'Unanswered questions will be marked incorrect.' : 'All questions have been answered.'} You cannot change your answers after submission.</p><div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}><button className="btn btn-outline" onClick={() => setShowSubmitConfirm(false)}>CONTINUE EXAM</button><button className="btn btn-primary" onClick={() => { setShowSubmitConfirm(false); finish() }}>CONFIRM SUBMISSION</button></div></section></div>}
    {showLockNotice && <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 1001, background: 'rgba(0,0,0,.72)', display: 'grid', placeItems: 'center', padding: 16 }}><section role="dialog" aria-modal="true" aria-labelledby="mock-lock-title" className="card" style={{ width: 'min(100%, 420px)', padding: 20 }}><h2 id="mock-lock-title" style={{ marginTop: 0 }}>Exam in progress</h2><p>You cannot go back or leave while the mock exam is active. Submit the exam to finish.</p><button className="btn btn-primary" style={{ width: '100%' }} onClick={() => setShowLockNotice(false)}>RETURN TO EXAM</button></section></div>}
  </div>
}
