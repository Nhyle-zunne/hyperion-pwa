import { useNavigate } from 'react-router-dom'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { usePracticeStore } from '../stores/practiceStore'
import type { TrackId } from '../types/question'

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW',
  GMDSS_GOC: 'GMDSS',
  ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Mgt',
  ENGINE_MGT: 'Engine Mgt'
}

export default function BookmarksScreen() {
  const navigate = useNavigate()
  const items = useBookmarksStore((s) => s.items)
  const remove = useBookmarksStore((s) => s.remove)
  const clear = useBookmarksStore((s) => s.clear)
  const asQuestions = useBookmarksStore((s) => s.asQuestions)
  const startSession = usePracticeStore((s) => s.startSession)

  // Practice store loads from bank; for bookmarks we inject via a lightweight local session
  const practiceBookmarks = async () => {
    const qs = asQuestions()
    if (qs.length === 0) return
    // Reuse practice store by manually setting via startSession on first track
    // then overwrite questions — startSession loads from bank. Instead set state after.
    const track = qs[0].track
    await startSession({ mode: 'PRACTICE', track, limit: qs.length })
    // Overwrite with bookmarked questions
    usePracticeStore.setState({
      questions: qs,
      answers: {},
      currentIndex: 0,
      finished: false,
      loading: false,
      error: null,
      mode: 'PRACTICE',
      startedAt: Date.now()
    })
    navigate('/practice/quiz')
  }

  return (
    <div className="screen">
      <h1 className="page-title">Bookmarks</h1>
      <p className="subtitle">
        {items.length} saved · bookmark from Practice, Drill, Mock, or Flashcards
      </p>

      {items.length > 0 && (
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '1rem' }}
          onClick={practiceBookmarks}
        >
          Practice all bookmarked ({items.length})
        </button>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          No bookmarks yet. Open a question in Practice or Flashcards and tap Bookmark.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {items.map((item) => (
            <div key={item.id} className="card">
              <div
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  gap: 8,
                  marginBottom: 6
                }}
              >
                <span style={{ fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                  {TRACK_LABELS[item.track]} · {item.competenceId}
                </span>
                <button
                  onClick={() => remove(item.id)}
                  style={{
                    background: 'none',
                    border: 'none',
                    color: 'var(--danger)',
                    fontSize: '0.8rem',
                    cursor: 'pointer'
                  }}
                >
                  Remove
                </button>
              </div>
              <div style={{ fontSize: '0.95rem', lineHeight: 1.45 }}>{item.questionText}</div>
              <div style={{ marginTop: 8, fontSize: '0.8rem', color: 'var(--success)' }}>
                {String.fromCharCode(65 + item.correctAnswerIndex)}.{' '}
                {item.options[item.correctAnswerIndex]}
              </div>
            </div>
          ))}
        </div>
      )}

      {items.length > 0 && (
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginTop: '1.25rem', color: 'var(--danger)' }}
          onClick={() => {
            if (confirm('Clear all bookmarks?')) clear()
          }}
        >
          Clear all
        </button>
      )}
    </div>
  )
}
