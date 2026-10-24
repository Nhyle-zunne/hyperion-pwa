import { useNavigate } from 'react-router-dom'
import { useVaultStore } from '../stores/vaultStore'
import { usePracticeStore } from '../stores/practiceStore'
import type { TrackId } from '../types/question'

const TRACK_LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW',
  GMDSS_GOC: 'GMDSS',
  ENGINE_OIC_EW: 'OIC-EW',
  DECK_MGT: 'Deck Mgt',
  ENGINE_MGT: 'Engine Mgt'
}

export default function VaultScreen() {
  const navigate = useNavigate()
  const items = useVaultStore((s) => s.items)
  const remove = useVaultStore((s) => s.remove)
  const clear = useVaultStore((s) => s.clear)
  const asQuestions = useVaultStore((s) => s.asQuestions)

  const practiceVault = async () => {
    const qs = asQuestions()
    if (qs.length === 0) return
    const track = qs[0].track
    await usePracticeStore.getState().startSession({
      mode: 'PRACTICE',
      track,
      limit: qs.length
    })
    usePracticeStore.setState({
      questions: qs,
      answers: {},
      currentIndex: 0,
      finished: false,
      loading: false,
      error: null,
      mode: 'DRILL',
      startedAt: Date.now()
    })
    navigate('/practice/quiz')
  }

  const sorted = [...items].sort((a, b) => b.wrongCount - a.wrongCount || b.lastWrongAt - a.lastWrongAt)

  return (
    <div className="screen">
      <h1 className="page-title">Mistakes Vault</h1>
      <p className="subtitle">
        {items.length} question{items.length === 1 ? '' : 's'} you missed · auto-saved from Practice,
        Drill, Mock
      </p>

      {items.length > 0 && (
        <button
          className="btn btn-primary"
          style={{ width: '100%', marginBottom: '1rem' }}
          onClick={practiceVault}
        >
          Drill mistakes ({items.length})
        </button>
      )}

      {items.length === 0 ? (
        <div className="card" style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
          Vault is empty. Wrong answers from study sessions appear here.
        </div>
      ) : (
        <div style={{ display: 'grid', gap: '0.6rem' }}>
          {sorted.map((item) => (
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
                  {TRACK_LABELS[item.track]} · {item.competenceId} · missed {item.wrongCount}×
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
          ))}
        </div>
      )}

      {items.length > 0 && (
        <button
          className="btn btn-outline"
          style={{ width: '100%', marginTop: '1.25rem', color: 'var(--danger)' }}
          onClick={() => {
            if (confirm('Clear the mistakes vault?')) clear()
          }}
        >
          Clear vault
        </button>
      )}
    </div>
  )
}
