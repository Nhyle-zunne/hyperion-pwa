import { useNavigate } from 'react-router-dom'

type AccountSectionTabsProps = {
  active: 'store' | 'licenses' | 'orders' | 'checkout' | null
}

export default function AccountSectionTabs({ active }: AccountSectionTabsProps) {
  const navigate = useNavigate()
  const items = [
    { id: 'store' as const, label: 'Bond Store', path: '/account?tab=payments' },
    { id: 'licenses' as const, label: 'My licenses', path: '/account?tab=licenses' },
    { id: 'orders' as const, label: 'Orders & payment history', path: '/orders' },
  ]
  return <nav className="account-section-tabs" aria-label="Account and subscriptions" style={{ display: 'grid', gridTemplateColumns: 'repeat(3, minmax(0, 1fr))', alignItems: 'stretch', gap: '.5rem', marginBottom: '1rem' }}>
    {items.map(item => <button
      key={item.id}
      type="button"
      className="btn btn-outline"
      aria-current={active === item.id ? 'page' : undefined}
      aria-selected={active === item.id}
      onClick={() => navigate(item.path)}
      style={{
        minWidth: 0,
        borderColor: active === item.id ? '#147d43' : 'var(--border)',
        background: active === item.id ? '#147d43' : 'var(--bg-card)',
        color: active === item.id ? '#fff' : 'var(--text)',
        whiteSpace: 'normal',
        lineHeight: 1.25,
      }}
    >{item.label}</button>)}
  </nav>
}
