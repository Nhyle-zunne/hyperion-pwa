import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { initTheme } from './stores/uiStore'
import { registerSW } from 'virtual:pwa-register'

// Keep the production app on its canonical domain, including old workers.dev links.
if (window.location.hostname === 'hyperion-pwa.zagfunne.workers.dev') {
  window.location.replace(`https://hyperionmaritime.org${window.location.pathname}${window.location.search}${window.location.hash}`)
}

initTheme()

// Ensure installed PWAs and long-lived browser tabs pick up deployments.
// Auto-update reloads clients after a new worker activates; explicit checks on
// startup, focus and a low-frequency visible-tab interval prevent old tabs from
// staying on a stale bundle for hours.
registerSW({
  immediate: true,
  onRegisteredSW: (_swUrl, registration) => {
    if (!registration) return
    let lastUpdateCheck = 0
    const checkForUpdate = () => {
      if (document.visibilityState !== 'visible') return
      if (Date.now() - lastUpdateCheck < 5 * 60 * 1000) return
      lastUpdateCheck = Date.now()
      void registration.update().catch(() => {
        // A temporary network failure must never interrupt local/offline study.
      })
    }
    window.setTimeout(checkForUpdate, 5_000)
    window.setInterval(checkForUpdate, 15 * 60 * 1000)
    window.addEventListener('focus', checkForUpdate)
    document.addEventListener('visibilitychange', checkForUpdate)
  }
})

// Remove the legacy offline cache of publicly served encrypted question banks.
// New question delivery uses the protected Supabase endpoint and must not reuse that cache.
if ('caches' in window) {
  void window.caches.delete('hyperion-question-banks')
}


createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
)
