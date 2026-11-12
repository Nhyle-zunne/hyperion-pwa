import React from 'react'
import { createRoot } from 'react-dom/client'
import { MemoryRouter, Link } from 'react-router-dom'
import { registerSW } from 'virtual:pwa-register'
import App from '../../src/App'
import { useLicenseStore } from '../../src/stores/licenseStore'
import { usePracticeStore } from '../../src/stores/practiceStore'
import { useBookmarksStore } from '../../src/stores/bookmarksStore'
import { fixtureQuestions } from './quickscan-bank-fixture'
import '../../src/index.css'
registerSW({ immediate: true })
// Stub only remote entitlement restoration in this test entry. All UI, routing,
// question navigation, bookmarks, and encrypted keyword storage are the real code.
useLicenseStore.setState({ entitlementsVerified: true, isAllAccessUnlocked: true, cloudTrackIds: ['DECK_OIC_NW'], refreshCloudEntitlements: async () => {} })
// Keep background cache refreshes inert in this isolated presentation test.
Object.assign(useLicenseStore.getState(), { refreshCachedEntitlements: async () => {} })
usePracticeStore.setState({ questions: fixtureQuestions.slice(0, 2), currentIndex: 1, track: 'DECK_OIC_NW', competenceId: 'C1', mode: 'PRACTICE', loading: false, finished: false, isFreeSession: false, startedAt: Date.now() })
void useBookmarksStore.persist.rehydrate().then(() => {
  createRoot(document.getElementById('root')!).render(<MemoryRouter initialEntries={['/quick-scan/view?track=oic_nw&competence=C1']}>
    <nav><Link to="/practice/quiz" onClick={() => usePracticeStore.setState({ currentIndex: 0 })}>Practice fixture</Link> · <Link to="/quick-scan/view?track=oic_nw&competence=C1">Quick Scan fixture</Link> · <Link to="/quick-scan?track=oic_nw">Quick Scan directory</Link></nav>
    <App />
  </MemoryRouter>)
})
