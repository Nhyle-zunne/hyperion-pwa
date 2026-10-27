import { useEffect, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { getPageLoadingSnapshot, PAGE_LOADING_EVENT, type PageLoadingSnapshot } from '../lib/pageLoading'

const ROUTE_TRANSITION_MS = 480

export default function TopLoadingIndicator() {
  const location = useLocation()
  const [routeLoading, setRouteLoading] = useState(true)
  const [snapshot, setSnapshot] = useState<PageLoadingSnapshot>(() => getPageLoadingSnapshot())
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    setRouteLoading(true)
    const timer = window.setTimeout(() => setRouteLoading(false), ROUTE_TRANSITION_MS)
    return () => window.clearTimeout(timer)
  }, [location.pathname, location.search, location.hash])

  useEffect(() => {
    const handleLoadingChange = (event: Event) => {
      const detail = (event as CustomEvent<PageLoadingSnapshot>).detail
      if (detail && typeof detail.count === 'number') setSnapshot(detail)
    }
    window.addEventListener(PAGE_LOADING_EVENT, handleLoadingChange)
    setSnapshot(getPageLoadingSnapshot())
    return () => window.removeEventListener(PAGE_LOADING_EVENT, handleLoadingChange)
  }, [])

  const busy = routeLoading || snapshot.count > 0
  useEffect(() => {
    if (busy) {
      const timer = window.setTimeout(() => setVisible(true), 70)
      return () => window.clearTimeout(timer)
    }
    const timer = window.setTimeout(() => setVisible(false), 180)
    return () => window.clearTimeout(timer)
  }, [busy])

  if (!visible && !busy) return null

  const label = snapshot.count > 0 ? snapshot.label : 'Loading page'

  return (
    <div
      className={`hyperion-top-loader${visible && busy ? ' is-visible' : ''}`}
      role="status"
      aria-live="polite"
      aria-label={label}
      aria-hidden={!visible || !busy}
    >
      <span className="hyperion-top-loader__track" aria-hidden="true">
        <span className="hyperion-top-loader__progress" />
      </span>
      <span className="hyperion-top-loader__logo-wrap" aria-hidden="true">
        <span className="hyperion-top-loader__pulse hyperion-top-loader__pulse--one" />
        <span className="hyperion-top-loader__pulse hyperion-top-loader__pulse--two" />
        <span className="hyperion-top-loader__pulse hyperion-top-loader__pulse--three" />
        <img className="hyperion-top-loader__logo" src="/logo.png?v=2" alt="" />
      </span>
      <span className="hyperion-top-loader__sr-only">{label}</span>
    </div>
  )
}
