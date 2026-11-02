import { useKeywordSettings } from '../stores/keywordSettings'

export default function KeywordHighlightSetting() {
  const { enabled, setEnabled } = useKeywordSettings()
  return <label style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12, borderBottom: '1px solid var(--border)', cursor: 'pointer' }}>
    <span>Highlight Keywords</span>
    <input type="checkbox" role="switch" checked={enabled} onChange={event => setEnabled(event.target.checked)} style={{ accentColor: 'var(--accent)', width: 20, height: 20 }} />
  </label>
}
