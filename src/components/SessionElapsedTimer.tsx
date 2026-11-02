import { useEffect, useState } from 'react'

export function formatSessionElapsed(startedAt: number, now: number): string {
  const seconds = Number.isFinite(startedAt) && startedAt > 0 && Number.isFinite(now)
    ? Math.max(0, Math.floor((now - startedAt) / 1000)) : 0
  return [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
    .map(value => String(value).padStart(2, '0')).join(':')
}

/** Display only: existing session history and exam countdown remain authoritative. */
export default function SessionElapsedTimer({ startedAt, inline = false }: { startedAt: number | null, inline?: boolean }) {
  const [now, setNow] = useState(Date.now)
  useEffect(() => {
    const update = () => setNow(Date.now())
    update()
    if (!startedAt) return
    const timer = window.setInterval(update, 1000)
    document.addEventListener('visibilitychange', update)
    window.addEventListener('focus', update)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', update)
      window.removeEventListener('focus', update)
    }
  }, [startedAt])
  return <div style={{ display: 'flex', justifyContent: 'flex-end', margin: inline ? 0 : '.5rem 0 1rem', flexShrink: 0 }}>
    <div role="timer" aria-label="Session elapsed time" aria-live="off" style={{ display: 'flex', gap: 10, padding: '.45rem .65rem', border: '1px solid var(--border)', background: 'var(--bg-card)', fontVariantNumeric: 'tabular-nums' }}>
      <span style={{ fontSize: '.75rem', color: 'var(--text-muted)', alignSelf: 'center' }}>ELAPSED</span>
      <strong style={{ color: 'var(--success)', fontFamily: 'monospace' }}>{formatSessionElapsed(startedAt || 0, now)}</strong>
    </div>
  </div>
}
