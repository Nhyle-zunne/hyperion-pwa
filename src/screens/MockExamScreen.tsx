import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { usePracticeStore } from '../stores/practiceStore'
import PracticeQuizScreen from './PracticeQuizScreen'
import { getQuestionsByCompetence, getQuestionsByTrack, listAvailableCompetences } from '../lib/questionBank'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

export default function MockExamScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'
  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const startSession = usePracticeStore((s) => s.startSession)
  const competences = listAvailableCompetences(trackId)

  const [competenceId, setCompetenceId] = useState<string | undefined>()
  const [startItem, setStartItem] = useState(1)
  const [endItem, setEndItem] = useState(30)
  const [availableQuestionCount, setAvailableQuestionCount] = useState(0)

  useEffect(() => {
    let cancelled = false
    const loadQuestionCount = async () => {
      const questions = competenceId
        ? await getQuestionsByCompetence(trackId, competenceId)
        : await getQuestionsByTrack(trackId)
      if (cancelled) return
      const count = questions.length
      setAvailableQuestionCount(count)
      setStartItem((current) => Math.max(1, Math.min(current, Math.max(1, count))))
      setEndItem(Math.max(1, count))
    }
    void loadQuestionCount()
    return () => { cancelled = true }
  }, [trackId, competenceId])
  const [secondsPerQuestion, setSecondsPerQuestion] = useState(60)
  const [randomizeOrder, setRandomizeOrder] = useState(true)
  const [shuffleChoices, setShuffleChoices] = useState(true)
  const [starting, setStarting] = useState(false)

  const maxRange = Math.max(1, availableQuestionCount || 1)
  const actualStart = Math.max(1, Math.min(startItem, maxRange))
  const actualEnd = Math.max(actualStart, Math.min(endItem, maxRange))
  const itemCount = actualEnd - actualStart + 1
  const timeLimitSec = itemCount * secondsPerQuestion

  const start = async () => {
    if (!isUnlocked) {
      openPaywall('Mock Exam')
      return
    }
    setStarting(true)
    try {
      await startSession({
        mode: 'MOCK',
        track: trackId,
        competenceId,
        limit: itemCount,
        startItem: actualStart,
        timeLimitSec,
        randomizeOrder,
        shuffleChoices
      })
      navigate('/mock/exam')
    } finally {
      setStarting(false)
    }
  }

  const controlStyle = {
    width: '100%',
    minHeight: 44,
    padding: '0.65rem 0.75rem',
    border: '1px solid var(--border)',
    borderRadius: 8,
    background: 'var(--bg-card)',
    color: 'var(--text)',
    font: 'inherit'
  } as const

  return (
    <div className="screen" style={{ paddingBottom: '2rem' }}>
      <button
        type="button"
        onClick={() => navigate('/track?track=' + trackParam)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back to Track
      </button>

      <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.12em', fontWeight: 800 }}>
          STCW '78 AS AMENDED · EXAM SETUP
        </div>
        <h1 className="page-title" style={{ marginTop: 8, marginBottom: 4 }}>Configure Mock Exam</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>{TRACK_LABELS[trackId]} · timed examination · 70% passing target</p>
      </div>

      {!isUnlocked && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          Mock exams require an activated license. You can configure your exam here, then activate your key to start.
        </div>
      )}

      <section style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.6rem' }}>1. TRACK</h2>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
          {Object.entries(TRACK_MAP).map(([key, id]) => (
            <button
              key={key}
              type="button"
              className="btn btn-outline"
              style={{ padding: '0.45rem 0.65rem', fontSize: '0.78rem', borderColor: trackId === id ? 'var(--accent)' : undefined, color: trackId === id ? 'var(--accent)' : undefined }}
              onClick={() => navigate(`/mock?track=${key}`)}
            >
              {TRACK_LABELS[id]}
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem', borderRadius: 2 }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.35rem' }}>2. EXAM SCOPE</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.75rem' }}>Choose all competencies or focus the exam on one competence.</p>
        <div style={{ display: 'grid', gap: 8 }}>
          <button type="button" className="card" onClick={() => setCompetenceId(undefined)}
            style={{ textAlign: 'left', width: '100%', borderRadius: 2, border: `1px solid ${!competenceId ? 'var(--accent)' : 'var(--border)'}` }}>
            <strong>{!competenceId ? '✓ ' : ''}ALL COMPETENCIES</strong>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 3 }}>Mixed exam across the selected track</div>
          </button>
          {competences.map((c) => (
            <button key={c.id} type="button" className="card" onClick={() => setCompetenceId(c.id)}
              style={{ textAlign: 'left', width: '100%', borderRadius: 2, border: `1px solid ${competenceId === c.id ? 'var(--accent)' : 'var(--border)'}` }}>
              <strong>{competenceId === c.id ? '✓ ' : ''}COMPETENCE {c.id}</strong>
              <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 3 }}>{c.label}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem', borderRadius: 2 }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.35rem' }}>3. QUESTION RANGE</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.85rem' }}>Select the item range for this attempt.</p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            START ITEM
            <input type="number" min={1} max={maxRange} value={actualStart}
              onChange={(e) => { const n = Number(e.target.value) || 1; setStartItem(Math.max(1, Math.min(n, actualEnd))); }}
              style={{ ...controlStyle, display: 'block', marginTop: 5 }} />
          </label>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            END ITEM
            <input type="number" min={actualStart} max={maxRange} value={actualEnd}
              onChange={(e) => { const n = Number(e.target.value) || actualStart; setEndItem(Math.max(actualStart, Math.min(n, maxRange))); }}
              style={{ ...controlStyle, display: 'block', marginTop: 5 }} />
          </label>
        </div>
        <div style={{ marginTop: 8, fontSize: '0.85rem', color: 'var(--accent)', fontWeight: 800 }}>{itemCount} QUESTIONS SELECTED</div>
        <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginTop: 4 }}>Available in this question pool: {availableQuestionCount}.</div>
      </section>

      <section className="card" style={{ marginBottom: '1rem', borderRadius: 2 }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.75rem' }}>4. TIME LIMIT</h2>
        <label style={{ display: 'block', fontSize: '0.82rem', color: 'var(--text-muted)' }}>
          TIME PER QUESTION
          <select value={secondsPerQuestion} onChange={(e) => setSecondsPerQuestion(Number(e.target.value))}
            style={{ ...controlStyle, display: 'block', marginTop: 5 }}>
            <option value={30}>30 seconds</option>
            <option value={60}>1 minute (Android default)</option>
            <option value={90}>1 minute 30 seconds</option>
            <option value={120}>2 minutes</option>
          </select>
        </label>
        <div style={{ marginTop: 10, fontSize: '0.9rem' }}>
          Total time: <strong>{Math.floor(timeLimitSec / 60)} min{timeLimitSec % 60 ? ` ${timeLimitSec % 60} sec` : ''}</strong>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 4 }}>Target passing score: 70% · answers stay hidden until submission.</div>
      </section>

      <section className="card" style={{ marginBottom: '1rem', borderRadius: 2 }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.35rem' }}>5. DELIVERY SETTINGS</h2>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0', borderBottom: '1px solid var(--border)' }}>
          <span><strong style={{ display: 'block' }}>Randomize question order</strong><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Mix the selected questions before the exam.</span></span>
          <input type="checkbox" checked={randomizeOrder} onChange={(e) => setRandomizeOrder(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0' }}>
          <span><strong style={{ display: 'block' }}>Shuffle answer choices</strong><span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Correct answers remain aligned after shuffling.</span></span>
          <input type="checkbox" checked={shuffleChoices} onChange={(e) => setShuffleChoices(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
        </label>
      </section>

      <button className="btn btn-primary" type="button" disabled={starting} onClick={start} style={{ width: '100%', minHeight: 48 }}>
        {starting ? 'Preparing Exam…' : `START MOCK EXAM · ${itemCount} QUESTIONS`}
      </button>
    </div>
  )
}


// Reuse the shared question runner for timed mock sessions.
export function MockExamRunner() {
  return <PracticeQuizScreen />
}
