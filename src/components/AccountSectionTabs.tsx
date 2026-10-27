import { useNavigate } from 'react-router-dom'

type AccountSectionTabsProps = {
  active: 'store' | 'licenses' | 'orders' | null
}

export default function AccountSectionTabs({ active }: AccountSectionTabsProps) {
  const navigate = useNavigate()
  const items = [
    { id: 'store' as const, label: 'Bond Store', path: '/account?tab=payments' },
    { id: 'licenses' as const, label: 'My licenses', path: '/account?tab=licenses' },
    { id: 'orders' as const, label: 'Orders & payment history', path: '/orders' },
  ]
  return <nav className="account-section-tabs" aria-label="Account and subscriptions" style={{ display: 'flex', gap: '.5rem', flexWrap: 'wrap', marginBottom: '1rem' }}>
    {items.map(item => <button
      key={item.id}
      type="button"
      className="btn btn-outline"
      aria-current={active === item.id ? 'page' : undefined}
      aria-selected={active === item.id}
      onClick={() => navigate(item.path)}
      style={{
        flex: '1 1 auto',
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
