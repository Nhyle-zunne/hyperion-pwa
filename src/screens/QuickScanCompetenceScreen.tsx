import { useNavigate, useSearchParams } from 'react-router-dom'
import { useEffect, useMemo, useState } from 'react'
import { listAvailableCompetences } from '../lib/questionBank'
import { useLicenseStore } from '../stores/licenseStore'
import { useUIStore } from '../stores/uiStore'
import type { TrackId } from '../types/question'
import { listQuickScanPositions, quickScanLocalOwner, type QuickScanPosition } from '../lib/quickScanPosition'

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
  const competences = useMemo(() => listAvailableCompetences(track), [track])
  const ownerId = quickScanLocalOwner()
  const [positions, setPositions] = useState<QuickScanPosition[]>([])
  useEffect(() => {
    let active = true
    setPositions([])
    if (unlocked) {
      void listQuickScanPositions(track, ownerId).then(rows => {
        if (active) setPositions(rows)
      }).catch(() => { if (active) setPositions([]) })
    }
    return () => { active = false }
  }, [track, ownerId, unlocked])
  // Match Android: the most recently opened competence is the resume target.
  const lastPosition = positions.find(row => competences.some(comp => comp.id === row.competenceId))
  const resumePosition = lastPosition && lastPosition.questionIndex > 0 ? lastPosition : null
  const resumeCompetence = resumePosition && competences.find(comp => comp.id === resumePosition.competenceId)
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
    {unlocked && resumePosition && resumeCompetence && <div className="card" style={{ marginBottom: '1rem', borderTop: '3px solid var(--accent)', borderRadius: 2 }}>
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <strong style={{ color: 'var(--accent)', fontSize: '.85rem', letterSpacing: '.05em' }}>RESUME QUICK SCAN</strong>
        <span style={{ color: 'var(--text-muted)', fontSize: '.8rem', fontWeight: 800 }}>QUESTION #{resumePosition.questionIndex + 1}</span>
      </div>
      <h2 style={{ fontSize: '1rem', margin: '12px 0' }}>{resumeCompetence.label}</h2>
      <button type="button" className="btn btn-primary" style={{ width: '100%', whiteSpace: 'normal' }}
        onClick={() => navigate(`/quick-scan/view?track=${key}&competence=${encodeURIComponent(resumePosition.competenceId)}&resume=1`)}>
        GO BACK TO WHERE YOU LEFT OFF (Q #{resumePosition.questionIndex + 1}) →
      </button>
      <p style={{ margin: '10px 0 0', color: 'var(--text-muted)', fontSize: '.75rem' }}>Saved on this device only. No Supabase progress upload.</p>
    </div>}
    <h2 style={{ fontSize: '.95rem', letterSpacing: '.06em' }}>COMPETENCE DIRECTORY ({competences.length})</h2>
    <div style={{ display: 'grid', gap: 8 }}>
      {competences.map(c => <button key={c.id} type="button" className="card" onClick={() => unlocked ? navigate(`/quick-scan/view?track=${key}&competence=${encodeURIComponent(c.id)}`) : openPaywall('Quick Scan')} style={{ textAlign: 'left', width: '100%', borderRadius: 2, border: '1px solid var(--border)' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
          <div><strong>{c.id}</strong><div style={{ fontSize: '.85rem', color: 'var(--text-muted)', marginTop: 4 }}>{c.label.replace(/^C\d+ · /, '')}</div></div>
          <span style={{ color: 'var(--accent)', fontWeight: 800, textAlign: 'right' }}>
            {positions.find(position => position.competenceId === c.id && position.questionIndex > 0)
              ? <><small style={{ display: 'block', fontSize: '.72rem', color: 'var(--text-muted)', marginBottom: 4 }}>Q #{positions.find(position => position.competenceId === c.id)!.questionIndex + 1}</small>OPEN →</>
              : 'OPEN →'}
          </span>
        </div>
      </button>)}
    </div>
  </div>
}
