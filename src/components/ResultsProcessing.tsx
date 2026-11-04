import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { usePracticeStore } from '../stores/practiceStore'
import './SessionResults.css'

const PROCESS_RESULTS = 'hyperion:process-results'
const stages = ['Checking correct answers', 'Calculating score', 'Analyzing performance', 'Preparing your results']

export function showResultsProcessing() {
  window.dispatchEvent(new Event(PROCESS_RESULTS))
}

/** Presentation only: completion and durable storage remain owned by the session. */
export default function ResultsProcessing() {
  const finishing = usePracticeStore(state => state.finishing)
  const error = usePracticeStore(state => state.completionError)
  const [startedAt, setStartedAt] = useState<number | null>(() => finishing ? Date.now() : null)
  const [step, setStep] = useState(0)
  const dialog = useRef<HTMLElement>(null)
  const visible = !error && (finishing || startedAt !== null)

  useEffect(() => {
    const start = () => { setStep(0); setStartedAt(Date.now()) }
    window.addEventListener(PROCESS_RESULTS, start)
    const unsubscribe = usePracticeStore.subscribe((state, previous) => {
      if (state.sessionId !== previous.sessionId || state.completionError) { setStartedAt(null); return }
      if (state.finishing && !previous.finishing) start()
    })
    return () => { unsubscribe(); window.removeEventListener(PROCESS_RESULTS, start) }
  }, [])

  useEffect(() => {
    if (startedAt === null) return
    const timers = [800, 1600, 2300].map((delay, index) => window.setTimeout(() => setStep(index + 1), delay))
    timers.push(window.setTimeout(() => setStartedAt(null), 3000))
    return () => timers.forEach(timer => window.clearTimeout(timer))
  }, [startedAt])

  useEffect(() => {
    if (!visible) return
    const previous = document.activeElement as HTMLElement | null
    dialog.current?.focus()
    return () => {
      const resultsTitle = document.querySelector<HTMLElement>('[data-session-results] h1')
      if (resultsTitle) resultsTitle.focus()
      else if (previous?.isConnected) previous.focus()
    }
  }, [visible])

  if (!visible) return null
  return createPortal(<div className="results-processing-backdrop">
    <section ref={dialog} className="results-processing-card" role="dialog" aria-modal="true" aria-labelledby="results-processing-title" aria-busy="true" tabIndex={-1} onKeyDown={event => { if (event.key === 'Tab' || event.key === 'Escape') { event.preventDefault(); event.stopPropagation() } }}>
      <div className="results-processing-spinner" aria-hidden="true" />
      <h2 id="results-processing-title">Processing Results</h2>
      <div role="status" aria-live="polite" className="results-processing-status">{stages[step]}…</div>
      <ol aria-hidden="true">{stages.map((stage, index) => <li key={stage} className={index <= step ? 'is-active' : ''}>{index < step ? '✓' : '›'} {stage}</li>)}</ol>
      <p>Your session is saved on this device before results are shown.</p>
    </section>
  </div>, document.body)
}
