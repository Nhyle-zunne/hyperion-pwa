import { useEffect } from 'react'
import { useLicenseStore } from './stores/licenseStore'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import HomeScreen from './screens/HomeScreen'
import TrackSelectionScreen from './screens/TrackSelectionScreen'
import AccountScreen from './screens/AccountScreen'
import BasketScreen from './screens/BasketScreen'
import ManualPaymentScreen from './screens/ManualPaymentScreen'
import OrdersPaymentHistoryScreen from './screens/OrdersPaymentHistoryScreen'
import OAuthCallbackScreen from './screens/OAuthCallbackScreen'
import AdminPaymentsScreen from './screens/AdminPaymentsScreen'
import TrackHubScreen from './screens/TrackHubScreen'
import AboutScreen from './screens/AboutScreen'
import TermsScreen from './screens/TermsScreen'
import PrivacyPolicyScreen from './screens/PrivacyPolicyScreen'
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
import StudyTimeScreen from './screens/StudyTimeScreen'
import PaywallDialog from './components/PaywallDialog'
import BottomNav from './components/BottomNav'
import { useUIStore } from './stores/uiStore'
import { usePracticeStore } from './stores/practiceStore'
import { useBookmarksStore } from './stores/bookmarksStore'
import { supabase } from './lib/supabase'
import { startLearningProgressSync } from './lib/progressSync'
import { useState } from 'react'

