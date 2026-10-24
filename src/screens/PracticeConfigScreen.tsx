import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useUIStore } from '../stores/uiStore'
import { freeSample, getQuestionsByCompetence, getQuestionsByTrack, listAvailableCompetences } from '../lib/questionBank'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW', GMDSS_GOC: 'GMDSS GOC', ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Management', ENGINE_MGT: 'Engine Management'
}
const FUNCTION_LABELS: Record<string, string> = { F1: 'Navigation at the Operational Level', F2: 'Cargo Handling and Stowage', F3: 'Controlling the Operation of the Ship' }
const panel: React.CSSProperties = { background: '#1e293b', border: '1px solid #334155', borderRadius: 0, padding: '1.1rem', marginBottom: '1rem' }
const sectionTitle: React.CSSProperties = { color: '#22c55e', fontSize: '.95rem', letterSpacing: '.07em', fontWeight: 900, margin: '0 0 1rem' }
const muted: React.CSSProperties = { color: '#94a3b8' }
const smallButton: React.CSSProperties = { background: '#334155', border: '1px solid #475569', color: '#cbd5e1', padding: '.6rem .7rem', fontWeight: 800, minHeight: 40 }

export default function PracticeConfigScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'
  const freeMode = params.get('free') === '1'
  const isDrill = params.get('mode') === 'drill'
  const sessionMode = isDrill ? 'DRILL' : 'PRACTICE'
  const openPaywall = useUIStore(s => s.openPaywall)
  const isUnlocked = useLicenseStore(s => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const startSession = usePracticeStore(s => s.startSession)
  const competences = listAvailableCompetences(trackId)
  const competenceId = params.get('competence') || undefined
  const competence = competences.find(c => c.id === competenceId)
  const [availableQuestionCount, setAvailableQuestionCount] = useState(0)
  const [startItem, setStartItem] = useState(1)
  const [endItem, setEndItem] = useState(1)
  const [randomizeOrder, setRandomizeOrder] = useState(false)
  const [shuffleChoices, setShuffleChoices] = useState(true)
  const [prioritizeUnseen, setPrioritizeUnseen] = useState(false)
  const [intensiveMode, setIntensiveMode] = useState(false)
  const [starting, setStarting] = useState(false)

  useEffect(() => {
    let cancelled = false
    async function load() {
      const all = await getQuestionsByTrack(trackId)
      const pool = freeMode || !isUnlocked ? freeSample(all, trackId) : all
      const selected = competenceId ? pool.filter(q => q.competenceId === competenceId) : pool
      if (cancelled) return
      const count = selected.length
      setAvailableQuestionCount(count)
      setStartItem(1)
      setEndItem(Math.max(1, count))
    }
    void load()
    return () => { cancelled = true }
  }, [trackId, competenceId, freeMode, isUnlocked])

  const maxRange = Math.max(1, availableQuestionCount)
  const actualStart = Math.max(1, Math.min(startItem, maxRange))
  const actualEnd = Math.max(actualStart, Math.min(endItem, maxRange))
  const itemCount = actualEnd - actualStart + 1
  const rangePresets = useMemo(() => [
    { label: '1–25', count: 25 }, { label: '1–50', count: 50 },
    { label: '1–100', count: 100 }, { label: `All (1–${maxRange})`, count: maxRange }
  ], [maxRange])

  const start = async () => {
    if (isDrill && !isUnlocked) { openPaywall('Drill'); return }
    setStarting(true)
    try {
      await startSession({
        mode: sessionMode, track: trackId, competenceId, limit: itemCount,
        startItem: actualStart, randomizeOrder: randomizeOrder || prioritizeUnseen,
        shuffleChoices, free: freeMode || !isUnlocked
      })
      navigate('/practice/quiz')
    } finally { setStarting(false) }
  }

  const fieldStyle: React.CSSProperties = {
    width: '100%', minHeight: 58, padding: '.6rem .8rem', background: '#1e293b',
    color: '#f8fafc', border: '1px solid #334155', borderRadius: 0, font: 'inherit', fontWeight: 800
  }
  const toggleRow = (title: string, description: string, value: boolean, setValue: (v: boolean) => void, badge: string) => (
    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '.75rem', alignItems: 'center', padding: '.75rem 0' }}>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontWeight: 900, color: '#f8fafc' }}>{title} <span style={{ color: value ? '#22c55e' : '#94a3b8', fontSize: '.7rem', border: '1px solid currentColor', padding: '.2rem .35rem', whiteSpace: 'nowrap' }}>{value ? (title.startsWith('Shuffle') ? 'SHUFFLED' : 'ON') : badge}</span></div>
        <div style={{ ...muted, fontSize: '.83rem', lineHeight: 1.5, marginTop: '.25rem' }}>{description}</div>
      </div>
      <button type="button" role="switch" aria-checked={value} onClick={() => setValue(!value)} style={{ background: value ? '#22c55e' : '#64748b', color: 'white', border: '1px solid #94a3b8', padding: '.45rem .6rem', fontWeight: 900, minWidth: 82 }}>{value ? 'ON  ▥' : '▥  OFF'}</button>
    </div>
  )

  return <div className="screen" style={{ padding: '0 0 2rem', color: '#f8fafc' }}>
    <button type="button" onClick={() => navigate(competenceId ? `/practice/competences?track=${trackParam}${freeMode ? '&free=1' : ''}` : `/track?track=${trackParam}`)} style={{ ...muted, marginBottom: '.8rem', padding: '.4rem 0' }}>← Back</button>
    <div style={{ ...panel, borderTop: '3px solid #00e5a0', background: 'linear-gradient(120deg,#172b31,#1e293b)', marginBottom: '1.2rem' }}>
      <div style={{ ...muted, background: '#334155', display: 'inline-block', padding: '.2rem .5rem', fontWeight: 900, letterSpacing: '.12em', fontSize: '.75rem' }}>STEP 2 OF 2 · {freeMode ? 'FREE REVIEWER' : isDrill ? 'DRILL CONFIGURATION' : 'PRACTICE ALL QUESTIONS'}</div>
      <h1 style={{ fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 900, margin: '.65rem 0 .25rem' }}>{freeMode ? `${TRACK_LABELS[trackId]} Free Reviewer` : isDrill ? 'Configure Drill' : 'Configure Practice: ' + (competence ? competence.label : TRACK_LABELS[trackId])}</h1>
      <div style={{ color: '#22c55e', fontWeight: 900, lineHeight: 1.5 }}>{competence ? `${FUNCTION_LABELS[competence.functionId] || competence.functionId} · ${availableQuestionCount} Items` : `${TRACK_LABELS[trackId]} · ${availableQuestionCount} Items`}</div>
      <div style={{ ...muted, fontWeight: 650, lineHeight: 1.5, marginTop: '.25rem' }}>{competence?.label || 'Questions from the selected track, using the available question pool.'}</div>
    </div>

    <section style={{ ...panel, background: '#0f172a', padding: '.75rem' }}>
      <div style={{ ...muted, fontWeight: 900, letterSpacing: '.05em' }}>■ SESSION LOG & TELEMETRY</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: '#38bdf8', fontWeight: 900, letterSpacing: '.08em', fontSize: '.8rem', margin: '.7rem 0' }}><span>RECENT SESSIONS</span><span>SESSION HISTORY »</span></div>
      <div style={{ border: '1px solid #1e293b', padding: '.8rem', ...muted, fontSize: '.85rem', lineHeight: 1.6 }}>Session history for this competence will appear here after you complete a session.</div>
    </section>

    <section style={panel}>
      <h2 style={sectionTitle}>♟ 1. DRILL DELIVERY FORMAT</h2>
      <button type="button" onClick={() => setIntensiveMode(false)} style={{ width: '100%', textAlign: 'left', background: !intensiveMode ? '#1e293b' : 'transparent', color: '#f8fafc', border: `2px solid ${!intensiveMode ? '#22c55e' : '#334155'}`, padding: '.85rem', marginBottom: '.7rem' }}>
        <div style={{ fontWeight: 900, fontSize: '1rem' }}>◉　Standard Drill <span style={{ float: 'right', color: '#94a3b8', fontSize: '.7rem' }}>FIXED ITEMS</span></div>
        <div style={{ ...muted, lineHeight: 1.5, margin: '.4rem 0 0 2rem' }}>Progress through each question once with immediate answer verification. Concludes with a session summary.</div>
      </button>
      <button type="button" onClick={() => setIntensiveMode(true)} style={{ width: '100%', textAlign: 'left', background: intensiveMode ? '#1e293b' : 'transparent', color: '#f8fafc', border: `1px solid ${intensiveMode ? '#22c55e' : '#334155'}`, padding: '.85rem' }}>
        <div style={{ fontWeight: 900, fontSize: '1rem' }}>◯　Intensive Mode <span style={{ float: 'right', color: '#94a3b8', fontSize: '.7rem' }}>RECYCLING QUEUE</span></div>
        <div style={{ ...muted, lineHeight: 1.5, margin: '.4rem 0 0 2rem' }}>Missed questions recycle to the end of the queue. The drill only finishes when all questions are mastered.</div>
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
        {rangePresets.map(p => <button key={p.label} type="button" onClick={() => { setStartItem(1); setEndItem(Math.min(maxRange, p.count)); }} style={{ ...smallButton, background: startItem === 1 && endItem === Math.min(maxRange, p.count) ? '#22c55e' : '#334155', color: startItem === 1 && endItem === Math.min(maxRange, p.count) ? '#fff' : '#cbd5e1', fontSize: '.78rem', padding: '.45rem .2rem' }}>{p.label}</button>)}
      </div>
      <input aria-label="Question range start" type="range" min={1} max={maxRange} value={actualStart} onChange={e => { const n = Number(e.target.value); setStartItem(n); if (n > endItem) setEndItem(n); }} style={{ width: '100%', accentColor: '#22c55e' }} />
      <input aria-label="Question range end" type="range" min={actualStart} max={maxRange} value={actualEnd} onChange={e => setEndItem(Number(e.target.value))} style={{ width: '100%', accentColor: '#22c55e', marginTop: '.5rem' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', ...muted, fontSize: '.78rem', fontWeight: 800, margin: '.4rem 0 1.2rem' }}><span>Item #{actualStart}</span><span style={{ color: '#22c55e', letterSpacing: '.08em' }}>Selected: {itemCount.toLocaleString()} items</span><span>Item #{actualEnd}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
        <label style={{ ...muted, fontWeight: 800, fontSize: '.8rem' }}>Start Item (#)<input type="number" min={1} max={actualEnd} value={actualStart} onChange={e => { const n = Math.max(1, Math.min(Number(e.target.value) || 1, actualEnd)); setStartItem(n); }} style={{ ...fieldStyle, display: 'block', marginTop: '.35rem' }} /></label>
        <label style={{ ...muted, fontWeight: 800, fontSize: '.8rem' }}>End Item (#)<input type="number" min={actualStart} max={maxRange} value={actualEnd} onChange={e => setEndItem(Math.max(actualStart, Math.min(Number(e.target.value) || actualStart, maxRange)))} style={{ ...fieldStyle, display: 'block', marginTop: '.35rem' }} /></label>
      </div>
      <div style={{ background: '#334155', color: '#cbd5e1', padding: '.65rem .8rem', marginTop: '1rem', fontSize: '.82rem', fontWeight: 800 }}>Session Scope: <span style={{ color: '#22c55e' }}>Item #{actualStart} to #{actualEnd} ({itemCount.toLocaleString()} Questions)</span></div>
      {freeMode && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Free Reviewer pool: {availableQuestionCount.toLocaleString()} questions for this track and competence. The range is limited to this pool.</p>}
      {!freeMode && !isUnlocked && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Only the free sample is available until a key is activated.</p>}
    </section>

    <button type="button" disabled={starting || availableQuestionCount === 0} onClick={start} style={{ width: '100%', minHeight: 58, background: '#4ade80', color: '#fff', border: 0, fontSize: '1.05rem', fontWeight: 900, padding: '.8rem', opacity: starting || availableQuestionCount === 0 ? .65 : 1 }}>
      ▶　{starting ? 'Preparing Questions…' : `Start Reviewing (${itemCount.toLocaleString()} Items: #${actualStart}–#${actualEnd})`}
    </button>
  </div>
}
