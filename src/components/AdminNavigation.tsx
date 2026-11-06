import { Link, NavLink } from 'react-router-dom'

const sections = [
  { to: '/admin/licenses', label: 'USER LICENSES' },
  { to: '/admin/payments', label: 'PAYMENT SUBMISSIONS' },
  { to: '/admin/questions', label: 'QUESTION BANK' },
]

export default function AdminNavigation() {
  return <div className="admin-page-navigation">
    <Link to="/account" className="admin-page-navigation__back">← Account</Link>
    <nav className="admin-page-navigation__sections" aria-label="Administration">
      {sections.map(section => <NavLink
        key={section.to}
        to={section.to}
        end
        className={({ isActive }) => `btn admin-section-link ${isActive ? 'btn-primary' : 'btn-outline'}`}
      >{section.label}</NavLink>)}
    </nav>
  </div>
}
