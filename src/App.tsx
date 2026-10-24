import { useEffect } from 'react'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import { useLicenseStore } from './stores/licenseStore'
import HomeScreen from './screens/HomeScreen'
import ActivationScreen from './screens/ActivationScreen'
import LicenseScreen from './screens/LicenseScreen'
import TrackSelectionScreen from './screens/TrackSelectionScreen'
import TrackHubScreen from './screens/TrackHubScreen'
import HowToAvailScreen from './screens/HowToAvailScreen'
import AboutScreen from './screens/AboutScreen'
import TermsScreen from './screens/TermsScreen'
import PracticeConfigScreen from './screens/PracticeConfigScreen'
import PracticeCompetenceScreen from './screens/PracticeCompetenceScreen'
import PracticeQuizScreen from './screens/PracticeQuizScreen'
import DrillScreen from './screens/DrillScreen'
import QuickScanCompetenceScreen from './screens/QuickScanCompetenceScreen'
import QuickScanViewerScreen from './screens/QuickScanViewerScreen'
import MockExamScreen, { MockExamRunner } from './screens/MockExamScreen'
import HistoryScreen from './screens/HistoryScreen'
import FlashcardsScreen from './screens/FlashcardsScreen'
import BookmarksScreen from './screens/BookmarksScreen'
import SearchScreen from './screens/SearchScreen'
import VaultScreen from './screens/VaultScreen'
import StudyTimeScreen from './screens/StudyTimeScreen'
import PaywallDialog from './components/PaywallDialog'
import BottomNav from './components/BottomNav'
import { useUIStore } from './stores/uiStore'

export default function App() {
  const checkLicenseStatus = useLicenseStore((s) => s.checkLicenseStatus)
  const showPaywall = useUIStore((s) => s.showPaywall)
  const location = useLocation()
  const navigate = useNavigate()

  useEffect(() => {
    checkLicenseStatus()
    const interval = setInterval(checkLicenseStatus, 60_000)
    return () => clearInterval(interval)
  }, [checkLicenseStatus])

  const isPracticeQuiz = location.pathname === '/practice/quiz'
  const isMockRunner = location.pathname === '/mock/exam'
  const isQuestionRunner = isPracticeQuiz || isMockRunner
  const backTarget = isMockRunner ? '/mock' : '/practice'

  const hideNav = [
    '/activation',
    '/license',
    '/howto',
    '/terms',
    '/about',
    '/practice/quiz',
    '/mock/exam'
  ].some((p) => location.pathname.startsWith(p))

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      {isQuestionRunner && (
        <header
          aria-label="Question navigation"
          style={{
            position: 'sticky',
            top: 0,
            zIndex: 100,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
            padding: '0.7rem 1rem',
            paddingTop: 'calc(0.7rem + env(safe-area-inset-top))',
            background: 'var(--bg-card)',
            borderBottom: '1px solid var(--border)',
            boxShadow: '0 2px 8px rgba(0,0,0,0.18)'
          }}
        >
          <button
            type="button"
            onClick={() => navigate(backTarget)}
            aria-label={isMockRunner ? 'Back to mock exam overview' : 'Back to practice setup'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 7,
              minHeight: 42,
              padding: '0.45rem 0.7rem',
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-elevated)',
              color: 'var(--text)',
              fontWeight: 700
            }}
          >
            <span aria-hidden="true">←</span>
            Back
          </button>
          <span style={{ color: 'var(--text-muted)', fontSize: '0.8rem', fontWeight: 700 }}>
            {isMockRunner ? 'MOCK EXAM' : 'PRACTICE'}
          </span>
          <button
            type="button"
            onClick={() => navigate('/tracks')}
            aria-label="Go to Home"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 7,
              minHeight: 42,
              padding: '0.45rem 0.7rem',
              border: '1px solid var(--accent)',
              borderRadius: 8,
              background: 'transparent',
              color: 'var(--accent)',
              fontWeight: 800
            }}
          >
            <span aria-hidden="true">⌂</span>
            Home
          </button>
        </header>
      )}
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<TrackSelectionScreen />} />
          <Route path="/tracks" element={<TrackSelectionScreen />} />
          <Route path="/track" element={<TrackHubScreen />} />
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/activation" element={<ActivationScreen />} />
          <Route path="/license" element={<LicenseScreen />} />
          <Route path="/howto" element={<HowToAvailScreen />} />
          <Route path="/about" element={<AboutScreen />} />
          <Route path="/terms" element={<TermsScreen />} />
          <Route path="/practice/competences" element={<PracticeCompetenceScreen />} />
          <Route path="/practice" element={<PracticeConfigScreen />} />
          <Route path="/practice/quiz" element={<PracticeQuizScreen />} />
          <Route path="/drill" element={<DrillScreen />} />
          <Route path="/quick-scan" element={<QuickScanCompetenceScreen />} />
          <Route path="/quick-scan/view" element={<QuickScanViewerScreen />} />
          <Route path="/mock" element={<MockExamScreen />} />
          <Route path="/mock/exam" element={<MockExamRunner />} />
          <Route path="/history" element={<HistoryScreen />} />
          <Route path="/flashcards" element={<FlashcardsScreen />} />
          <Route path="/bookmarks" element={<BookmarksScreen />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/vault" element={<VaultScreen />} />
          <Route path="/studytime" element={<StudyTimeScreen />} />
          <Route path="/streak" element={<StudyTimeScreen />} />
          <Route path="*" element={<TrackSelectionScreen />} />
        </Routes>
      </main>

      {!hideNav && <BottomNav />}
      {showPaywall && <PaywallDialog />}
    </div>
  )
}
