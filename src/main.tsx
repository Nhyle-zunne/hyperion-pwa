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

// Ensure installed iOS/Android PWAs activate new deployed UI automatically.
registerSW({ immediate: true })

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
