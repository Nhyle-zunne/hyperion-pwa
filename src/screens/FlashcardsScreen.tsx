import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { getFlashcardQuestions, listAvailableCompetences } from '../lib/questionBank'
import type { Question, TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW',
  gmdss: 'GMDSS_GOC',
  engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT',
  engine_mgt: 'ENGINE_MGT'
}

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck',
  GMDSS_GOC: 'GMDSS GOC',
  ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management',
  ENGINE_MGT: 'Engine Management'
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr]
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    ;[a[i], a[j]] = [a[j], a[i]]
  }
  return a
}

export default function FlashcardsScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const trackParam = params.get('track') || 'oic_nw'
  const trackId = TRACK_MAP[trackParam] || 'DECK_OIC_NW'

  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(trackId) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)

  const [session, setSession] = useState<Question[] | null>(null)
  const [index, setIndex] = useState(0)
  const [flipped, setFlipped] = useState(false)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [known, setKnown] = useState(0)
  const [unknown, setUnknown] = useState(0)

  const competences = listAvailableCompetences(trackId)
  const toggleBookmark = useBookmarksStore((s) => s.toggle)
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked)

  const start = async (competenceId?: string) => {
    if (!isUnlocked) {
      openPaywall('Flashcards')
      return
    }
    setLoading(true)
    setError(null)
    setFlipped(false)
    setIndex(0)
    setKnown(0)
    setUnknown(0)
    try {
      const qs = await getFlashcardQuestions(trackId, competenceId, 20)
      if (qs.length === 0) {
        setError('No questions available for this selection.')
        setLoading(false)
        return
      }
      setSession(shuffle(qs).slice(0, Math.min(20, qs.length)))
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Flashcards are unavailable. Connect to the internet or download this track first.')
    }
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="screen">
        <p>Loading flashcards…</p>
      </div>
    )
  }

  if (session && session.length > 0) {
    if (index >= session.length) {
      return (
        <div className="screen">
          <h1 className="page-title">Flashcards done</h1>
          <div className="card" style={{ textAlign: 'center', marginBottom: '1.25rem' }}>
            <div style={{ fontSize: '1.1rem', marginBottom: 8 }}>
              Knew: <strong style={{ color: 'var(--success)' }}>{known}</strong>
              {' · '}
              Review: <strong style={{ color: 'var(--warning)' }}>{unknown}</strong>
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: '0.9rem' }}>
              {session.length} cards
            </div>
          </div>
          <button
            className="btn btn-primary"
            style={{ width: '100%', marginBottom: 8 }}
            onClick={() => setSession(null)}
          >
            New set
          </button>
          <button className="btn btn-outline" style={{ width: '100%' }} onClick={() => navigate('/')}>
            Home
          </button>
        </div>
      )
    }

    const q = session[index]
    const bookmarked = isBookmarked(q.id)

    return (
      <div className="screen" style={{ paddingBottom: '5rem' }}>
        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            marginBottom: '0.75rem',
            fontSize: '0.85rem',
            color: 'var(--text-muted)'
          }}
        >
          <span>
            Card {index + 1} / {session.length}
          </span>
          <span>
            ✓ {known} · ? {unknown}
          </span>
        </div>

        <button
          type="button"
          onClick={() => setFlipped((f) => !f)}
          className="card"
          style={{
            width: '100%',
            minHeight: 220,
            textAlign: 'left',
            cursor: 'pointer',
            marginBottom: '1rem',
            borderColor: flipped ? 'var(--accent)' : 'var(--border)'
          }}
        >
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 8 }}>
            {flipped ? 'ANSWER' : 'QUESTION'} · {q.competenceId} · tap to flip
          </div>
          {!flipped ? (
            <div style={{ fontSize: '1.05rem', lineHeight: 1.55 }}>{q.questionText}</div>
          ) : (
            <div>
              <div style={{ fontWeight: 600, color: 'var(--success)', marginBottom: 8 }}>
                {String.fromCharCode(65 + q.correctAnswerIndex)}. {q.options[q.correctAnswerIndex]}
              </div>
              <div style={{ fontSize: '0.9rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>
                {q.options.map((o, i) => (
                  <div key={i} style={{ opacity: i === q.correctAnswerIndex ? 1 : 0.55 }}>
                    {String.fromCharCode(65 + i)}. {o}
                  </div>
                ))}
              </div>
              {q.explanation && (
                <p style={{ marginTop: 12, fontSize: '0.85rem', color: 'var(--text-muted)' }}>
                  {q.explanation}
                </p>
              )}
            </div>
          )}
        </button>

        <button
          className="btn btn-outline"
          style={{ width: '100%', marginBottom: 12, fontSize: '0.85rem' }}
          onClick={() => toggleBookmark(q)}
        >
          {bookmarked ? '★ Bookmarked' : '☆ Bookmark'}
        </button>

        <div style={{ display: 'flex', gap: 8 }}>
          <button
            className="btn btn-outline"
            style={{ flex: 1 }}
            onClick={() => {
              setUnknown((u) => u + 1)
              setFlipped(false)
              setIndex((i) => i + 1)
            }}
          >
            Still learning
          </button>
          <button
            className="btn btn-primary"
            style={{ flex: 1 }}
            onClick={() => {
              setKnown((k) => k + 1)
              setFlipped(false)
              setIndex((i) => i + 1)
            }}
          >
            Knew it
          </button>
        </div>

        <button
          style={{
            marginTop: 16,
            background: 'none',
            border: 'none',
            color: 'var(--text-muted)',
            fontSize: '0.85rem',
            cursor: 'pointer',
            width: '100%'
          }}
          onClick={() => setSession(null)}
        >
          End session
        </button>
      </div>
    )
  }

  return (
    <div className="screen">
      <button
        onClick={() => navigate('/')}
        style={{ color: 'var(--text-muted)', marginBottom: '1rem', fontSize: '0.9rem' }}
      >
        ← Home
      </button>

      <h1 className="page-title">Flashcards</h1>
      <p className="subtitle">
        {TRACK_LABELS[trackId]} · flip for answer · mark Knew / Still learning
      </p>

      {error && (
        <div className="card" style={{ marginBottom: '1rem', color: 'var(--danger)' }}>
          {error}
        </div>
      )}

      {!isUnlocked && (
        <div
          className="card"
          style={{ marginBottom: '1rem', borderColor: 'var(--warning)', color: 'var(--warning)' }}
        >
          Activate a key to unlock flashcards.
        </div>
      )}

      <div style={{ display: 'grid', gap: '0.75rem' }}>
        <button className="card" style={{ textAlign: 'left', width: '100%' }} onClick={() => start()}>
          <div style={{ fontWeight: 600 }}>Mixed deck (20 cards)</div>
          <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>
            Random from this track
          </div>
        </button>
        {competences.map((c) => (
          <button
            key={c.id}
            className="card"
            style={{ textAlign: 'left', width: '100%' }}
            onClick={() => start(c.id)}
          >
            <div style={{ fontWeight: 600 }}>Competence {c.id}</div>
            <div style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>{c.label}</div>
          </button>
        ))}
      </div>

      <div style={{ marginTop: '1.25rem' }}>
        <label style={{ fontSize: '0.85rem', color: 'var(--text-muted)' }}>Track</label>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 6 }}>
          {Object.entries(TRACK_MAP).map(([key, id]) => (
            <button
              key={key}
              className="btn btn-outline"
              style={{
                padding: '0.4rem 0.7rem',
                fontSize: '0.8rem',
                borderColor: trackId === id ? 'var(--accent)' : undefined,
                color: trackId === id ? 'var(--accent)' : undefined
              }}
              onClick={() => navigate(`/flashcards?track=${key}`)}
            >
              {TRACK_LABELS[id]}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
