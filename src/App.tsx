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
import { usePracticeStore } from './stores/practiceStore'
import { useBookmarksStore } from './stores/bookmarksStore'
import { useState } from 'react'

export default function App() {
  const checkLicenseStatus = useLicenseStore((s) => s.checkLicenseStatus)
  const showPaywall = useUIStore((s) => s.showPaywall)
  const location = useLocation()
  const navigate = useNavigate()
  const [settingsOpen, setSettingsOpen] = useState(false)
  const theme = useUIStore((s) => s.theme)
  const toggleTheme = useUIStore((s) => s.toggleTheme)
  const q = usePracticeStore((s) => s.questions[s.currentIndex])
  const bookmarked = useBookmarksStore((s) => q ? s.isBookmarked(q.id) : false)
  const toggleBookmark = useBookmarksStore((s) => s.toggle)
  const [textScale, setTextScale] = useState(() => Number(localStorage.getItem('hyperion-question-text-scale')) || 100)
  const [automations, setAutomations] = useState(() => {
    try { return JSON.parse(localStorage.getItem('hyperion-practice-automations') || '{"directAnswer":false,"autoNextCorrect":false,"autoNextWrong":false}') as { directAnswer: boolean; autoNextCorrect: boolean; autoNextWrong: boolean } }
    catch { return { directAnswer: false, autoNextCorrect: false, autoNextWrong: false } }
  })
  const updateAutomation = (key: 'directAnswer' | 'autoNextCorrect' | 'autoNextWrong', value: boolean) => setAutomations(old => {
    const updated = { ...old, [key]: value }
    localStorage.setItem('hyperion-practice-automations', JSON.stringify(updated))
    window.dispatchEvent(new CustomEvent('hyperion:practice-settings', { detail: updated }))
    return updated
  })

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
            onClick={() => { if (isPracticeQuiz) window.dispatchEvent(new Event('hyperion:request-exit-practice')); else navigate(backTarget) }}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, position: 'relative' }}>
            <button type="button" onClick={() => { if (q) toggleBookmark(q) }} aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark question'} style={{ border: 0, background: 'transparent', color: bookmarked ? 'var(--accent)' : 'var(--text)', fontSize: '1.5rem', padding: 6 }}> {bookmarked ? '▮' : '♧'} </button>
            <button type="button" onClick={() => setSettingsOpen(v => !v)} aria-label="Question settings" style={{ border: 0, background: 'transparent', color: 'var(--text)', fontSize: '1.5rem', padding: 6 }}>⚙</button>
            {settingsOpen && <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 300, width: 'min(310px, calc(100vw - 24px))', maxHeight: '75vh', overflowY: 'auto', background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', boxShadow: '0 8px 28px rgba(0,0,0,.22)' }}>
              <div style={{ padding: 12, fontWeight: 800, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>DISPLAY SETTINGS</div>
              <button type="button" onClick={toggleTheme} style={{ width: '100%', padding: 12, display: 'flex', justifyContent: 'space-between', background: 'transparent', border: 0, borderBottom: '1px solid var(--border)', color: 'var(--text)' }}><span>{theme === 'light' ? '☀ Daylight' : '☾ Night Ops'}</span><span>{theme === 'light' ? 'ON' : 'OFF'}</span></button>
              <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><strong>Ｔ Text Size</strong><strong style={{ color: 'var(--accent)' }}>{textScale}%</strong></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}><button type="button" disabled={textScale <= 50} onClick={() => { const size = Math.max(50, textScale - 10); setTextScale(size); localStorage.setItem('hyperion-question-text-scale', String(size)); window.dispatchEvent(new CustomEvent('hyperion:text-scale', { detail: size })) }} style={{ padding: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', opacity: textScale <= 50 ? .45 : 1 }}>A−</button><button type="button" onClick={() => { setTextScale(100); localStorage.setItem('hyperion-question-text-scale', '100'); window.dispatchEvent(new CustomEvent('hyperion:text-scale', { detail: 100 })) }} style={{ padding: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)' }}>100%</button><button type="button" disabled={textScale >= 150} onClick={() => { const size = Math.min(150, textScale + 10); setTextScale(size); localStorage.setItem('hyperion-question-text-scale', String(size)); window.dispatchEvent(new CustomEvent('hyperion:text-scale', { detail: size })) }} style={{ padding: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', opacity: textScale >= 150 ? .45 : 1 }}>A+</button></div></div>
              <div style={{ padding: 12, fontWeight: 800, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>PRACTICE AUTOMATIONS</div>
              {([['directAnswer','Direct Answer','Confirm without Check button'],['autoNextCorrect','Auto-Next (Correct)','Advance when correct'],['autoNextWrong','Auto-Next (Wrong)','Advance when incorrect']] as const).map(([key,title,desc]) => <button key={key} onClick={() => updateAutomation(key, !automations[key])} style={{ width: '100%', padding: 12, display: 'flex', justifyContent: 'space-between', gap: 8, background: 'transparent', border: 0, borderBottom: '1px solid var(--border)', color: 'var(--text)', textAlign: 'left' }}><span><strong>{title}</strong><small style={{ display: 'block', color: 'var(--text-muted)' }}>{desc}</small></span><strong>{automations[key] ? 'ON' : 'OFF'}</strong></button>)}
            </div>}
          </div>
        </header>
      )}
      <main style={{ flex: 1 }}>
        <div key={`${location.pathname}${location.search}`} className="route-transition">
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
        </div>
      </main>

      {!hideNav && <BottomNav />}
      {showPaywall && <PaywallDialog />}
    </div>
  )
}
