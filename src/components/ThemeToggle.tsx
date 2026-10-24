import { useUIStore } from '../stores/uiStore'

export default function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const isDark = theme === 'dark'

  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggleTheme}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Light mode' : 'Dark mode'}
    >
      <span aria-hidden>{isDark ? '☀️' : '🌙'}</span>
      {!compact && <span>{isDark ? 'Light' : 'Dark'}</span>}
    </button>
  )
}
