import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { getQuestionsByCompetence, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
export default function QuickScanViewerScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const key = params.get('track') || 'oic_nw'
  const track = TRACK_MAP[key] || 'DECK_OIC_NW'
  const competenceId = params.get('competence') || ''
  const [questions, setQuestions] = useState<Question[]>([])
  const [index, setIndex] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const competence = listAvailableCompetences(track).find(c => c.id === competenceId)
  useEffect(() => {
    let active = true
    setLoading(true)
    getQuestionsByCompetence(track, competenceId).then(qs => {
      if (active) { setQuestions(qs); setIndex(0); setLoading(false) }
    }).catch(() => { if (active) { setError('Failed to load questions.'); setLoading(false) } })
    return () => { active = false }
  }, [track, competenceId])
  const q = questions[index]
  return <div className="screen" style={{ paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(`/quick-scan?track=${key}`)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Competences</button>
    <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '.72rem', letterSpacing: '.1em', fontWeight: 800 }}>QUICK SCAN · {competenceId}</div>
      <h1 className="page-title" style={{ margin: '8px 0 4px' }}>{competence?.label || competenceId}</h1>
      <p className="subtitle" style={{ margin: 0 }}>{loading ? 'Loading question bank…' : questions.length ? `ITEM ${index + 1} OF ${questions.length}` : 'No questions available'}</p>
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
        <button className="btn btn-outline" disabled={index === 0} onClick={() => setIndex(i => i - 1)} style={{ flex: 1 }}>← Previous</button>
        <button className="btn btn-primary" disabled={index >= questions.length - 1} onClick={() => setIndex(i => i + 1)} style={{ flex: 1 }}>Next →</button>
      </div>
      <div style={{ display: 'flex', gap: 8, marginTop: 10 }}>
        <button className="btn btn-outline" style={{ flex: 1 }} onClick={() => { const raw = window.prompt(`Go to question (1-${questions.length})`); if (raw) { const n = Number(raw); if (Number.isInteger(n) && n >= 1 && n <= questions.length) setIndex(n - 1) } }}>Jump to Question</button>
      </div>
    </>}
  </div>
}
