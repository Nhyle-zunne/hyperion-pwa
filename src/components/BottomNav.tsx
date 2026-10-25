import { useState } from 'react'
import { NavLink } from 'react-router-dom'
import ThemeToggle from './ThemeToggle'
import AppDrawer from './AppDrawer'

const items = [
  { to: '/', label: 'Dashboard', icon: '🏠' },
  { to: '/history', label: 'History', icon: '📊' },
  { to: '/license', label: 'License', icon: '🔑' },
  { to: '/account', label: 'Account', icon: '👤' }
]
const FB = 'https://www.facebook.com/hyperionbynhyle/'

export default function BottomNav() {
  const [drawerOpen, setDrawerOpen] = useState(false)
  return (
    <>
      <AppDrawer open={drawerOpen} onClose={() => setDrawerOpen(false)} />
      <nav className="app-bottom-nav" aria-label="Main navigation">
        <button type="button" className="desktop-menu-button" onClick={() => setDrawerOpen(true)} aria-label="Open app menu">☰</button>
        {items.map((item) => (
          <NavLink key={item.to} to={item.to} end={item.to === '/'} className={({ isActive }) => (isActive ? 'active' : '')}>
            <span aria-hidden="true">{item.icon}</span>
            {item.label}
          </NavLink>
        ))}
        <a className="contact-link" href={FB} target="_blank" rel="noopener noreferrer">
          <span className="facebook-mark" aria-hidden="true">f</span> Contact Us
        </a>
        <div className="nav-theme-toggle"><ThemeToggle compact /></div>
      </nav>
    </>
  )
}
