import { useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { readSavedQuestionSelection, savedQuestionsReturnPath, type SavedQuestionSelection } from '../lib/savedQuestionSets'
import PracticeConfigScreen from './PracticeConfigScreen'

export default function SavedQuestionConfigScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const [selection, setSelection] = useState<SavedQuestionSelection | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  useEffect(() => {
    let active = true
    void readSavedQuestionSelection(params.get('set') || '').then(value => {
      if (!active) return
      setSelection(value)
      setLoading(false)
      if (!value) setError('This saved selection is unavailable for this account. Open it again from Bookmarks or Mistakes Notebook.')
    }).catch(() => { if (active) { setLoading(false); setError('Could not load this saved selection. Your saved questions have not been removed.') } })
    return () => { active = false }
  }, [params])
  if (selection) return <PracticeConfigScreen savedSelection={selection} />
  return <div className="screen practice-config-screen">
    <button type="button" className="btn btn-outline" onClick={() => navigate(savedQuestionsReturnPath(selection) || '/history')}>← Back</button>
    {loading ? <p role="status">Loading saved selection…</p> : <p role="alert" style={{ color: 'var(--danger)' }}>{error}</p>}
  </div>
}
