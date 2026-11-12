import SessionElapsedTimer from '../components/SessionElapsedTimer'
import KeywordQuestionText from '../components/KeywordQuestionText'
import QuestionImageGallery from '../components/QuestionImageGallery'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { getQuestionCountsByTrack, getQuestionsByCompetence, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'
import { getQuickScanPosition, quickScanLocalOwner, saveQuickScanPosition } from '../lib/quickScanPosition'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
const PAGE_SIZE = 50

type LoadedQuickScanPage = {
  questions: Question[]
  pageStart: number
  localIndex: number
  warning: string
}

/**
 * A number alone is not a stable resume target when admins retire/add rows.
 * Verify the saved immutable question ID in the fetched 50-question page.
 * If it moved within that page, follow the ID; otherwise reset safely to Q1
 * rather than displaying a different question as the user's old position.
 * We never fetch the full bank just to resolve a tiny local cursor.
 */
async function fetchQuickScanPage(
  track: TrackId, competenceId: string, requestedIndex: number, expectedQuestionId?: string
): Promise<LoadedQuickScanPage> {
  const startItem = Math.floor(requestedIndex / PAGE_SIZE) * PAGE_SIZE + 1
  let questions = await getQuestionsByCompetence(track, competenceId, undefined, false, startItem, PAGE_SIZE)
  const originalIndex = requestedIndex - (startItem - 1)
  if (expectedQuestionId && questions[originalIndex]?.id !== expectedQuestionId) {
    const moved = questions.findIndex(question => question.id === expectedQuestionId)
    if (moved >= 0) {
      return {
        questions, pageStart: startItem - 1, localIndex: moved,
        warning: 'This question changed position after a question-bank update. Your original question has been restored.'
      }
    }
    // If a changed bank no longer contains this ID on its former page, do
    // not trust the old number. Keep additional HTTP reads limited to Q1.
    if (startItem !== 1) {
      questions = await getQuestionsByCompetence(track, competenceId, undefined, false, 1, PAGE_SIZE)
    }
    if (!questions.length) throw new Error('The selected question bank is empty.')
    return {
      questions, pageStart: 0, localIndex: 0,
      warning: 'The question bank changed and your previous question could not be matched. Started at Question 1 to avoid opening the wrong question.'
    }
  }
  if (!questions[originalIndex]) {
    if (startItem === 1) throw new Error('The requested question is no longer available.')
    questions = await getQuestionsByCompetence(track, competenceId, undefined, false, 1, PAGE_SIZE)
    if (!questions.length) throw new Error('The selected question bank is empty.')
    return {
      questions, pageStart: 0, localIndex: 0,
      warning: 'The question bank changed. Restarted at Question 1 because your saved position is out of range.'
    }
  }
  return { questions, pageStart: startItem - 1, localIndex: originalIndex, warning: '' }
}

export default function QuickScanViewerScreen({ onQuestionChange }: { onQuestionChange?: (question: Question | null) => void } = {}) {
  const [textScale, setTextScale] = useState(() => Number(localStorage.getItem('hyperion-question-text-scale')) || 100)
  useEffect(() => {
    const update = (event: Event) => setTextScale((event as CustomEvent<number>).detail)
    window.addEventListener('hyperion:text-scale', update)
    return () => window.removeEventListener('hyperion:text-scale', update)
  }, [])
  const [params] = useSearchParams()
  const key = params.get('track') || 'oic_nw'
  const track = TRACK_MAP[key] || 'DECK_OIC_NW'
  const competenceId = params.get('competence') || ''
  const ownerId = quickScanLocalOwner()
  const resumeImmediately = params.get('resume') === '1'
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [pageStart, setPageStart] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [resumeAt, setResumeAt] = useState<number | null>(null)
  const [resumeQuestionId, setResumeQuestionId] = useState<string | null>(null)
  const [bankNotice, setBankNotice] = useState('')
  const requestId = useRef(0)
  const competence = listAvailableCompetences(track).find(c => c.id === competenceId)

  // A position is only a local navigation hint. It never authorizes paid
  // questions: every page is still fetched through the existing licensed bank.
  const loadQuestionAt = useCallback(async (targetIndex: number, expectedQuestionId?: string) => {
    if (!Number.isSafeInteger(targetIndex) || targetIndex < 0) return
    const id = ++requestId.current
    setLoading(true)
    setResumeAt(null)
    setResumeQuestionId(null)
    setBankNotice('')
    setError('')
    try {
      const page = await fetchQuickScanPage(track, competenceId, targetIndex, expectedQuestionId)
      if (requestId.current !== id) return
      setQuestions(page.questions)
      setPageStart(page.pageStart)
      setIndex(page.localIndex)
      setBankNotice(page.warning)
      setStartedAt(current => current ?? Date.now())
    } catch {
      if (requestId.current !== id) return
      setQuestions([])
      setError('Question access could not be verified. Check your connection and license, then retry.')
    } finally {
      if (requestId.current === id) setLoading(false)
    }
  }, [track, competenceId])

  useEffect(() => {
    let active = true
    const id = ++requestId.current
    setQuestions([])
    setIndex(0)
    setPageStart(0)
    setStartedAt(null)
    setResumeAt(null)
    setResumeQuestionId(null)
    setBankNotice('')
    setLoading(true)
    setError('')
    async function loadInitial() {
      try {
        const counts = await getQuestionCountsByTrack(track, false)
        const count = counts.filter(item => item.competenceId === competenceId).reduce((sum, item) => sum + item.count, 0)
        if (!active || requestId.current !== id) return
        setTotalCount(count)
        if (!count) return

        // IndexedDB has only one tiny cursor per owner/track/competence.
        // Nothing here is added to cloud progress or sent to Supabase.
        const saved = await getQuickScanPosition(track, competenceId, ownerId)
        if (!active || requestId.current !== id) return
        const savedIndex = saved && saved.questionIndex > 0 && saved.questionIndex < count
          ? saved.questionIndex : null
        if (savedIndex !== null && !resumeImmediately) {
          setResumeAt(savedIndex)
          setResumeQuestionId(saved?.questionId ?? null)
          return // Wait for the user's choice before downloading any question page.
        }
        const targetIndex = resumeImmediately && savedIndex !== null ? savedIndex : 0
        const page = await fetchQuickScanPage(
          track, competenceId, targetIndex,
          resumeImmediately && savedIndex !== null ? saved?.questionId : undefined
        )
        if (!active || requestId.current !== id) return
        setQuestions(page.questions)
        setStartedAt(page.questions.length ? Date.now() : null)
        setIndex(page.localIndex)
        setPageStart(page.pageStart)
        setBankNotice(
          saved && saved.questionIndex > 0 && saved.questionIndex >= count
            ? 'Your saved question number is outside the updated question bank. Started at Question 1.'
            : page.warning
        )
      } catch {
        if (active && requestId.current === id) {
          setQuestions([])
          setTotalCount(0)
          setError('Question access could not be verified. Refresh the page or renew the track license.')
        }
      } finally {
        if (active && requestId.current === id) setLoading(false)
      }
    }
    void loadInitial()
    return () => { active = false; requestId.current++ }
  }, [track, competenceId, ownerId, resumeImmediately])

  const globalIndex = pageStart + index
  const q = questions[index]
  useEffect(() => {
    onQuestionChange?.(loading ? null : q ?? null)
    return () => onQuestionChange?.(null)
  }, [q, loading, onQuestionChange])

  // Saving the actual displayed question avoids losing a previous cursor while
  // the resume choice is open. The local write queue keeps rapid jumps ordered.
  useEffect(() => {
    if (!loading && resumeAt === null && q && totalCount > 0) {
      void saveQuickScanPosition(track, competenceId, globalIndex, q.id, ownerId)
    }
  }, [track, competenceId, ownerId, globalIndex, q?.id, loading, resumeAt, totalCount])

  const previous = async () => {
    if (index > 0) setIndex(current => current - 1)
    else if (globalIndex > 0) await loadQuestionAt(globalIndex - 1)
  }
  const next = async () => {
    if (index < questions.length - 1) setIndex(current => current + 1)
    else if (globalIndex + 1 < totalCount) await loadQuestionAt(globalIndex + 1)
  }
  const jump = async () => {
    const raw = window.prompt(`Go to question (1-${totalCount})`)
    if (!raw) return
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > totalCount) return
    const targetIndex = n - 1
    if (targetIndex >= pageStart && targetIndex < pageStart + questions.length) {
      setIndex(targetIndex - pageStart)
    } else {
      await loadQuestionAt(targetIndex)
    }
  }

  return <div className="screen question-runner-screen quick-scan-screen" style={{ paddingBottom: '2rem' }}>
    <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '.72rem', letterSpacing: '.1em', fontWeight: 800 }}>QUICK SCAN · {competenceId}</div>
      <h1 className="page-title" style={{ margin: '8px 0 4px' }}>{competence?.label || competenceId}</h1>
      <div className="quick-scan-progress-timer">
        <p className="subtitle" style={{ margin: 0 }}>{loading ? 'Loading question…' : questions.length ? `ITEM ${globalIndex + 1} OF ${totalCount}` : 'No questions available'}</p>
        <SessionElapsedTimer startedAt={startedAt} inline />
      </div>
    </div>
    {error && <div className="card" role="alert" style={{ borderColor: 'var(--danger)', marginBottom: '1rem' }}>
      <p style={{ color: 'var(--danger)' }}>{error}</p>
      <button type="button" className="btn btn-outline" onClick={() => window.location.reload()}>Retry opening Quick Scan</button>
    </div>}
    {bankNotice && <p role="status" style={{ color: 'var(--text-muted)', fontSize: '.85rem', marginBottom: '1rem' }}>{bankNotice}</p>}
    {resumeAt !== null && !loading && <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(3,8,18,.72)', display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box' }}>
      <section role="dialog" aria-modal="true" aria-labelledby="quick-scan-resume-title" className="card" style={{ width: 'min(100%, 460px)', maxHeight: '90vh', overflowY: 'auto', boxSizing: 'border-box', padding: 24, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 12, boxShadow: '0 24px 70px rgba(0,0,0,.4)' }}>
        <h2 id="quick-scan-resume-title" style={{ margin: '0 0 10px' }}>RESUME PREVIOUS READING?</h2>
        <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>You previously left off at Question #{resumeAt + 1} of {totalCount} in {competenceId.toUpperCase()}. Would you like to continue where you left off?</p>
        <div style={{ display: 'grid', gap: 10, marginTop: 20 }}>
          <button type="button" className="btn btn-primary" onClick={() => void loadQuestionAt(resumeAt, resumeQuestionId ?? undefined)}>YES, GO TO Q #{resumeAt + 1}</button>
          <button type="button" className="btn btn-outline" onClick={() => void loadQuestionAt(0)}>NO, START AT Q #1</button>
        </div>
      </section>
    </div>}

    {!loading && q && <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ fontSize: `${1.05 * textScale / 100}rem`, lineHeight: 1.6 }}><KeywordQuestionText question={q} /></div>
        <QuestionImageGallery question={q} placement="question" />
      </div>
      <div style={{ display: 'grid', gap: 8, marginBottom: '1rem' }}>
        {q.options.map((option, i) => <div key={i} className="card" style={{ borderRadius: 2, border: `1px solid ${i === q.correctAnswerIndex ? 'var(--success)' : 'var(--border)'}`, background: i === q.correctAnswerIndex ? 'rgba(34,197,94,.12)' : 'var(--bg-card)', padding: '0.9rem 1rem', fontSize: `${.95 * textScale / 100}rem`, display: 'flex', gap: 10 }}>
          <strong style={{ color: i === q.correctAnswerIndex ? 'var(--success)' : 'var(--text-muted)' }}>{String.fromCharCode(65 + i)}.</strong><span>{option}</span>{i === q.correctAnswerIndex && <span style={{ marginLeft: 'auto', color: 'var(--success)' }}>✓</span>}
        </div>)}
      </div>
      {(q.explanation || q.imageAttachments?.some(image => image.placement === 'explanation')) && <details className="card" style={{marginBottom:'1rem'}}>
        <summary style={{cursor:'pointer',fontWeight:700}}>Explanation and diagrams</summary>
        {q.explanation && <p style={{marginTop:10,lineHeight:1.55}}>{q.explanation}</p>}
        <QuestionImageGallery question={q} placement="explanation" />
      </details>}
      <div style={{ display: 'flex', gap: 8 }}>
        <button className="btn btn-outline" disabled={loading || (globalIndex === 0)} onClick={() => void previous()} style={{ flex: 1 }}>← Previous</button>
        <button className="btn btn-primary" disabled={loading || (globalIndex >= totalCount - 1)} onClick={() => void next()} style={{ flex: 1 }}>Next →</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => void jump()}>Jump to Question</button>
      </div>
    </>}
  </div>
}
