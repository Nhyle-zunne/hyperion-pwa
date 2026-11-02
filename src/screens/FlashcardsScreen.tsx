import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import QuestionBookmarkButton from '../components/QuestionBookmarkButton'
import { TRACK_LABELS } from '../lib/trackLabels'
import './FlashcardsScreen.css'
import { getFlashcardQuestions, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function FlashcardsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'

  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)

  const [session, setSession] = useState<Question[] | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [known, setKnown] = useState(0)
  const [unknown, setUnknown] = useState(0)

  const competences = listAvailableCompetences(trackId)

  const start = async (competenceId?: string) => {
    if (!isUnlocked) {
      openPaywall('Flashcards')
      return
    }
    setLoading(true)
    setError(null)
    setFlipped(false)
    setIndex(0)
    setKnown(0)
    setUnknown(0)
    try {
      const qs = await getFlashcardQuestions(trackId, competenceId, 20)
      if (qs.length === 0) {
        setError('No questions available for this selection.')
        setLoading(false)
        return
      }
      setSession(shuffle(qs).slice(0, Math.min(20, qs.length)))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Flashcards are unavailable. Connect to the internet or download this track first.')
    }
    setLoading(false)
  }

  const header = (subtitle: string, back: () => void) => <header className="flashcard-heading">
    <button type="button" className="flashcard-back" onClick={back} aria-label="Back from flashcards">← Back</button>
    <div><p className="flashcard-eyebrow">ACTIVE RECALL</p><h1>Flashcard Revision Mode</h1><p className="flashcard-subtitle">{TRACK_LABELS[trackId]} · {subtitle}</p></div>
  </header>

  if (loading) return <div className="screen flashcards-screen">{header('Preparing your deck', () => navigate(`/track?track=${trackParam}`))}<p className="flashcard-empty" role="status">Loading flashcards…</p></div>

  if (session && session.length > 0) {
    if (index >= session.length) return <div className="screen flashcards-screen">
      {header('Session complete', () => setSession(null))}
      <section className="flashcard-summary">
        <span className="flashcard-badge">REVISION COMPLETE</span><h2>Flashcards done</h2><p>{session.length} cards reviewed</p>
        <div className="flashcard-totals"><div><strong>{known}</strong><span>Knew it</span></div><div><strong>{unknown}</strong><span>Still learning</span></div></div>
      </section>
      <div className="flashcard-actions"><button type="button" className="btn btn-outline" onClick={() => navigate('/')}>Home</button><button type="button" className="btn btn-primary" onClick={() => setSession(null)}>New set</button></div>
    </div>

    const q = session[index]
    return <div className="screen flashcards-screen">
      {header(`${session.length} cards · Active recall`, () => setSession(null))}
      <div className="flashcard-progress" role="progressbar" aria-label="Flashcard progress" aria-valuemin={0} aria-valuemax={session.length} aria-valuenow={index + 1}><span style={{ width: `${(index + 1) / session.length * 100}%` }} /></div>
      <div className="flashcard-meta"><span>CARD {index + 1} OF {session.length} · {q.competenceId}</span><QuestionBookmarkButton question={q} /></div>
      <button type="button" className={`flashcard-face${flipped ? ' is-flipped' : ''}`} onClick={() => setFlipped(value => !value)} aria-label={flipped ? 'Show question' : 'Reveal answer'}>
        <div className="flashcard-content">
          <div className="flashcard-face-meta"><span className="flashcard-badge">{flipped ? 'CORRECT ANSWER' : 'QUESTION PROMPT'}</span>{!flipped && <span className="flashcard-difficulty">{q.difficulty === 'EASY' ? 'Easy' : q.difficulty === 'MODERATE' ? 'Moderate' : 'Difficult'}</span>}</div>
          {!flipped ? <><p className="flashcard-topic">{q.topic}</p><p className="flashcard-question">{q.questionText}</p></> : <>
            <div className="flashcard-answer"><span className="flashcard-answer-letter">{String.fromCharCode(65 + q.correctAnswerIndex)}</span><strong>{q.options[q.correctAnswerIndex]}</strong></div>
            <div className="flashcard-options">{q.options.map((option, optionIndex) => <div key={optionIndex} className={optionIndex === q.correctAnswerIndex ? 'is-correct' : ''}>{String.fromCharCode(65 + optionIndex)}. {option}</div>)}</div>
            {q.explanation && <p className="flashcard-explanation">{q.explanation}</p>}
          </>}
        </div>
        <span className="flashcard-flip-hint">↻ Tap to flip to {flipped ? 'question' : 'answer'}</span>
      </button>
      <footer className="flashcard-footer">
        <div className="flashcard-counts"><span><strong>{known}</strong> Knew it</span><span><strong>{unknown}</strong> Still learning</span></div>
        <div className="flashcard-actions"><button type="button" className="btn btn-outline" onClick={() => { setUnknown(value => value + 1); setFlipped(false); setIndex(value => value + 1) }}>Still learning</button><button type="button" className="btn btn-primary" onClick={() => { setKnown(value => value + 1); setFlipped(false); setIndex(value => value + 1) }}>Knew it →</button></div>
        <button type="button" className="flashcard-end" onClick={() => setSession(null)}>End session</button>
      </footer>
    </div>
  }

  return <div className="screen flashcards-screen">
    {header('Choose your revision deck', () => navigate(`/track?track=${trackParam}`))}
    <nav className="flashcard-track-selector" aria-label="Flashcard track">{Object.entries(TRACK_MAP).map(([key, id]) => <button type="button" key={key} aria-pressed={trackId === id} onClick={() => navigate(`/flashcards?track=${key}`)}>{TRACK_LABELS[id]}</button>)}</nav>
    {error && <div className="flashcard-notice" role="alert">{error}</div>}
    {!isUnlocked && <div className="flashcard-notice">Activate a key to unlock flashcards.</div>}
    <button type="button" className="flashcard-mixed" onClick={() => void start()}><span className="flashcard-badge">ALL COMPETENCES</span><span className="flashcard-deck-title">Mixed deck <span aria-hidden="true">→</span></span><span>20 cards · Random from this track</span></button>
    <section className="flashcard-decks" aria-label="Choose a competence"><h2>Choose a competence</h2><p>Focus your recall on one competence, then tap each card to reveal its answer.</p><div className="flashcard-competences">{competences.map(c => <button type="button" key={c.id} onClick={() => void start(c.id)}><span className="flashcard-competence-id">{c.id}</span><span>{c.label.replace(c.id + ' · ', '')}</span><span aria-hidden="true">→</span></button>)}</div></section>
  </div>
}
