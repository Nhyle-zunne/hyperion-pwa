import CompetenceDirectory from '../components/CompetenceDirectory'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import QuestionBookmarkButton from '../components/QuestionBookmarkButton'
import { TRACK_LABELS } from '../lib/trackLabels'
import './FlashcardsScreen.css'
import { getQuestionCountsByTrack, listAvailableCompetences, type QuestionBankCount } from '../lib/questionBank'
import { createFlashcardDeck, loadFlashcardPage, type FlashcardDeck } from '../lib/flashcardDeck'
import type { Question, TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}

export default function FlashcardsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'

  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)

  const [session, setSession] = useState<FlashcardDeck | null>(null)
  const [page, setPage] = useState<{ questions: Question[]; pageStart: number }>({ questions: [], pageStart: 0 })
  const [counts, setCounts] = useState<QuestionBankCount[] | null>(null)
  const [countsError, setCountsError] = useState('')
  const [advancing, setAdvancing] = useState(false)
  const requestGeneration = useRef(0)
  const advancingRef = useRef(false)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [known, setKnown] = useState(0)
  const [unknown, setUnknown] = useState(0)

  const competences = listAvailableCompetences(trackId)

  useEffect(() => {
    let cancelled = false
    requestGeneration.current++
    setSession(null)
    setPage({ questions: [], pageStart: 0 })
    setLoading(false)
    setAdvancing(false)
    advancingRef.current = false
    setCounts(null)
    setCountsError('')
    if (isUnlocked) void getQuestionCountsByTrack(trackId, false).then(value => {
      if (!cancelled) setCounts(value)
    }).catch(() => { if (!cancelled) setCountsError('Could not load verified question counts. Reconnect or check this track’s offline download.') })
    return () => { cancelled = true; requestGeneration.current++ }
  }, [trackId, isUnlocked])

  const endSession = () => {
    requestGeneration.current++
    setSession(null)
    setError(null)
    setAdvancing(false)
    advancingRef.current = false
  }

  const start = async (competenceId?: string) => {
    if (!isUnlocked) { openPaywall('Flashcards'); return }
    const generation = ++requestGeneration.current
    setLoading(true)
    setError(null)
    try {
      const verifiedCounts = await getQuestionCountsByTrack(trackId, false)
      const deck = createFlashcardDeck(trackId, verifiedCounts, competenceId)
      if (!deck.total) throw new Error('No questions available for this selection.')
      const firstPage = await loadFlashcardPage(deck, 0)
      if (generation !== requestGeneration.current) return
      setCounts(verifiedCounts)
      setSession(deck)
      setPage(firstPage)
      setFlipped(false)
      setIndex(0)
      setKnown(0)
      setUnknown(0)
    } catch (error) {
      if (generation === requestGeneration.current) setError(error instanceof Error ? error.message : 'Flashcards are unavailable. Open this track online to prepare it for offline study.')
    } finally {
      if (generation === requestGeneration.current) setLoading(false)
    }
  }

  const advance = async (knew: boolean) => {
    if (!session || advancingRef.current) return
    const generation = requestGeneration.current
    advancingRef.current = true
    setAdvancing(true)
    setError(null)
    try {
      const next = index + 1
      if (next < session.total && next >= page.pageStart + page.questions.length) {
        const nextPage = await loadFlashcardPage(session, next)
        if (generation !== requestGeneration.current) return
        setPage(nextPage)
      }
      if (generation !== requestGeneration.current) return
      if (knew) setKnown(value => value + 1)
      else setUnknown(value => value + 1)
      setFlipped(false)
      setIndex(next)
    } catch (error) {
      if (generation === requestGeneration.current) setError(error instanceof Error ? error.message : 'Could not load the next cards. Your current card is preserved; retry when connected.')
    } finally {
      if (generation === requestGeneration.current) { advancingRef.current = false; setAdvancing(false) }
    }
  }

  const header = (subtitle: string, back: () => void) => <header className="flashcard-heading">
    <button type="button" className="flashcard-back" onClick={back} aria-label="Back from flashcards">← Back</button>
    <div><p className="flashcard-eyebrow">ACTIVE RECALL</p><h1>Flashcard Revision Mode</h1><p className="flashcard-subtitle">{TRACK_LABELS[trackId]} · {subtitle}</p></div>
  </header>

  if (loading) return <div className="screen flashcards-screen">{header('Preparing your deck', () => navigate(`/track?track=${trackParam}`))}<p className="flashcard-empty" role="status">Loading flashcards…</p></div>

  if (session && session.total > 0) {
    if (index >= session.total) return <div className="screen flashcards-screen">
      {header('Session complete', endSession)}
      <section className="flashcard-summary">
        <span className="flashcard-badge">REVISION COMPLETE</span><h2>Flashcards done</h2><p>{session.total} cards reviewed</p>
        <div className="flashcard-totals"><div><strong>{known}</strong><span>Knew it</span></div><div><strong>{unknown}</strong><span>Still learning</span></div></div>
      </section>
      <div className="flashcard-actions"><button type="button" className="btn btn-outline" onClick={() => navigate('/')}>Home</button><button type="button" className="btn btn-primary" onClick={endSession}>New set</button></div>
    </div>

    const q = page.questions[index - page.pageStart]
    return <div className="screen flashcards-screen">
      {header(`${session.total} cards · Active recall`, endSession)}
      <div className="flashcard-progress" role="progressbar" aria-label="Flashcard progress" aria-valuemin={0} aria-valuemax={session.total} aria-valuenow={index + 1}><span style={{ width: `${(index + 1) / session.total * 100}%` }} /></div>
      <div className="flashcard-meta"><span>CARD {index + 1} OF {session.total} · {q.competenceId}</span><QuestionBookmarkButton question={q} /></div>
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
      {error && <div className="flashcard-notice" role="alert">{error}</div>}
      <footer className="flashcard-footer">
        <div className="flashcard-counts"><span><strong>{known}</strong> Knew it</span><span><strong>{unknown}</strong> Still learning</span></div>
        <div className="flashcard-actions"><button type="button" className="btn btn-outline" disabled={advancing} onClick={() => void advance(false)}>Still learning</button><button type="button" className="btn btn-primary" disabled={advancing} onClick={() => void advance(true)}>Knew it →</button></div>
        {advancing && <p role="status" className="flashcard-subtitle">Loading the next cards…</p>}
        <button type="button" className="flashcard-end" onClick={endSession}>End session</button>
      </footer>
    </div>
  }

  return <div className="screen practice-competence-screen flashcards-selection-screen" style={{ padding: '0 0 2rem', color: 'var(--text)' }}>
    <CompetenceDirectory
      title={`${TRACK_LABELS[trackId]} Flashcards`}
      totalCount={counts ? counts.reduce((sum, group) => sum + group.count, 0) : null}
      countError={countsError}
      onBack={() => navigate(`/track?track=${trackParam}`)}
      onSelect={id => void start(id)} allQuestions={() => void start()}
      items={competences.map(c => ({ ...c, count: counts ? counts.filter(group => group.competenceId === c.id).reduce((sum, group) => sum + group.count, 0) : undefined }))}
    >
      {error && <div className="flashcard-notice" role="alert">{error}</div>}
      {!isUnlocked && <div className="flashcard-notice">Activate a key to unlock flashcards.</div>}
    </CompetenceDirectory>
  </div>
}
