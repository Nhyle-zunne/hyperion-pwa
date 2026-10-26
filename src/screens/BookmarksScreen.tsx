import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { authorizeQuestionSet } from '../lib/questionBank'
import type { BookmarkedQuestion } from '../stores/bookmarksStore'
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
  const startCustomSession = usePracticeStore((s) => s.startCustomSession)
  const isTrackUnlocked = useLicenseStore((s) => s.isTrackUnlocked)
  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked)
  const entitlementsVerified = useLicenseStore((s) => s.entitlementsVerified)
  const cloudTrackIds = useLicenseStore((s) => s.cloudTrackIds)
  const [verifiedFreeItems, setVerifiedFreeItems] = useState<string[]>([])
  const [validatingBookmarks, setValidatingBookmarks] = useState(true)
  const openPaywall = useUIStore((s) => s.openPaywall)

  useEffect(() => {
    let cancelled = false
    async function validateBookmarks() {
      setValidatingBookmarks(true)
      if (!entitlementsVerified) {
        if (!cancelled) {
          setVerifiedFreeItems([])
          setValidatingBookmarks(false)
        }
        return
      }
      const valid = new Set<string>()
      const questions = asQuestions()
      const tracks = [...new Set(items.map(item => item.track))]
      for (const track of tracks) {
        const group = items.filter(item => item.track === track)
        if (isAllAccessUnlocked || isTrackUnlocked(track)) {
          // Licensed-only content is shown by the live entitlement predicate below;
          // never cache it in the verified-free list.
          continue
        }
        // The local paidAtSave flag is editable by users, so use it only to
        // choose candidates. The server verifies that every displayed question
        // really belongs to this track's free sample before it is shown.
        const candidates = group.filter(item => item.paidAtSave === false)
        if (!candidates.length) continue
        const ids = new Set(candidates.map(item => item.id))
        const candidateQuestions = questions.filter(question => question.track === track && ids.has(question.id))
        try {
          if (candidateQuestions.length === candidates.length && await authorizeQuestionSet(track, candidateQuestions)) {
            candidates.forEach(item => valid.add(item.id))
          }
        } catch {
          // Fail closed: do not display cached paid question text if validation fails.
        }
      }
      if (!cancelled) {
        setVerifiedFreeItems([...valid])
        setValidatingBookmarks(false)
      }
    }
    void validateBookmarks()
    return () => { cancelled = true }
  }, [items, entitlementsVerified, cloudTrackIds, isAllAccessUnlocked, isTrackUnlocked, asQuestions])

  const validIds = new Set(verifiedFreeItems)
  const visibleItems = entitlementsVerified
    ? items.filter(item => validIds.has(item.id) || isAllAccessUnlocked || isTrackUnlocked(item.track))
    : []
  const trackGroups = new Map<TrackId, BookmarkedQuestion[]>()
  for (const item of visibleItems) {
    const group = trackGroups.get(item.track) ?? []
    group.push(item)
    trackGroups.set(item.track, group)
  }

  const practiceBookmarks = async (track: TrackId, selectedItems: BookmarkedQuestion[]) => {
    const onlyFreeQuestions = selectedItems.every(item => item.paidAtSave === false)
    if (!onlyFreeQuestions) {
      await useLicenseStore.getState().refreshCloudEntitlements()
      const license = useLicenseStore.getState()
      if (!license.entitlementsVerified || !(license.isAllAccessUnlocked || license.isTrackUnlocked(track))) {
        openPaywall()
        return
      }
    }
    const selectedIds = new Set(selectedItems.map(item => item.id))
    const questions = asQuestions().filter(q => q.track === track && selectedIds.has(q.id))
    if (!questions.length) return
    const competenceId = questions.every(q => q.competenceId === questions[0].competenceId)
      ? questions[0].competenceId
      : null
    const started = await startCustomSession({ questions, track, competenceId, isFreeSession: onlyFreeQuestions })
    if (started) navigate('/practice/quiz')
  }

  return (
    <div className="screen">
      <h1 className="page-title">Bookmarks</h1>
      <p className="subtitle">
        {visibleItems.length} available bookmarks · paid questions are hidden when the track license expires
      </p>

      {trackGroups.size > 0 && (
        <div style={{ display: 'grid', gap: '.5rem', marginBottom: '1rem' }}>
          {[...trackGroups.entries()].map(([track, group]) => (
            <button key={track} className="btn btn-primary" style={{ width: '100%' }} onClick={() => void practiceBookmarks(track, group)}>
              Practice {TRACK_LABELS[track]} bookmarks ({group.length})
            </button>
          ))}
        </div>
      )}

      {validatingBookmarks ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>Verifying question access…</div>
      ) : visibleItems.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          No available bookmarks. Paid question bookmarks require an active license; cached free questions are verified before display.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {visibleItems.map((item) => (
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
