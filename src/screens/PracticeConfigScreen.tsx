import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { usePracticeStore } from '../stores/practiceStore'
import { listAvailableCompetences } from '../lib/questionBank'
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

export default function PracticeConfigScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'
  const freeMode = params.get('free') === '1'
  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const startSession = usePracticeStore((s) => s.startSession)
  const competences = listAvailableCompetences(trackId)

  const [competenceId, setCompetenceId] = useState<string | undefined>()
  const [startItem, setStartItem] = useState(1)
  const [endItem, setEndItem] = useState(freeMode || !isUnlocked ? 5 : 15)
  const [randomizeOrder, setRandomizeOrder] = useState(false)
  const [shuffleChoices, setShuffleChoices] = useState(isUnlocked)
  const [starting, setStarting] = useState(false)
  const maxRange = freeMode || !isUnlocked ? 5 : 2000
  const actualStart = Math.max(1, Math.min(startItem, maxRange))
  const actualEnd = Math.max(actualStart, Math.min(endItem, maxRange))
  const itemCount = actualEnd - actualStart + 1

  const start = async () => {
    setStarting(true)
    try {
      await startSession({
        mode: 'PRACTICE',
        track: trackId,
        competenceId,
        limit: itemCount,
        startItem: actualStart,
        randomizeOrder,
        shuffleChoices,
        free: freeMode
      })
      navigate('/practice/quiz')
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
        onClick={() => navigate(`/track?track=${trackParam}`)}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Back to Track
      </button>

      <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
        <div style={{ color: 'var(--text-muted)', fontSize: '0.72rem', letterSpacing: '0.12em', fontWeight: 800 }}>
          STEP 2 OF 2 · PRACTICE CONFIGURATION
        </div>
        <h1 className="page-title" style={{ marginTop: 8, marginBottom: 4 }}>Configure Practice</h1>
        <p className="subtitle" style={{ marginBottom: 0 }}>{TRACK_LABELS[trackId]} · choose your question pool and delivery settings</p>
      </div>

      {(freeMode || !isUnlocked) && (
        <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}>
          FREE ACCESS: up to 5 questions per session. Activate a key to configure a larger question range.
        </div>
      )}

      <section style={{ marginBottom: '1rem' }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.6rem' }}>1. SELECT COMPETENCE</h2>
        <div style={{ display: 'grid', gap: 8 }}>
          <button
            type="button"
            className="card"
            onClick={() => setCompetenceId(undefined)}
            style={{ textAlign: 'left', width: '100%', borderRadius: 2, border: `1px solid ${!competenceId ? 'var(--accent)' : 'var(--border)'}` }}
          >
            <div style={{ fontWeight: 800 }}>{!competenceId ? '✓ ' : ''}ALL COMPETENCIES</div>
            <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 3 }}>Mix questions from the selected track</div>
          </button>
          {competences.map((c) => (
            <button
              key={c.id}
              type="button"
              className="card"
              onClick={() => setCompetenceId(c.id)}
              style={{ textAlign: 'left', width: '100%', borderRadius: 2, border: `1px solid ${competenceId === c.id ? 'var(--accent)' : 'var(--border)'}` }}
            >
              <div style={{ fontWeight: 800 }}>{competenceId === c.id ? '✓ ' : ''}COMPETENCE {c.id}</div>
              <div style={{ fontSize: '0.82rem', color: 'var(--text-muted)', marginTop: 3 }}>{c.label}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card" style={{ marginBottom: '1rem', borderRadius: 2 }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.35rem' }}>2. QUESTION RANGE</h2>
        <p style={{ fontSize: '0.82rem', color: 'var(--text-muted)', margin: '0 0 0.85rem' }}>
          Choose which item numbers to include. Your session will contain {itemCount} question{itemCount === 1 ? '' : 's'}.
        </p>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            START ITEM
            <input type="number" min={1} max={maxRange} value={actualStart} disabled={maxRange === 5}
              onChange={(e) => { const n = Number(e.target.value) || 1; setStartItem(Math.max(1, Math.min(n, actualEnd))); }}
              style={{ ...controlStyle, display: 'block', marginTop: 5 }} />
          </label>
          <label style={{ fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            END ITEM
            <input type="number" min={actualStart} max={maxRange} value={actualEnd} disabled={maxRange === 5}
              onChange={(e) => { const n = Number(e.target.value) || actualStart; setEndItem(Math.max(actualStart, Math.min(n, maxRange))); }}
              style={{ ...controlStyle, display: 'block', marginTop: 5 }} />
          </label>
        </div>
        {maxRange === 5 && <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', marginBottom: 0 }}>The free tier uses a fixed 1–5 question range.</p>}
      </section>

      <section className="card" style={{ marginBottom: '1rem', borderRadius: 2 }}>
        <h2 style={{ fontSize: '0.95rem', letterSpacing: '0.06em', margin: '0 0 0.75rem' }}>3. DELIVERY SETTINGS</h2>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0', borderBottom: '1px solid var(--border)' }}>
          <span>
            <strong style={{ display: 'block' }}>Randomize question order</strong>
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Off follows the selected item order.</span>
          </span>
          <input type="checkbox" checked={randomizeOrder} onChange={(e) => setRandomizeOrder(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
        </label>
        <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '0.7rem 0' }}>
          <span>
            <strong style={{ display: 'block' }}>Shuffle choices (A/B/C/D)</strong>
            <span style={{ display: 'block', fontSize: '0.8rem', color: 'var(--text-muted)' }}>Reorders options and keeps the correct answer key aligned.</span>
          </span>
          <input type="checkbox" checked={shuffleChoices} onChange={(e) => setShuffleChoices(e.target.checked)} style={{ width: 20, height: 20, accentColor: 'var(--accent)' }} />
        </label>
      </section>

      <button className="btn btn-primary" type="button" disabled={starting} onClick={start} style={{ width: '100%', minHeight: 48 }}>
        {starting ? 'Preparing Questions…' : `START PRACTICE · ${itemCount} QUESTIONS`}
      </button>
    </div>
  )
}