export default function App() {
  const refreshCloudEntitlements = useLicenseStore((s) => s.refreshCloudEntitlements)
  const cloudTrackIds = useLicenseStore((s) => s.cloudTrackIds)
  const entitlementsVerified = useLicenseStore((s) => s.entitlementsVerified)
  const isAllAccessUnlocked = useLicenseStore((s) => s.isAllAccessUnlocked)
  const currentTrack = usePracticeStore((s) => s.track)
  const isFreeSession = usePracticeStore((s) => s.isFreeSession)
  const sessionLoading = usePracticeStore((s) => s.loading)
  const sessionQuestionCount = usePracticeStore((s) => s.questions.length)
  const showPaywall = useUIStore((s) => s.showPaywall)
  const location = useLocation()
  const navigate = useNavigate()
  const [resumeSession, setResumeSession] = useState<{ mode: 'PRACTICE' | 'DRILL' | 'MOCK'; track: string | null; competenceId: string | null } | null>(null)
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

  const [entitlementsChecked, setEntitlementsChecked] = useState(false)
  useEffect(() => {
    let alive = true
    const refresh = async () => {
      await refreshCloudEntitlements()
      if (alive) setEntitlementsChecked(true)
    }
    void refresh()
    const authListener = supabase?.auth.onAuthStateChange(() => {
      setEntitlementsChecked(false)
      window.setTimeout(() => { void refresh() }, 0)
    })
    const refreshOnWake = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, 30_000)
    window.addEventListener('focus', refreshOnWake)
    document.addEventListener('visibilitychange', refreshOnWake)
    return () => {
      alive = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnWake)
      document.removeEventListener('visibilitychange', refreshOnWake)
      authListener?.data.subscription.unsubscribe()
    }
  }, [refreshCloudEntitlements])

  useEffect(() => startLearningProgressSync(), [])

  useEffect(() => {
    const handleProgressRestored = (event: Event) => {
      const detail = (event as CustomEvent<{
        hasActiveSession?: boolean
        mode?: 'PRACTICE' | 'DRILL' | 'MOCK' | null
        track?: string | null
        competenceId?: string | null
      }>).detail
      if (!detail?.hasActiveSession || !detail.mode) {
        setResumeSession(null)
        return
      }
      if (location.pathname === '/mock/exam' || location.pathname === '/practice/quiz') return
      setResumeSession({ mode: detail.mode, track: detail.track ?? null, competenceId: detail.competenceId ?? null })
    }
    window.addEventListener('hyperion:learning-progress-restored', handleProgressRestored)
    return () => window.removeEventListener('hyperion:learning-progress-restored', handleProgressRestored)
  }, [location.pathname])

  const isPracticeQuiz = location.pathname === '/practice/quiz'
  const isMockRunner = location.pathname === '/mock/exam'
  const isQuestionRunner = isPracticeQuiz || isMockRunner

  useEffect(() => {
    if (!entitlementsChecked || !isQuestionRunner || !currentTrack || isFreeSession || sessionLoading || sessionQuestionCount === 0) return
    const allowed = entitlementsVerified && (isAllAccessUnlocked || cloudTrackIds.includes('ALL') || cloudTrackIds.includes(currentTrack))
    if (allowed) return
    const trackParam: Record<string, string> = {
      DECK_OIC_NW: 'oic_nw', GMDSS_GOC: 'gmdss', ENGINE_OIC_EW: 'engine_ew',
      DECK_MGT: 'deck_mgt', ENGINE_MGT: 'engine_mgt'
    }
    usePracticeStore.getState().reset()
    navigate('/track?track=' + (trackParam[currentTrack] || 'oic_nw'), { replace: true })
    useUIStore.getState().openPaywall('This paid session needs a current, verified license. Renew access or reconnect to check your subscription.')
  }, [entitlementsChecked, entitlementsVerified, cloudTrackIds, isAllAccessUnlocked, isQuestionRunner, currentTrack, isFreeSession, sessionLoading, sessionQuestionCount, navigate])

  const hideNav = [
    '/practice/quiz',
    '/mock/exam',
    '/auth/callback'
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
            onClick={() => { if (isPracticeQuiz) window.dispatchEvent(new Event('hyperion:request-exit-practice')); else window.dispatchEvent(new Event('hyperion:request-exit-mock')) }}
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
              <div style={{ padding: 12, fontWeight: 800, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)', background: 'var(--bg-elevated)' }}>DISPLAY SETTINGS</div>
              <div style={{ width: '100%', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10, background: 'transparent', borderBottom: '1px solid var(--border)', color: 'var(--text)' }}><span>{theme === 'light' ? '☀ Daylight' : '☾ Night Mode'}</span><button type="button" role="switch" aria-label="Night Mode" aria-checked={theme !== 'light'} onClick={toggleTheme} style={{ position: 'relative', width: 64, height: 30, flexShrink: 0, padding: 3, border: 0, borderRadius: 999, cursor: 'pointer', background: theme !== 'light' ? '#16c60c' : '#d1d5db', transition: 'background 180ms ease', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.14)' }}><span style={{ position: 'absolute', top: 3, left: theme !== 'light' ? 37 : 3, width: 24, height: 24, borderRadius: '50%', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'left 180ms ease' }} /><span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: theme !== 'light' ? 'flex-start' : 'flex-end', padding: '0 8px', color: theme !== 'light' ? '#ffffff' : '#374151', fontSize: 9, fontWeight: 900, pointerEvents: 'none' }}>{theme !== 'light' ? 'ON' : 'OFF'}</span></button></div>
              <div style={{ padding: 12, borderBottom: '1px solid var(--border)' }}><div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 8 }}><strong>Ｔ Text Size</strong><strong style={{ color: 'var(--accent)' }}>{textScale}%</strong></div><div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 6 }}><button type="button" disabled={textScale <= 50} onClick={() => { const size = Math.max(50, textScale - 10); setTextScale(size); localStorage.setItem('hyperion-question-text-scale', String(size)); window.dispatchEvent(new CustomEvent('hyperion:text-scale', { detail: size })) }} style={{ padding: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', opacity: textScale <= 50 ? .45 : 1 }}>A−</button><button type="button" onClick={() => { setTextScale(100); localStorage.setItem('hyperion-question-text-scale', '100'); window.dispatchEvent(new CustomEvent('hyperion:text-scale', { detail: 100 })) }} style={{ padding: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)' }}>100%</button><button type="button" disabled={textScale >= 150} onClick={() => { const size = Math.min(150, textScale + 10); setTextScale(size); localStorage.setItem('hyperion-question-text-scale', String(size)); window.dispatchEvent(new CustomEvent('hyperion:text-scale', { detail: size })) }} style={{ padding: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--accent)', opacity: textScale >= 150 ? .45 : 1 }}>A+</button></div></div>
{!isMockRunner && <>
              <div style={{ padding: 12, fontWeight: 800, color: 'var(--text-muted)', borderBottom: '1px solid var(--border)' }}>PRACTICE AUTOMATIONS</div>
              {([['directAnswer','Direct Answer','Confirm without Check button'],['autoNextCorrect','Auto-Next (Correct)','Advance when correct'],['autoNextWrong','Auto-Next (Wrong)','Advance when incorrect']] as const).map(([key,title,desc]) => <div key={key} style={{ width: '100%', padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, background: 'transparent', borderBottom: '1px solid var(--border)', color: 'var(--text)', textAlign: 'left' }}><span><strong>{title}</strong><small style={{ display: 'block', color: 'var(--text-muted)' }}>{desc}</small></span><button type="button" role="switch" aria-label={title} aria-checked={automations[key]} onClick={() => updateAutomation(key, !automations[key])} style={{ position: 'relative', width: 64, height: 30, flexShrink: 0, padding: 3, border: 0, borderRadius: 999, cursor: 'pointer', background: automations[key] ? '#16c60c' : '#d1d5db', transition: 'background 180ms ease', boxShadow: 'inset 0 1px 2px rgba(0,0,0,.14)' }}><span style={{ position: 'absolute', top: 3, left: automations[key] ? 37 : 3, width: 24, height: 24, borderRadius: '50%', background: '#ffffff', boxShadow: '0 1px 3px rgba(0,0,0,.28)', transition: 'left 180ms ease' }} /><span style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: automations[key] ? 'flex-start' : 'flex-end', padding: '0 8px', color: automations[key] ? '#ffffff' : '#374151', fontSize: 9, fontWeight: 900, pointerEvents: 'none' }}>{automations[key] ? 'ON' : 'OFF'}</span></button></div>)}
              </>}
            </div>}
          </div>
        </header>
      )}
      <main style={{ flex: 1, minHeight: 0, background: 'var(--bg)' }}>
        <div key={`${location.pathname}${location.search}`} className="route-transition" style={{ minHeight: "100%" }}>
        <Routes>
          <Route path="/" element={<TrackSelectionScreen />} />
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/manual-payment" element={<ManualPaymentScreen />} />
          <Route path="/orders" element={<OrdersPaymentHistoryScreen />} />
          <Route path="/checkout" element={<BasketScreen />} />
          <Route path="/basket" element={<BasketScreen />} />
          <Route path="/auth/callback" element={<OAuthCallbackScreen />} />
          <Route path="/admin/payments" element={<AdminPaymentsScreen />} />
          <Route path="/tracks" element={<TrackSelectionScreen />} />
          <Route path="/track" element={<TrackHubScreen />} />
          <Route path="/home" element={<HomeScreen />} />
          <Route path="/about" element={<AboutScreen />} />
          <Route path="/terms" element={<TermsScreen />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyScreen />} />
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
          <Route path="/studytime" element={<StudyTimeScreen />} />
          <Route path="/streak" element={<StudyTimeScreen />} />
          <Route path="*" element={<TrackSelectionScreen />} />
        </Routes>
        </div>
      </main>

      {!hideNav && <BottomNav />}
      {resumeSession && <div role="presentation" style={{ position: 'fixed', inset: 0, zIndex: 5000, background: 'rgba(3,8,18,.72)', display: 'grid', placeItems: 'center', padding: 16, boxSizing: 'border-box' }}>
        <section role="dialog" aria-modal="true" aria-labelledby="resume-learning-title" className="card" style={{ width: 'min(100%, 460px)', boxSizing: 'border-box', padding: 24, background: 'var(--bg-card)', color: 'var(--text)', border: '1px solid var(--border)', borderRadius: 14, boxShadow: '0 24px 70px rgba(0,0,0,.4)' }}>
          <h2 id="resume-learning-title" style={{ marginTop: 0 }}>{resumeSession.mode === 'MOCK' ? 'Resume your mock exam?' : resumeSession.mode === 'DRILL' ? 'Resume your drill?' : 'Resume your practice session?'}</h2>
          <p style={{ color: 'var(--text-muted)', lineHeight: 1.5 }}>Hyperion found an unfinished session saved to your account. You can continue where you left off.</p>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-outline" onClick={() => setResumeSession(null)}>NOT NOW</button>
            <button type="button" className="btn btn-primary" onClick={() => {
              const destination = resumeSession.mode === 'MOCK' ? '/mock/exam' : '/practice/quiz'
              setResumeSession(null)
              navigate(destination)
            }}>RESUME SESSION</button>
          </div>
        </section>
      </div>}
      {showPaywall && <PaywallDialog />}
    </div>
  )
}
