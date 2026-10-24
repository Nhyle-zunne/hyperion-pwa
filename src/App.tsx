import { useEffect } from 'react'
import { Routes, Route, useLocation } from 'react-router-dom'
import { useLicenseStore } from './stores/licenseStore'
import HomeScreen from './screens/HomeScreen'
import ActivationScreen from './screens/ActivationScreen'
import LicenseScreen from './screens/LicenseScreen'
import TrackSelectionScreen from './screens/TrackSelectionScreen'
import HowToAvailScreen from './screens/HowToAvailScreen'
import AboutScreen from './screens/AboutScreen'
import TermsScreen from './screens/TermsScreen'
import PracticeConfigScreen from './screens/PracticeConfigScreen'
import PracticeQuizScreen from './screens/PracticeQuizScreen'
import DrillScreen from './screens/DrillScreen'
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

  useEffect(() => {
    checkLicenseStatus()
    const interval = setInterval(checkLicenseStatus, 60_000)
    return () => clearInterval(interval)
  }, [checkLicenseStatus])

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
      <main style={{ flex: 1 }}>
        <Routes>
          <Route path="/" element={<TrackSelectionScreen />} />
          <Route path="/tracks" element={<TrackSelectionScreen />} />
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/activation" element={<ActivationScreen />} />
          <Route path="/license" element={<LicenseScreen />} />
          <Route path="/howto" element={<HowToAvailScreen />} />
          <Route path="/about" element={<AboutScreen />} />
          <Route path="/terms" element={<TermsScreen />} />
          <Route path="/practice" element={<PracticeConfigScreen />} />
          <Route path="/practice/quiz" element={<PracticeQuizScreen />} />
          <Route path="/drill" element={<DrillScreen />} />
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
