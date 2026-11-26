import { parseTrackCategory } from '../lib/accountTrackCategory'

/** A self-reported category, not an entitlement or purchase status. */
export default function TrackCategoryBadge({ category }: { category: unknown }) {
  const label = parseTrackCategory(category)
  if (!label) return null
  return <span title="Self-selected account category (not a license)" style={{
    display: 'inline-flex', alignItems: 'center', verticalAlign: 'middle', flexShrink: 0,
    padding: '.18rem .45rem', border: '1px solid var(--border)', borderRadius: 0,
    background: 'var(--bg-elevated)', color: 'var(--text-muted)',
    fontSize: '.67rem', lineHeight: 1.3, fontWeight: 800, letterSpacing: '.035em',
  }}>{label}</span>
}
