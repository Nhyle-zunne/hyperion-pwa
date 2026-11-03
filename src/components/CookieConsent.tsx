import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

const STORAGE_KEY = 'hyperion-cookie-consent'
type Choice = 'accepted' | 'essential'
export function hasCookieChoice(): boolean {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    return saved?.version === 1 && (saved.choice === 'accepted' || saved.choice === 'essential')
      && typeof saved.savedAt === 'number' && Number.isFinite(saved.savedAt)
  } catch { return false }
}

export default function CookieConsent() {
  const [visible, setVisible] = useState(() => !hasCookieChoice())
  useEffect(() => {
    const reopen = () => setVisible(true)
    const update = (event: StorageEvent) => { if (event.key === STORAGE_KEY || event.key === null) setVisible(!hasCookieChoice()) }
    window.addEventListener('hyperion:open-cookie-preferences', reopen)
    window.addEventListener('storage', update)
    return () => {
      window.removeEventListener('hyperion:open-cookie-preferences', reopen)
      window.removeEventListener('storage', update)
    }
  }, [])
  const choose = (choice: Choice) => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, choice, savedAt: Date.now() })) } catch { /* The choice still applies for this visit when browser storage is unavailable. */ }
    setVisible(false)
    window.dispatchEvent(new Event('hyperion:cookie-choice'))
  }
  if (!visible) return null
  return <section className="cookie-notice" role="region" aria-label="Cookie preferences">
    <div className="cookie-notice-copy">
      <h2>Your privacy choices</h2>
      <p>We use essential cookies and browser storage to keep you signed in, save your progress, and support offline study. We don’t use advertising cookies. <Link to="/privacy-policy">Privacy policy</Link></p>
    </div>
    <div className="cookie-notice-actions">
      <button type="button" className="btn btn-outline" onClick={() => choose('essential')}>Essential only</button>
      <button type="button" className="btn btn-primary" onClick={() => choose('accepted')}>Accept</button>
    </div>
  </section>
}
