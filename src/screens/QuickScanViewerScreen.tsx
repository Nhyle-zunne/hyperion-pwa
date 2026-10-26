import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getQuestionCountsByTrack, getQuestionsByCompetence, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
const PAGE_SIZE = 50

export default function QuickScanViewerScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const key = params.get('track') || 'oic_nw'
  const track = TRACK_MAP[key] || 'DECK_OIC_NW'
  const competenceId = params.get('competence') || ''
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [pageStart, setPageStart] = useState(0)
  const [totalCount, setTotalCount] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const competence = listAvailableCompetences(track).find(c => c.id === competenceId)

  const loadPage = useCallback(async (startItem: number) => {
    setLoading(true)
    setError('')
    try {
      const qs = await getQuestionsByCompetence(track, competenceId, undefined, false, startItem, PAGE_SIZE)
      setQuestions(qs)
      setPageStart(startItem - 1)
      setIndex(0)
      return qs
    } catch {
      setQuestions([])
      setError('Question access could not be verified. Refresh the page or renew the track license.')
      return []
    } finally {
      setLoading(false)
    }
  }, [track, competenceId])

  useEffect(() => {
    let active = true
    async function loadInitial() {
      setLoading(true)
      setError('')
      try {
        const counts = await getQuestionCountsByTrack(track, false)
        const count = counts.filter(item => item.competenceId === competenceId).reduce((sum, item) => sum + item.count, 0)
        if (!active) return
        setTotalCount(count)
        const qs = await getQuestionsByCompetence(track, competenceId, undefined, false, 1, PAGE_SIZE)
        if (active) {
          setQuestions(qs)
          setIndex(0)
          setPageStart(0)
        }
      } catch {
        if (active) {
          setQuestions([])
          setTotalCount(0)
          setError('Question access could not be verified. Refresh the page or renew the track license.')
        }
      } finally {
        if (active) setLoading(false)
      }
    }
    void loadInitial()
    return () => { active = false }
  }, [track, competenceId])

  const globalIndex = pageStart + index
  const q = questions[index]
  const previous = async () => {
    if (index > 0) setIndex(current => current - 1)
    else if (pageStart > 0) await loadPage(Math.max(1, pageStart - PAGE_SIZE + 1))
  }
  const next = async () => {
    if (index < questions.length - 1) setIndex(current => current + 1)
    else if (globalIndex + 1 < totalCount) await loadPage(pageStart + questions.length + 1)
  }
  const jump = async () => {
    const raw = window.prompt(`Go to question (1-${totalCount})`)
    if (!raw) return
    const n = Number(raw)
    if (!Number.isInteger(n) || n < 1 || n > totalCount) return
    const startItem = Math.floor((n - 1) / PAGE_SIZE) * PAGE_SIZE + 1
    const qs = await loadPage(startItem)
    if (qs.length) setIndex(n - startItem)
  }

  return <div className="screen" style={{ paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(`/quick-scan?track=${key}`)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Competences</button>
    <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '.72rem', letterSpacing: '.1em', fontWeight: 800 }}>QUICK SCAN · {competenceId}</div>
      <h1 className="page-title" style={{ margin: '8px 0 4px' }}>{competence?.label || competenceId}</h1>
      <p className="subtitle" style={{ margin: 0 }}>{loading ? 'Loading question…' : questions.length ? `ITEM ${globalIndex + 1} OF ${totalCount}` : 'No questions available'}</p>
    </div>
    {error && <p style={{ color: 'var(--danger)' }}>{error}</p>}
    {!loading && q && <>
      <div className="card" style={{ marginBottom: '1rem' }}>
        <div style={{ color: 'var(--accent)', fontSize: '.8rem', marginBottom: 8 }}>{q.topic}</div>
        <div style={{ fontSize: '1.05rem', lineHeight: 1.6 }}>{q.questionText}</div>
      </div>
      <div style={{ display: 'grid', gap: 8, marginBottom: '1rem' }}>
        {q.options.map((option, i) => <div key={i} className="card" style={{ borderRadius: 2, border: `1px solid ${i === q.correctAnswerIndex ? 'var(--success)' : 'var(--border)'}`, background: i === q.correctAnswerIndex ? 'rgba(34,197,94,.12)' : 'var(--bg-card)', padding: '1rem', display: 'flex', gap: 10 }}>
          <strong style={{ color: i === q.correctAnswerIndex ? 'var(--success)' : 'var(--text-muted)' }}>{String.fromCharCode(65 + i)}.</strong><span>{option}</span>{i === q.correctAnswerIndex && <span style={{ marginLeft: 'auto', color: 'var(--success)' }}>✓</span>}
        </div>)}
      </div>
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
