import { useEffect, useMemo, useState } from 'react'
import type { CSSProperties } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useUIStore } from '../stores/uiStore'
import { freeSample, getQuestionsByTrack, listAvailableCompetences } from '../lib/questionBank'
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
  const startSession = usePracticeStore(s => s.startSession)
  const competences = listAvailableCompetences(trackId)
  const competenceId = params.get('competence') || undefined
  const competence = competences.find(c => c.id === competenceId)
  const selectedPart = trackId === 'GMDSS_GOC' && competenceId ? Number(params.get('part') || '0') || undefined : undefined
  const gmdssParts = competenceId === 'C1' ? Array.from({ length: 10 }, (_, i) => i + 1) : competenceId === 'C2' ? [1, 2] : []
  const [availableQuestionCount, setAvailableQuestionCount] = useState(0)
  const [startItem, setStartItem] = useState(1)
  const [endItem, setEndItem] = useState(1)
  const [randomizeOrder, setRandomizeOrder] = useState(false)
  const [shuffleChoices, setShuffleChoices] = useState(true)
  const [prioritizeUnseen, setPrioritizeUnseen] = useState(false)
  const [intensiveMode, setIntensiveMode] = useState(false)
  const [starting, setStarting] = useState(false)
  const [hasSavedProgress, setHasSavedProgress] = useState(false)
  useEffect(() => {
    try { setHasSavedProgress(Boolean(localStorage.getItem('hyperion-saved-practice'))) }
    catch { setHasSavedProgress(false) }
  }, [])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const all = await getQuestionsByTrack(trackId)
      const pool = freeMode || !isUnlocked ? freeSample(all, trackId) : all
      let selected = competenceId ? pool.filter(q => q.competenceId === competenceId) : pool
      if (selectedPart != null) selected = selected.filter(q => q.id.includes('-P' + selectedPart + '-'))
      if (cancelled) return
      const count = selected.length
      setAvailableQuestionCount(count)
      setStartItem(1)
      setEndItem(Math.max(1, count))
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
    if (isDrill && !isUnlocked) { openPaywall('Drill'); return }
    setStarting(true)
    try {
      await startSession({
        mode: sessionMode, track: trackId, competenceId, limit: itemCount,
        startItem: actualStart, part: selectedPart, randomizeOrder: randomizeOrder || prioritizeUnseen,
        shuffleChoices, free: freeMode || !isUnlocked
      })
      navigate('/practice/quiz')
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
    {hasSavedProgress && <section className="card" style={{ marginBottom: '1rem', borderColor: 'var(--accent)' }}>
      <strong>Saved practice session available</strong>
      <p style={{ color: 'var(--text-muted)', margin: '.35rem 0 .75rem' }}>Continue where you left off instead of starting a new session.</p>
      <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={() => navigate('/practice/quiz')}>Resume Saved Session</button>
    </section>}
    <button type="button" onClick={() => navigate(competenceId ? `/practice/competences?track=${trackParam}${freeMode ? '&free=1' : ''}` : `/track?track=${trackParam}`)} style={{ ...muted, marginBottom: '.8rem', padding: '.4rem 0' }}>← Back</button>
    <div style={{ ...panel, borderTop: '3px solid #00e5a0', background: 'var(--bg-elevated)', marginBottom: '1.2rem' }}>
      <div style={{ ...muted, background: 'var(--accent-soft)', color: 'var(--text)', display: 'inline-block', padding: '.2rem .5rem', fontWeight: 900, letterSpacing: '.12em', fontSize: '.75rem' }}>STEP 2 OF 2 · {freeMode ? 'FREE REVIEWER' : isDrill ? 'DRILL CONFIGURATION' : 'PRACTICE ALL QUESTIONS'}</div>
      <h1 style={{ fontSize: '1.25rem', lineHeight: 1.35, fontWeight: 900, margin: '.65rem 0 .25rem' }}>{freeMode ? `${TRACK_LABELS[trackId]} Free Reviewer` : isDrill ? 'Configure Drill' : 'Configure Practice: ' + (competence ? competence.label : TRACK_LABELS[trackId])}</h1>
      <div style={{ color: 'var(--accent)', fontWeight: 900, lineHeight: 1.5 }}>{competence ? `${competenceId} · ${availableQuestionCount} Items` : `${TRACK_LABELS[trackId]} · ${availableQuestionCount} Items`}</div>
      <div style={{ ...muted, fontWeight: 650, lineHeight: 1.5, marginTop: '.25rem' }}>{competence?.label || 'Questions from the selected track, using the available question pool.'}</div>
    </div>

    <section style={{ ...panel, background: 'var(--bg-elevated)', padding: '.75rem' }}>
      <div style={{ ...muted, fontWeight: 900, letterSpacing: '.05em' }}>■ SESSION LOG & TELEMETRY</div>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, color: 'var(--accent)', fontWeight: 900, letterSpacing: '.08em', fontSize: '.8rem', margin: '.7rem 0' }}><span>RECENT SESSIONS</span><span>SESSION HISTORY »</span></div>
      <div style={{ border: '1px solid var(--border)', padding: '.8rem', ...muted, fontSize: '.85rem', lineHeight: 1.6 }}>Session history for this competence will appear here after you complete a session.</div>
    </section>

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
      <button type="button" onClick={() => setIntensiveMode(false)} style={{ width: '100%', textAlign: 'left', background: !intensiveMode ? 'var(--bg-elevated)' : 'var(--bg-card)', color: 'var(--text)', border: `2px solid ${!intensiveMode ? 'var(--accent)' : 'var(--border)'}`, padding: '.85rem', marginBottom: '.7rem' }}>
        <div style={{ fontWeight: 900, fontSize: '1rem' }}>◉　Standard Drill <span style={{ float: 'right', color: '#94a3b8', fontSize: '.7rem' }}>FIXED ITEMS</span></div>
        <div style={{ ...muted, lineHeight: 1.5, margin: '.4rem 0 0 2rem' }}>Progress through each question once with immediate answer verification. Concludes with a session summary.</div>
      </button>
      <button type="button" onClick={() => setIntensiveMode(true)} style={{ width: '100%', textAlign: 'left', background: intensiveMode ? 'var(--bg-elevated)' : 'var(--bg-card)', color: 'var(--text)', border: `1px solid ${intensiveMode ? 'var(--accent)' : 'var(--border)'}`, padding: '.85rem' }}>
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
        {rangePresets.map(p => <button key={p.label} type="button" onClick={() => { setStartItem(1); setEndItem(Math.min(maxRange, p.count)); }} style={{ ...smallButton, background: startItem === 1 && endItem === Math.min(maxRange, p.count) ? 'var(--accent)' : 'var(--bg-elevated)', color: 'var(--text)', fontSize: '.78rem', padding: '.45rem .2rem' }}>{p.label}</button>)}
      </div>
      <input aria-label="Question range start" type="range" min={1} max={maxRange} value={actualStart} onChange={e => { const n = Number(e.target.value); setStartItem(n); if (n > endItem) setEndItem(n); }} style={{ width: '100%', accentColor: '#22c55e' }} />
      <input aria-label="Question range end" type="range" min={actualStart} max={maxRange} value={actualEnd} onChange={e => setEndItem(Number(e.target.value))} style={{ width: '100%', accentColor: '#22c55e', marginTop: '.5rem' }} />
      <div style={{ display: 'flex', justifyContent: 'space-between', ...muted, fontSize: '.78rem', fontWeight: 800, margin: '.4rem 0 1.2rem' }}><span>Item #{actualStart}</span><span style={{ color: '#22c55e', letterSpacing: '.08em' }}>Selected: {itemCount.toLocaleString()} items</span><span>Item #{actualEnd}</span></div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '.8rem' }}>
        <label style={{ ...muted, fontWeight: 800, fontSize: '.8rem' }}>Start Item (#)<input type="number" min={1} max={actualEnd} value={actualStart} onChange={e => { const n = Math.max(1, Math.min(Number(e.target.value) || 1, actualEnd)); setStartItem(n); }} style={{ ...fieldStyle, display: 'block', marginTop: '.35rem' }} /></label>
        <label style={{ ...muted, fontWeight: 800, fontSize: '.8rem' }}>End Item (#)<input type="number" min={actualStart} max={maxRange} value={actualEnd} onChange={e => setEndItem(Math.max(actualStart, Math.min(Number(e.target.value) || actualStart, maxRange)))} style={{ ...fieldStyle, display: 'block', marginTop: '.35rem' }} /></label>
      </div>
      <div style={{ background: 'var(--bg-elevated)', color: 'var(--text)', border: '1px solid var(--border)', padding: '.65rem .8rem', marginTop: '1rem', fontSize: '.82rem', fontWeight: 800 }}>Session Scope: <span style={{ color: '#22c55e' }}>Item #{actualStart} to #{actualEnd} ({itemCount.toLocaleString()} Questions)</span></div>
      {freeMode && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Free Reviewer pool: {availableQuestionCount.toLocaleString()} questions for this track and competence. The range is limited to this pool.</p>}
      {!freeMode && !isUnlocked && <p style={{ ...muted, fontSize: '.8rem', marginBottom: 0 }}>Only the free sample is available until a key is activated.</p>}
    </section>

    <button type="button" disabled={starting || availableQuestionCount === 0} onClick={start} style={{ width: '100%', minHeight: 58, background: 'var(--accent)', color: 'var(--btn-primary-text)', border: 0, fontSize: '1.05rem', fontWeight: 900, padding: '.8rem', opacity: starting || availableQuestionCount === 0 ? .65 : 1 }}>
      ▶　{starting ? 'Preparing Questions…' : `Start Reviewing (${itemCount.toLocaleString()} Items: #${actualStart}–#${actualEnd})`}
    </button>
  </div>
}
