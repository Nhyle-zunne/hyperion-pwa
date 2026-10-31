import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { searchQuestions } from '../lib/questionBank'
import { useBookmarksStore } from '../stores/bookmarksStore'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import type { Question, TrackId } from '../types/question'

const TRACKS: { id: TrackId; label: string }[] = [
  { id: 'DECK_OIC_NW', label: 'OIC-NW Deck' },
  { id: 'GMDSS_GOC', label: 'GMDSS' },
  { id: 'ENGINE_OIC_EW', label: 'OIC-EW' },
  { id: 'DECK_MGT', label: 'Deck Mgt' },
  { id: 'ENGINE_MGT', label: 'Engine Mgt' }
]
const TRACK_PARAM_TO_ID: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
const TRACK_ID_TO_PARAM: Record<TrackId, string> = {
  DECK_OIC_NW: 'oic_nw', GMDSS_GOC: 'gmdss', ENGINE_OIC_EW: 'engine_ew',
  DECK_MGT: 'deck_mgt', ENGINE_MGT: 'engine_mgt'
}
export default function SearchScreen() {
  const [params, setParams] = useSearchParams()
  const [track, setTrack] = useState<TrackId>(() => TRACK_PARAM_TO_ID[params.get('track') || ''] || 'DECK_OIC_NW')
  useEffect(() => {
    const requested = TRACK_PARAM_TO_ID[params.get('track') || '']
    if (requested) setTrack(requested)
  }, [params])
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<Question[]>([])
  const [loading, setLoading] = useState(false)
  const [searched, setSearched] = useState(false)
  const [searchError, setSearchError] = useState('')
  const [expanded, setExpanded] = useState<string | null>(null)

  const isUnlocked = useLicenseStore((s) => s.isTrackUnlocked(track) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore((s) => s.openPaywall)
  const toggleBookmark = useBookmarksStore((s) => s.toggle)
  const isBookmarked = useBookmarksStore((s) => s.isBookmarked)

  useEffect(() => {
    if (!isUnlocked) {
      setResults([])
      setSearched(false)
      setExpanded(null)
      setLoading(false)
    }
  }, [isUnlocked])

  const runSearch = async () => {
    if (!isUnlocked) {
      openPaywall('Search')
      return
    }
    const q = query.trim()
    if (q.length < 2) return
    setLoading(true)
    setSearched(true)
    setSearchError('')
    setExpanded(null)
    try {
      const hits = await searchQuestions(track, q, 40)
      setResults(hits)
    } catch (error) {
      setResults([])
      setSearchError(error instanceof Error ? error.message : 'Search is unavailable. Connect to the internet or download this track first.')
    }
    setLoading(false)
  }

  return (
    <div className="screen">
      <h1 className="page-title">Search</h1>
      <p className="subtitle">Find questions by keyword within a track</p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
        {TRACKS.map((t) => (
          <button
            key={t.id}
            className="btn btn-outline"
            style={{
              padding: '0.35rem 0.65rem',
              fontSize: '0.8rem',
              borderColor: track === t.id ? 'var(--accent)' : undefined,
              color: track === t.id ? 'var(--accent)' : undefined
            }}
            onClick={() => {
              setTrack(t.id)
              setParams(current => { const next = new URLSearchParams(current); next.set('track', TRACK_ID_TO_PARAM[t.id]); return next }, { replace: true })
              setResults([])
              setSearched(false)
            }}
          >
            {t.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <input
          className="input"
          placeholder="e.g. COLREG, ECDIS, SART…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') runSearch()
          }}
        />
        <button className="btn btn-primary" onClick={runSearch} disabled={loading || query.trim().length < 2}>
          {loading ? '…' : 'Go'}
        </button>
      </div>

      {!isUnlocked && (
        <div className="card" style={{ marginBottom: 12, color: 'var(--warning)' }}>
          Activate a key for this track to search its full bank.
        </div>
      )}

      {loading && <p style={{ color: 'var(--text-muted)' }}>Searching (first load may take a moment)…</p>}

      {searched && !loading && (
        <p style={{ fontSize: '0.85rem', color: 'var(--text-muted)', marginBottom: 12 }}>
          {results.length} result{results.length === 1 ? '' : 's'}
        </p>
      )}

      <div
        className="search-results-protected"
        style={{ display: 'grid', gap: '0.6rem' }}
        onCopy={(event) => event.preventDefault()}
        onCut={(event) => event.preventDefault()}
        onContextMenu={(event) => event.preventDefault()}
        aria-label="Search results. Copying question text is disabled."
      >
        {results.map((q) => {
          const open = expanded === q.id
          const bm = isBookmarked(q.id)
          return (
            <div key={q.id} className="card">
              <button
                type="button"
                onClick={() => setExpanded(open ? null : q.id)}
                style={{
                  background: 'none',
                  border: 'none',
                  color: 'var(--text)',
                  textAlign: 'left',
                  width: '100%',
                  cursor: 'pointer',
                  padding: 0
                }}
              >
                <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginBottom: 4 }}>
                  {q.competenceId} · {q.topic}
                </div>
                <div style={{ fontSize: '0.95rem', lineHeight: 1.45 }}>{q.questionText}</div>
              </button>
              {open && (
                <div style={{ marginTop: 10 }}>
                  {q.options.map((o, i) => (
                    <div
                      key={i}
                      style={{
                        fontSize: '0.85rem',
                        color: i === q.correctAnswerIndex ? 'var(--success)' : 'var(--text-muted)',
                        marginBottom: 4
                      }}
                    >
                      {String.fromCharCode(65 + i)}. {o}
                    </div>
                  ))}
                  {q.explanation && (
                    <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: 8 }}>
                      {q.explanation}
                    </p>
                  )}
                  <button
                    className="btn btn-outline"
                    style={{ marginTop: 10, fontSize: '0.8rem', padding: '0.4rem 0.8rem' }}
                    onClick={() => toggleBookmark(q)}
                  >
                    {bm ? '★ Bookmarked' : '☆ Bookmark'}
                  </button>
                </div>
              )}
            </div>
          )
        })}
      </div>

      {searched && !loading && results.length === 0 && (
        <div className="card" style={{ color: searchError ? 'var(--warning)' : 'var(--text-muted)', textAlign: 'center' }} role={searchError ? 'status' : undefined}>
          {searchError || 'No matches. Try another keyword or track.'}
        </div>
      )}
    </div>
  )
}
