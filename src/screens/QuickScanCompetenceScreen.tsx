import { useNavigate, useSearchParams } from 'react-router-dom'
import { listAvailableCompetences } from '../lib/questionBank'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import type { TrackId } from '../types/question'

const TRACK_MAP: Record<string, TrackId> = {
  oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW',
  deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT'
}
const LABELS: Record<TrackId, string> = {
  DECK_OIC_NW: 'OIC-NW Deck', GMDSS_GOC: 'GMDSS GOC', ENGINE_OIC_EW: 'OIC-EW Engine',
  DECK_MGT: 'Deck Management', ENGINE_MGT: 'Engine Management'
}
export default function QuickScanCompetenceScreen() {
  const navigate = useNavigate()
  const [params] = useSearchParams()
  const key = params.get('track') || 'oic_nw'
  const track = TRACK_MAP[key] || 'DECK_OIC_NW'
  const unlocked = useLicenseStore(s => s.isTrackUnlocked(track) || s.isAllAccessUnlocked)
  const openPaywall = useUIStore(s => s.openPaywall)
  const competences = listAvailableCompetences(track)
  return <div className="screen" style={{ paddingBottom: '2rem' }}>
    <button type="button" onClick={() => navigate(`/track?track=${key}`)} style={{ color: 'var(--text-muted)', marginBottom: '1rem' }}>← Back to Track</button>
    <div className="card" style={{ borderRadius: 2, borderTop: '3px solid var(--accent)', marginBottom: '1rem' }}>
      <div style={{ color: 'var(--text-muted)', fontSize: '.72rem', letterSpacing: '.12em', fontWeight: 800 }}>QUICK SCAN MATERIAL</div>
      <h1 className="page-title" style={{ margin: '8px 0 4px' }}>Select Competence</h1>
      <p className="subtitle" style={{ margin: 0 }}>{LABELS[track]} · Read-only question and answer reference</p>
    </div>
    <div className="card" style={{ marginBottom: '1rem' }}>
      <strong>DIRECT QUESTION & ANSWER REFERENCE</strong>
      <p style={{ color: 'var(--text-muted)', fontSize: '.88rem', marginBottom: 0 }}>Browse questions sequentially. Correct answers are highlighted automatically. No test, timer, or drill configuration.</p>
    </div>
    {!unlocked && <div className="card" style={{ marginBottom: '1rem', borderColor: 'var(--warning)' }}>
      Quick Scan requires an activated license to browse the full question bank.
      <button className="btn btn-primary" style={{ width: '100%', marginTop: 10 }} onClick={() => openPaywall('Quick Scan')}>Activate Key</button>
    </div>}
    <h2 style={{ fontSize: '.95rem', letterSpacing: '.06em' }}>COMPETENCE DIRECTORY ({competences.length})</h2>
    <div style={{ display: 'grid', gap: 8 }}>
      {competences.map(c => <button key={c.id} type="button" className="card" onClick={() => unlocked ? navigate(`/quick-scan/view?track=${key}&competence=${encodeURIComponent(c.id)}`) : openPaywall('Quick Scan')} style={{ textAlign: 'left', width: '100%', borderRadius: 2, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div><strong>{c.id}</strong><div style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginTop: 4 }}>{c.label.replace(/^C\d+ · /, '')}</div></div>
          <span style={{ color: 'var(--accent)', fontWeight: 800 }}>OPEN →</span>
        </div>
      </button>)}
    </div>
  </div>
}
