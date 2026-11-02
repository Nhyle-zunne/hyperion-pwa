import type { ReactNode } from 'react'

export interface CompetenceDirectoryItem {
  id: string
  label: string
  count: number | undefined
  countPrefix?: string
}

/** Shared selection layout for Practice and Flashcards, across every track. */
export default function CompetenceDirectory({ title, totalCount, items, countError, onBack, onSelect, children, allQuestions }: {
  title: string
  totalCount: number | null
  items: CompetenceDirectoryItem[]
  countError: string
  onBack: () => void
  onSelect: (id: string) => void
  children?: ReactNode
  allQuestions?: () => void
}) {
  const rowStyle = { display: 'grid', gridTemplateColumns: '3rem minmax(0,1fr) 1.25rem', alignItems: 'center', gap: '.8rem', textAlign: 'left' as const, width: '100%', borderRadius: 0, border: '1px solid #334155', background: '#1e293b', padding: '1.1rem', minHeight: 90 }
  const badgeStyle = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', background: '#334155', color: '#22c55e', fontWeight: 900, minHeight: 38, padding: '0 .4rem' }
  const titleStyle = { display: 'block', fontSize: '1rem', lineHeight: 1.45, fontWeight: 900, textTransform: 'uppercase' as const }
  const countStyle = { display: 'block', color: '#94a3b8', fontSize: '.83rem', fontWeight: 700, marginTop: '.2rem' }
  return <>
    <button type="button" onClick={onBack} style={{ color: 'var(--text-muted)', margin: '0 0 1.2rem', padding: '0.5rem 0' }}>← Back to Track</button>
    <div className="card" style={{ borderRadius: 0, border: '1px solid #087f63', borderTop: '3px solid #00e5a0', background: 'linear-gradient(120deg, #172b31, #17252d)', padding: '1.2rem', marginBottom: '3rem' }}>
      <h1 style={{ fontSize: '1.35rem', lineHeight: 1.25, margin: '0 0 .4rem', fontWeight: 900 }}>{title}</h1>
      <p style={{ color: '#9af1d1', fontWeight: 700, lineHeight: 1.45, margin: 0 }}>{countError ? 'Verified question counts are currently unavailable.' : totalCount === null ? 'Loading verified question counts…' : `${totalCount.toLocaleString()} valid questions across ${items.length} competencies.`}</p>
    </div>
    <h2 style={{ fontSize: '.95rem', letterSpacing: '.13em', fontWeight: 900, borderTop: '3px solid #334155', paddingTop: '1rem', margin: '0 0 1.5rem' }}>COMPETENCE DIRECTORY ({items.length})</h2>
    {countError && <p role="status" style={{ color: 'var(--danger)', marginBottom: '1rem' }}>{countError}</p>}
    {children}
    <div style={{ display: 'grid', gap: '1rem' }}>
      {allQuestions && <button type="button" className="card" onClick={allQuestions} style={rowStyle}>
        <span style={badgeStyle}>ALL</span><span style={{ minWidth: 0 }}><strong style={titleStyle}>All questions</strong><span style={countStyle}>{totalCount === null ? '…' : totalCount.toLocaleString()} official review questions · Full track</span></span><span aria-hidden="true" style={{ color: '#94a3b8', fontSize: '1.4rem' }}>→</span>
      </button>}
      {items.map(item => <button key={item.id} type="button" className="card" onClick={() => onSelect(item.id)} style={rowStyle}>
        <span style={badgeStyle}>{item.id}</span>
        <span style={{ minWidth: 0 }}><strong style={titleStyle}>{item.label.replace(/^C\d+ · /, '')}</strong><span style={countStyle}>{item.countPrefix}{item.count ?? '…'} official review questions</span></span>
        <span aria-hidden="true" style={{ color: '#94a3b8', fontSize: '1.4rem' }}>→</span>
      </button>)}
    </div>
  </>
}
