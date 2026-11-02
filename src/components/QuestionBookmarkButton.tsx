import { useEffect, useState } from 'react'
import { useBookmarksStore } from '../stores/bookmarksStore'
import type { Question } from '../types/question'

export default function QuestionBookmarkButton({ question, paidAtSave = true, questionNumber }: {
  question?: Question
  paidAtSave?: boolean
  questionNumber?: number
}) {
  const bookmarked = useBookmarksStore(state => question ? state.isBookmarked(question.id) : false)
  const toggle = useBookmarksStore(state => state.toggle)
  const [hydrated, setHydrated] = useState(useBookmarksStore.persist.hasHydrated())
  useEffect(() => {
    const unsubscribe = useBookmarksStore.persist.onFinishHydration(() => setHydrated(true))
    setHydrated(useBookmarksStore.persist.hasHydrated())
    return unsubscribe
  }, [])
  if (!question) return null
  const label = (bookmarked ? 'Remove bookmark' : 'Bookmark question') + (questionNumber ? ` ${questionNumber}` : '')
  return <button type="button" disabled={!hydrated} onClick={() => toggle(question, paidAtSave)}
    aria-label={label} aria-pressed={bookmarked} title={label}
    style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, flexShrink: 0, border: 0, borderRadius: 8, background: 'transparent', color: bookmarked ? 'var(--accent)' : 'var(--text)', padding: 8, cursor: 'pointer' }}>
    <svg aria-hidden="true" viewBox="0 0 24 24" width="25" height="25" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6.75 4.25A1.75 1.75 0 0 1 8.5 2.5h7A1.75 1.75 0 0 1 17.25 4.25V21l-5.25-3.6L6.75 21V4.25Z" />
    </svg>
  </button>
}
