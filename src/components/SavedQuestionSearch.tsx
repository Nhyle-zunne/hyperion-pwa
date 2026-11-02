import { useId, useRef } from 'react'

export default function SavedQuestionSearch({ value, onChange, collection }: {
  value: string
  onChange: (value: string) => void
  collection: 'bookmarks' | 'mistakes'
}) {
  const id = useId()
  const input = useRef<HTMLInputElement>(null)
  return <form role="search" aria-label={`Search ${collection}`} onSubmit={event => {
    event.preventDefault()
    onChange(value.trim())
  }} style={{ marginBottom: 16 }}>
    <label htmlFor={id} style={{ display: 'block', fontWeight: 800, marginBottom: 6 }}>Search Questions</label>
    <p id={`${id}-hint`} style={{ fontSize: '.85rem', color: 'var(--text-muted)', margin: '0 0 10px' }}>
      Find {collection === 'bookmarks' ? 'bookmarked questions' : 'saved mistakes'} by keyword, item code, function or competence.
    </p>
    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
      <div style={{ position: 'relative', flex: 1, minWidth: 0 }}>
        <svg aria-hidden="true" viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', pointerEvents: 'none' }}>
          <circle cx="10.5" cy="10.5" r="6.5" /><path d="m16 16 4.5 4.5" />
        </svg>
        <input ref={input} id={id} type="search" className="input" aria-label={`Search ${collection}`} aria-describedby={`${id}-hint`}
          value={value} onChange={event => onChange(event.target.value)} placeholder="e.g. COLREG, ECDIS, C1…"
          style={{ width: '100%', minWidth: 0, paddingLeft: 38 }} />
      </div>
      <button type="submit" className="btn btn-primary" disabled={!value.trim()} style={{ flexShrink: 0 }}>Go</button>
      {value && <button type="button" className="btn btn-outline" aria-label={`Clear ${collection} search`} onClick={() => {
        onChange('')
        input.current?.focus()
      }} style={{ flexShrink: 0 }}>Clear</button>}
    </div>
  </form>
}
