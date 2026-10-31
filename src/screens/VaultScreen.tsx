import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useVaultStore } from '../stores/vaultStore'
import { usePracticeStore } from '../stores/practiceStore'
import { useLicenseStore } from '../stores/licenseStore'
import type { TrackId } from '../types/question'
import type { VaultItem } from '../stores/vaultStore'

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW',
  GMDSS_GOC: 'GMDSS',
  ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Mgt',
  ENGINE_MGT: 'Engine Mgt'
}

export default function VaultScreen() {
  const navigate = useNavigate()
  const [searchParams] = useSearchParams()
  const requestedTrack = searchParams.get('track') as TrackId | null
  const items = useVaultStore((s) => s.items)
  const remove = useVaultStore((s) => s.remove)
  const clear = useVaultStore((s) => s.clear)
  const asQuestions = useVaultStore((s) => s.asQuestions)
  const entitlementsVerified = useLicenseStore((s) => s.entitlementsVerified)
  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked)
  const isTrackUnlocked = useLicenseStore((s) => s.isTrackUnlocked)
  const cloudTrackIds = useLicenseStore((s) => s.cloudTrackIds)
  const [saveError, setSaveError] = useState<string | null>(null)

  const hasAnyActiveLicense = entitlementsVerified && (
    isAllAccessUnlocked || cloudTrackIds.includes('ALL') ||
    ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'].some(isTrackUnlocked)
  )
  const visibleItems = entitlementsVerified
    ? items.filter(item => isAllAccessUnlocked || cloudTrackIds.includes('ALL') || isTrackUnlocked(item.track))
    : []

  const scopedItems = requestedTrack && Object.prototype.hasOwnProperty.call(TRACK_LABELS, requestedTrack)
    ? visibleItems.filter(item => item.track === requestedTrack)
    : visibleItems

  const trackGroups = new Map<TrackId, VaultItem[]>()
  for (const item of scopedItems) {
    const group = trackGroups.get(item.track) ?? []
    group.push(item)
    trackGroups.set(item.track, group)
  }
  const sortedGroups = [...trackGroups.entries()].map(([track, group]) => [
    track,
    [...group].sort((a, b) => b.wrongCount - a.wrongCount || b.lastWrongAt - a.lastWrongAt)
  ] as const)

  const practiceVault = async (track: TrackId, selectedItems: VaultItem[]) => {
    const selectedIds = new Set(selectedItems.map(item => item.id))
    const questions = asQuestions().filter(question => question.track === track && selectedIds.has(question.id))
    if (!questions.length) return
    const competenceId = questions.every(question => question.competenceId === questions[0].competenceId)
      ? questions[0].competenceId
      : null
    setSaveError(null)
    const started = await usePracticeStore.getState().startCustomSession({ questions, track, competenceId })
    if (!started) return
    usePracticeStore.setState({ mode: 'DRILL', startedAt: Date.now(), finished: false, loading: false, error: null })
    const saved = await usePracticeStore.getState().saveProgress()
    if (!saved) {
      setSaveError('Could not save this drill on the device. Check storage and try again before starting it.')
      return
    }
    navigate('/practice/quiz')
  }

  return (
    <div className="screen">
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
        <h1 className="page-title">Mistakes Notebook</h1>
        <button type="button" className="btn btn-outline" onClick={() => navigate(requestedTrack ? "/track?track=" + encodeURIComponent(({ DECK_OIC_NW: "oic_nw", GMDSS_GOC: "gmdss", ENGINE_OIC_EW: "engine_ew", DECK_MGT: "deck_mgt", ENGINE_MGT: "engine_mgt" } as Record<TrackId, string>)[requestedTrack] || "oic_nw") : "/")}>Back</button>
      </div>
      <p className="subtitle">
        {scopedItems.length} licensed mistake{scopedItems.length === 1 ? '' : 's'} · auto-saved from your sessions
      </p>
      {saveError && <p role="alert" style={{ color: 'var(--danger)' }}>{saveError}</p>}

      {sortedGroups.map(([track, group]) => (
        <button
          key={track}
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '0.6rem' }}
          onClick={() => void practiceVault(track, group)}
        >
          Drill {TRACK_LABELS[track]} mistakes ({group.length})
        </button>
      ))}

      {!entitlementsVerified ? (
        <div className="card" role="status" aria-live="polite" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          Verifying your active license…
        </div>
      ) : (!hasAnyActiveLicense || (requestedTrack && Object.prototype.hasOwnProperty.call(TRACK_LABELS, requestedTrack) && !(isAllAccessUnlocked || cloudTrackIds.includes('ALL') || isTrackUnlocked(requestedTrack)))) ? (
        <div className="card" style={{ textAlign: 'center' }}>
          <h2 style={{ marginTop: 0 }}>Mistakes Notebook is locked</h2>
          <p style={{ color: 'var(--text-muted)' }}>An active license is required to access the Mistakes Notebook. Subscribe to a track to unlock its saved mistakes. Your notebook will show only mistakes from tracks with an active license.</p>
          <button type="button" className="btn btn-primary" onClick={() => navigate('/account')}>VIEW LICENSE OPTIONS</button>
        </div>
      ) : scopedItems.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          No saved mistakes are available for this licensed track yet. Mistakes are added automatically when you answer incorrectly. Only mistakes belonging to tracks with an active license appear here.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {sortedGroups.map(([track, group]) => group.map((item) => (
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
                  {TRACK_LABELS[track]} · {item.competenceId} · missed {item.wrongCount}×
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
                Correct: {String.fromCharCode(65 + item.correctAnswerIndex)}.{' '}
                {item.options[item.correctAnswerIndex]}
              </div>
              {item.lastSelectedIndex != null && item.lastSelectedIndex !== item.correctAnswerIndex && (
                <div style={{ marginTop: 4, fontSize: '0.8rem', color: 'var(--danger)' }}>
                  You chose: {String.fromCharCode(65 + item.lastSelectedIndex)}.{' '}
                  {item.options[item.lastSelectedIndex]}
                </div>
              )}
            </div>
          )))}
        </div>
      )}

      {hasAnyActiveLicense && scopedItems.length > 0 && (
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginTop: '1.25rem', color: 'var(--danger)' }}
          onClick={() => {
            if (confirm('Clear the mistakes notebook?')) clear()
          }}
        >
          Clear vault
        </button>
      )}
    </div>
  )
}
