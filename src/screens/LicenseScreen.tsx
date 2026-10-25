import { useLicenseStore } from '../stores/licenseStore'

const TRACKS = [
  { id: 'DECK_OIC_NW', name: 'Deck OIC-NW' },
  { id: 'GMDSS_GOC', name: 'GMDSS GOC' },
  { id: 'ENGINE_OIC_EW', name: 'Engine OIC-EW' },
  { id: 'DECK_MGT', name: 'Deck Management' },
  { id: 'ENGINE_MGT', name: 'Engine Management' },
]

export default function LicenseScreen({ hideBack = false }: { hideBack?: boolean }) {
  const cloudTrackIds = useLicenseStore((s) => s.cloudTrackIds)
  const refreshCloudEntitlements = useLicenseStore((s) => s.refreshCloudEntitlements)
  return <div className="screen">
    {!hideBack && <button className="btn btn-outline" onClick={() => window.history.back()} style={{ marginBottom: '1rem' }}>← Back</button>}
    <h2 style={{ marginTop: 0 }}>Active subscriptions</h2>
    <p className="subtitle">Subscription access is linked to your Hyperion account and verified online.</p>
    <div className="card" style={{ marginBottom: '1rem' }}>
      {TRACKS.map(track => {
        const active = cloudTrackIds.includes(track.id) || cloudTrackIds.includes('ALL')
        return <div key={track.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 12, padding: '.65rem 0', borderBottom: '1px solid var(--border)' }}><span>{track.name}</span><strong style={{ color: active ? 'var(--success)' : 'var(--text-muted)' }}>{active ? 'Active' : 'Not subscribed'}</strong></div>
      })}
      <button className="btn btn-outline" style={{ width: '100%', marginTop: '1rem' }} onClick={() => void refreshCloudEntitlements()}>Refresh subscriptions</button>
    </div>
    <p style={{ color: 'var(--text-muted)', fontSize: '.9rem' }}>To purchase or renew a track, open Account and use the Payments & profile tab.</p>
  </div>
}
