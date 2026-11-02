import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { readSavedQuestionSelection, savedQuestionsReturnPath, type SavedQuestionSelection } from '../lib/savedQuestionSets'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { useVaultStore } from '../stores/vaultStore'
import { usePracticeStore } from '../stores/practiceStore'

export default function SavedQuestionConfigScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [selection, setSelection] = useState<SavedQuestionSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [count, setCount] = useState(1)
  const [randomize, setRandomize] = useState(false)
  const [shuffleChoices, setShuffleChoices] = useState(true)
  const [mode, setMode] = useState<'PRACTICE' | 'DRILL'>('PRACTICE')
  const [starting, setStarting] = useState(false)
  const bookmarks = useBookmarksStore(state => state.items)
  const mistakes = useVaultStore(state => state.items)
  useEffect(() => {
    let active = true
    void readSavedQuestionSelection(params.get('set') || '').then(value => {
      if (!active) return
      setSelection(value)
      setCount(value?.ids.length || 1)
      setMode(value?.collection === 'mistakes' ? 'DRILL' : 'PRACTICE')
      setLoading(false)
      if (!value) setError('This saved selection is unavailable for this account. Open it again from Bookmarks or Mistakes Notebook.')
    }).catch(() => { if (active) { setLoading(false); setError('Could not load this saved selection. Your saved questions have not been removed.') } })
    return () => { active = false }
  }, [params])
  const sourceItems = selection?.collection === 'mistakes' ? mistakes : bookmarks
  const ids = new Set(selection?.ids ?? [])
  const questions = sourceItems.filter(item => ids.has(item.id) && item.track === selection?.track)
  const returnPath = savedQuestionsReturnPath(selection) || '/history'
  const start = async () => {
    if (!selection || !questions.length) return
    setStarting(true); setError('')
    try {
      const started = await usePracticeStore.getState().startCustomSession({
        questions: questions.map(q => ({ ...q, difficulty: q.difficulty as 'EASY' | 'MODERATE' | 'DIFFICULT' })),
        track: selection.track, competenceId: selection.competenceId, mode,
        randomizeOrder: randomize, shuffleChoices, limit: Math.max(1, Math.min(questions.length, count)),
        source: { collection: selection.collection, selectionId: selection.selectionId }
      })
      if (!started) { setError(usePracticeStore.getState().error || 'This question set could not be authorized. The saved collection is preserved.'); return }
      navigate('/practice/quiz')
    } catch { setError('Could not start this set. Your saved questions remain on this device.') }
    finally { setStarting(false) }
  }
  return <div className="screen practice-config-screen">
    <button type="button" className="btn btn-outline" onClick={() => navigate(returnPath)}>← Back to {selection?.collection === 'mistakes' ? 'Mistakes Notebook' : 'Bookmarks'}</button>
    <h1 className="page-title" style={{ marginTop: 16 }}>Configure saved questions</h1>
    <p className="subtitle">Customize this selected {selection?.collection === 'mistakes' ? 'mistake' : 'bookmark'} set. Questions are taken only from your selection.</p>
    {loading ? <p role="status">Loading saved selection…</p> : <div className="card">
      <p>{questions.length} questions available {selection?.competenceId ? `· ${selection.competenceId}` : ''}</p>
      <label style={{ display: 'block', marginBottom: 12 }}>Question count<input className="input" type="number" min={1} max={Math.max(1, questions.length)} value={count} onChange={event => setCount(Math.max(1, Math.floor(Number(event.target.value) || 1)))} /></label>
      <label style={{ display: 'block', marginBottom: 12 }}>Session mode<select className="input" value={mode} onChange={event => setMode(event.target.value as typeof mode)}><option value="PRACTICE">Practice</option><option value="DRILL">Drill</option></select></label>
      <label style={{ display: 'block', marginBottom: 12 }}><input type="checkbox" checked={randomize} onChange={event => setRandomize(event.target.checked)} /> Shuffle question order</label>
      <label style={{ display: 'block', marginBottom: 12 }}><input type="checkbox" checked={shuffleChoices} onChange={event => setShuffleChoices(event.target.checked)} /> Shuffle answer choices</label>
      <button type="button" className="btn btn-primary" disabled={starting || !selection || !questions.length} onClick={() => void start()}>{starting ? 'Starting…' : 'Start this question set'}</button>
    </div>}
    {error && <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
  </div>
}
