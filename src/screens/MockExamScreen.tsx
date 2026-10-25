import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { usePracticeStore } from '../stores/practiceStore'
import { getQuestionsByTrack, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'
import PracticeQuizScreen from './PracticeQuizScreen'

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
const FUNCTION_DESCRIPTIONS: Record<string, string> = {
  F1: 'Navigation, watchkeeping, position fixing and safe navigation procedures.',
  F2: 'Cargo handling, stowage, securing and care of cargo during the voyage.',
  F3: 'Pollution prevention, seaworthiness and legislative compliance.',
  GMDSS: 'Transmit and receive information and provide radio services in emergencies.',
  EW: 'Engineering watchkeeping, machinery operations, maintenance and safety.',
  DM: 'Voyage planning, ship handling, cargo, stability and management duties.',
  EM: 'Propulsion plant, electrical systems, maintenance and engine-room management.'
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
type Stage = 'confirm' | 'functions' | 'competences'

export default function MockExamScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'
  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const startSession = usePracticeStore((s) => s.startSession)
  const [stage, setStage] = useState<Stage>('confirm')
  const [questions, setQuestions] = useState<Question[]>([])
  const [loading, setLoading] = useState(true)
  const [selectedFunctions, setSelectedFunctions] = useState<string[]>([])
  const [startingCompetence, setStartingCompetence] = useState<string | null>(null)
  const [starting, setStarting] = useState(false)
  const [randomizeOrder, setRandomizeOrder] = useState(false)
  const [shuffleChoices, setShuffleChoices] = useState(false)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setQuestions([])
    getQuestionsByTrack(trackId).then((items) => {
      if (cancelled) return
      setQuestions(items)
      setSelectedFunctions([])
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

  const toggleFunction = (id: string) => setSelectedFunctions((current) =>
    current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
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
        timeLimitSec: examItemCount * 60,
        randomizeOrder, shuffleChoices
      })
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
      <div className="card" style={{ borderRadius: 14, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.12em', fontWeight: 800 }}>STCW '78 AS AMENDED · OFFICIAL TIMED MOCK</div>
        <h1 className="page-title" style={{ marginTop: 8, marginBottom: 4 }}>{TRACK_LABELS[trackId]}</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>MARINA-format timed mock examination · 70% passing cutoff · 1 minute per item</p>
      </div>
      <div className="card" style={{ borderRadius: 14 }}>
        <h2 style={{ marginTop: 0 }}>EXAMINATION PROTOCOL</h2>
        <p style={{ color: 'var(--text-muted)' }}>Choose the functions to include, then select a competence to begin. The timer runs only while answering that competence.</p>
        <p>{loading ? 'Loading question bank…' : questions.length.toLocaleString() + ' questions available across ' + competences.length + ' competences.'}</p>
        <button type="button" className="btn btn-primary" disabled={loading} onClick={() => setStage('confirm')} style={{ width: '100%' }}>START OFFICIAL TIMED MOCK EXAM</button>
      </div>

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
            <button type="button" style={{ ...primaryButton, opacity: selectedFunctions.length ? 1 : 0.45 }} disabled={!selectedFunctions.length || loading} onClick={() => setStage('competences')}>PROCEED</button>
          </div>
        </section>
      </div>}

      {stage === 'competences' && <section style={{ marginTop: '1rem' }}>
        <div className="card" style={{ borderTop: '3px solid var(--accent)', borderRadius: 14, marginBottom: '1rem' }}>
          <h2 style={{ marginTop: 0 }}>SELECT A COMPETENCE TO BEGIN</h2>
          <p style={{ color: 'var(--text-muted)', marginBottom: 0 }}>{TRACK_LABELS[trackId]} · {selectedFunctions.join(', ')} · 70% passing cutoff · 1 minute per item</p>
        </div>
        <section className="card" style={{ marginBottom: '1rem' }}>
          <h3 style={{ color: 'var(--accent)', marginTop: 0 }}>DELIVERY SETTINGS</h3>
          <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0.5rem 0' }}>Randomize question order <input type="checkbox" checked={randomizeOrder} onChange={(e) => setRandomizeOrder(e.target.checked)} /></label>
          <label style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '0.5rem 0' }}>Shuffle answer choices <input type="checkbox" checked={shuffleChoices} onChange={(e) => setShuffleChoices(e.target.checked)} /></label>
        </section>
        {groupedCompetences.map((group) => <section key={group.id} style={{ marginBottom: '1.25rem' }}>
          <h3 style={{ color: 'var(--accent)', fontSize: '0.85rem', letterSpacing: '0.08em', marginBottom: 2 }}>{group.label}</h3>
          <p style={{ color: 'var(--text-muted)', fontSize: '0.78rem', fontWeight: 800, marginTop: 0 }}>{group.competences.reduce((sum, c) => sum + mockExamItemCount(trackId, c.id), 0).toLocaleString()} mock exam items · {group.id} function</p>
          <div style={{ display: 'grid', gap: 8 }}>
            {group.competences.map((c) => <button key={c.id} type="button" disabled={starting || !c.count} onClick={() => void start(c.id)} style={{ display: 'flex', alignItems: 'center', gap: 12, width: '100%', textAlign: 'left', padding: '1rem', border: '1px solid var(--border)', borderRadius: 12, background: 'var(--bg-card)', color: 'var(--text)', cursor: 'pointer' }}>
              <span style={{ minWidth: 44, minHeight: 44, display: 'grid', placeItems: 'center', background: 'var(--bg-elevated)', fontWeight: 900 }}>{c.id}</span>
              <span style={{ flex: 1 }}><strong style={{ display: 'block', lineHeight: 1.35 }}>{c.id}: {c.label.replace(/^C\d+\s*[·:-]?\s*/, '')}</strong><span style={{ display: 'block', color: 'var(--text-muted)', fontSize: '0.82rem', marginTop: 5 }}>{mockExamItemCount(trackId, c.id)} mock exam items · {FUNCTION_DESCRIPTIONS[group.id] || 'Timed competence-based mock examination.'}</span></span>
              <span style={{ color: 'var(--text-muted)', fontWeight: 800 }}>{startingCompetence === c.id ? '…' : '→'}</span>
            </button>)}
          </div>
        </section>)}
        {!groupedCompetences.length && <p>No competences are available for the selected functions.</p>}
        <button type="button" style={secondaryButton} onClick={() => setStage('functions')}>← CHANGE FUNCTIONS</button>
      </section>}
    </div>
  )
}

export function MockExamRunner() {
  return <PracticeQuizScreen />
}
