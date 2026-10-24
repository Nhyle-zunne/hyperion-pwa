import { NavLink } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'

const items = [
  { to: '/', label: 'Home', icon: '🏠' },
  { to: '/tracks', label: 'Tracks', icon: '📚' },
  { to: '/history', label: 'History', icon: '📊' },
  { to: '/license', label: 'License', icon: '🔑' }
]

export default function BottomNav() {
  return (
    <nav
      style={{
        position: 'fixed',
        bottom: 0,
        left: 0,
        right: 0,
        background: 'var(--bg-card)',
        borderTop: '1px solid var(--border)',
        display: 'flex',
        justifyContent: 'space-around',
        alignItems: 'center',
        padding: '0.5rem 0 calc(0.5rem + env(safe-area-inset-bottom))',
        zIndex: 100
      }}
    >
      {items.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.to === '/'}
          style={({ isActive }) => ({
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 2,
            fontSize: '0.7rem',
            color: isActive ? 'var(--accent)' : 'var(--text-muted)',
            textDecoration: 'none',
            minWidth: 52
          })}
        >
          <span style={{ fontSize: '1.25rem' }}>{item.icon}</span>
          {item.label}
        </NavLink>
      ))}
      <div style={{ display: 'flex', alignItems: 'center', minWidth: 52, justifyContent: 'center' }}>
        <ThemeToggle compact />
      </div>
    </nav>
  )
}
