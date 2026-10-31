import { lazy, Suspense, useEffect, useRef, useState } from 'react'
import { useLicenseStore } from './stores/licenseStore'
import { Routes, Route, useLocation, useNavigate } from 'react-router-dom'
import InstallPrompt from './components/InstallPrompt'
import RouteErrorBoundary from './components/RouteErrorBoundary'
import PaywallDialog from './components/PaywallDialog'
import BottomNav from './components/BottomNav'
import TopLoadingIndicator from './components/TopLoadingIndicator'
import { useUIStore } from './stores/uiStore'
import { usePracticeStore } from './stores/practiceStore'
import { useBookmarksStore } from './stores/bookmarksStore'
import { useVaultStore } from './stores/vaultStore'
import { useHistoryStore } from './stores/historyStore'
import { supabase } from './lib/supabase'
import { startLearningProgressSync } from './lib/progressSync'
import { useStudyTimeStore } from './stores/studyTimeStore'
import { withPageLoading } from './lib/pageLoading'
import { clearPaidQuestionCache } from './lib/questionBank'
import { deletePaidQuestionSnapshotsForTrack } from './lib/sessionArchive'
import { deletePaidOfflineQuestionPacksForTrack } from './lib/offlineQuestionCache'

const HomeScreen = lazy(() => import('./screens/HomeScreen'))
const TrackSelectionScreen = lazy(() => import('./screens/TrackSelectionScreen'))
const AccountScreen = lazy(() => import('./screens/AccountScreen'))
const BasketScreen = lazy(() => import('./screens/BasketScreen'))
const ManualPaymentScreen = lazy(() => import('./screens/ManualPaymentScreen'))
const OrdersPaymentHistoryScreen = lazy(() => import('./screens/OrdersPaymentHistoryScreen'))
const OAuthCallbackScreen = lazy(() => import('./screens/OAuthCallbackScreen'))
const AdminPaymentsScreen = lazy(() => import('./screens/AdminPaymentsScreen'))
const AdminLicensesScreen = lazy(() => import('./screens/AdminLicensesScreen'))
const AdminQuestionBankScreen = lazy(() => import('./screens/AdminQuestionBankScreen'))
const TrackHubScreen = lazy(() => import('./screens/TrackHubScreen'))
const AboutScreen = lazy(() => import('./screens/AboutScreen'))
const TermsScreen = lazy(() => import('./screens/TermsScreen'))
const PrivacyPolicyScreen = lazy(() => import('./screens/PrivacyPolicyScreen'))
const PracticeConfigScreen = lazy(() => import('./screens/PracticeConfigScreen'))
const PracticeCompetenceScreen = lazy(() => import('./screens/PracticeCompetenceScreen'))
const PracticeQuizScreen = lazy(() => import('./screens/PracticeQuizScreen'))
const DrillScreen = lazy(() => import('./screens/DrillScreen'))
const QuickScanCompetenceScreen = lazy(() => import('./screens/QuickScanCompetenceScreen'))
const QuickScanViewerScreen = lazy(() => import('./screens/QuickScanViewerScreen'))
const MockExamScreen = lazy(() => import('./screens/MockExamScreen'))
const MockExamRunner = lazy(() => import('./screens/MockExamScreen').then((module) => ({ default: module.MockExamRunner })))
const HistoryScreen = lazy(() => import('./screens/HistoryScreen'))
const FlashcardsScreen = lazy(() => import('./screens/FlashcardsScreen'))
const BookmarksScreen = lazy(() => import('./screens/BookmarksScreen'))
const VaultScreen = lazy(() => import('./screens/VaultScreen'))
const SearchScreen = lazy(() => import('./screens/SearchScreen'))
const StudyTimeScreen = lazy(() => import('./screens/StudyTimeScreen'))
const IOSInstallGuideScreen = lazy(() => import('./screens/IOSInstallGuideScreen'))

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
  const [isOnline, setIsOnline] = useState(() => typeof navigator === 'undefined' ? true : navigator.onLine)
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
  const lastCloudTrackIds = useRef<string[]>([])
  useEffect(() => {
    let alive = true
    let lastRefreshAt = 0
    let refreshInFlight: Promise<void> | null = null
    let forcedRefreshQueued = false
    const minimumRefreshIntervalMs = 2 * 60 * 1000

    const refresh = async (showLoadingIndicator = false, force = false) => {
      // Focus and visibility events often fire together. Share one request and avoid
      // repeatedly querying entitlements while the app is already active.
      if (refreshInFlight) {
        // If the signed-in account changes during a request, run one fresh check
        // after the current request finishes so an old account cannot win the race.
        if (force) forcedRefreshQueued = true
        return refreshInFlight
      }
      if (!force && Date.now() - lastRefreshAt < minimumRefreshIntervalMs) return

      const task = (async () => {
        try {
          if (showLoadingIndicator) {
            await withPageLoading('Checking licenses and access', () => refreshCloudEntitlements())
          } else {
            await refreshCloudEntitlements()
          }
          if (alive) setEntitlementsChecked(true)
        } finally {
          lastRefreshAt = Date.now()
        }
      })()
      refreshInFlight = task
      try {
        await task
      } finally {
        if (refreshInFlight === task) refreshInFlight = null
        if (forcedRefreshQueued && alive) {
          forcedRefreshQueued = false
          void refresh(false, true)
        }
      }
    }

    void refresh(true, true)
    const authListener = supabase?.auth.onAuthStateChange(() => {
      clearPaidQuestionCache()
      setEntitlementsChecked(false)
      window.setTimeout(() => { void refresh(false, true) }, 0)
    })
    const refreshOnWake = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    // A two-minute safety refresh still detects server-side revocations during a
    // continuously open session without the previous 30-second request churn.
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, minimumRefreshIntervalMs)
    window.addEventListener('focus', refreshOnWake)
    document.addEventListener('visibilitychange', refreshOnWake)
    window.addEventListener('online', refreshOnWake)
    return () => {
      alive = false
      window.clearInterval(interval)
      window.removeEventListener('focus', refreshOnWake)
      document.removeEventListener('visibilitychange', refreshOnWake)
      window.removeEventListener('online', refreshOnWake)
      authListener?.data.subscription.unsubscribe()
    }
  }, [refreshCloudEntitlements])

  useEffect(() => startLearningProgressSync(), [])

  useEffect(() => {
    const updateConnectionState = () => setIsOnline(navigator.onLine)
    window.addEventListener('online', updateConnectionState)
    window.addEventListener('offline', updateConnectionState)
    return () => {
      window.removeEventListener('online', updateConnectionState)
      window.removeEventListener('offline', updateConnectionState)
    }
  }, [])

  useEffect(() => {
    const client = supabase
    if (!client) return
    let active = true
    let inFlight = false

    const recordActivity = async () => {
      if (!active || inFlight || document.visibilityState !== 'visible') return
      try {
        const { data: { session } } = await client.auth.getSession()
        const userId = session?.user?.id
        if (!userId || !active) return
        const storageKey = `hyperion:last-website-activity:${userId}`
        const lastAttempt = Number(sessionStorage.getItem(storageKey) || 0)
        if (Date.now() - lastAttempt < 15 * 60 * 1000) return

        inFlight = true
        const { error } = await client.functions.invoke('record-user-activity')
        if (!error && active) sessionStorage.setItem(storageKey, String(Date.now()))
      } catch {
        // Tracking is best effort and must never prevent a page from loading.
      } finally {
        inFlight = false
      }
    }

    void recordActivity()
    const onResume = () => { void recordActivity() }
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onResume)
    document.addEventListener('visibilitychange', onResume)
    const authListener = client.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_IN' || event === 'USER_UPDATED' || event === 'TOKEN_REFRESHED') {
        window.setTimeout(() => { void recordActivity() }, 0)
      }
    })

    return () => {
      active = false
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onResume)
      document.removeEventListener('visibilitychange', onResume)
      authListener.data.subscription.unsubscribe()
    }
  }, [location.pathname, location.search])


  useEffect(() => {
    let alive = true
    let sessionKnown = false
    let hasSession = false
    let progressReady = false
    let initialCheckInRecorded = false
    let fallbackTimer: number | undefined

    const recordInitialCheckIn = () => {
      if (!alive || initialCheckInRecorded) return
      initialCheckInRecorded = true
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
      useStudyTimeStore.getState().recordDailyCheckIn()
    }

    const reconcileInitialCheckIn = () => {
      if (!sessionKnown) return
      if (!hasSession || progressReady) {
        recordInitialCheckIn()
        return
      }
      if (fallbackTimer === undefined) {
        // Keep the app usable offline, but allow cloud progress to hydrate first when possible.
        fallbackTimer = window.setTimeout(recordInitialCheckIn, 12_000)
      }
    }

    const handleProgressReady = () => {
      progressReady = true
      reconcileInitialCheckIn()
      // A newly signed-in account may have been hydrated after an anonymous/local check-in.
      if (initialCheckInRecorded) useStudyTimeStore.getState().recordDailyCheckIn()
    }

    const handleAuthChange = (_event: string, session: { user?: { id: string } } | null) => {
      sessionKnown = true
      hasSession = Boolean(session?.user)
      if (!hasSession) {
        progressReady = true
        if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
        fallbackTimer = undefined
      }
      reconcileInitialCheckIn()
    }

    const handleResume = () => {
      if (initialCheckInRecorded && document.visibilityState === 'visible') {
        useStudyTimeStore.getState().recordDailyCheckIn()
      }
    }

    window.addEventListener('hyperion:learning-progress-ready', handleProgressReady)
    window.addEventListener('focus', handleResume)
    document.addEventListener('visibilitychange', handleResume)
    const authListener = supabase?.auth.onAuthStateChange(handleAuthChange)

    if (!supabase) {
      sessionKnown = true
      progressReady = true
      reconcileInitialCheckIn()
    } else {
      void supabase.auth.getSession().then(({ data }) => {
        if (!alive) return
        sessionKnown = true
        hasSession = Boolean(data.session?.user)
        if (!hasSession) progressReady = true
        reconcileInitialCheckIn()
      }).catch(() => {
        if (!alive) return
        sessionKnown = true
        hasSession = false
        progressReady = true
        reconcileInitialCheckIn()
      })
    }

    return () => {
      alive = false
      if (fallbackTimer !== undefined) window.clearTimeout(fallbackTimer)
      authListener?.data.subscription.unsubscribe()
      window.removeEventListener('hyperion:learning-progress-ready', handleProgressReady)
      window.removeEventListener('focus', handleResume)
      document.removeEventListener('visibilitychange', handleResume)
    }
  }, [])


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
  const currentMode = usePracticeStore((s) => s.mode)
  const isQuickScanViewer = location.pathname === '/quick-scan/view'
  const isFlashcards = location.pathname === '/flashcards'
  const quickScanKeys: Record<string, string> = { oic_nw: 'DECK_OIC_NW', gmdss: 'GMDSS_GOC', engine_ew: 'ENGINE_OIC_EW', deck_mgt: 'DECK_MGT', engine_mgt: 'ENGINE_MGT' }
  const quickScanTrack = isQuickScanViewer ? quickScanKeys[new URLSearchParams(location.search).get('track') || 'oic_nw'] || 'DECK_OIC_NW' : null
  const flashcardTrack = isFlashcards ? quickScanKeys[new URLSearchParams(location.search).get('track') || 'oic_nw'] || 'DECK_OIC_NW' : null
  const guardedTrack = isQuestionRunner ? currentTrack : quickScanTrack ?? flashcardTrack

  useEffect(() => {
    const hadTrackAccessRemoved = lastCloudTrackIds.current.some(trackId => !cloudTrackIds.includes(trackId))
    if (hadTrackAccessRemoved || !entitlementsVerified) clearPaidQuestionCache()
    lastCloudTrackIds.current = cloudTrackIds
  }, [cloudTrackIds, entitlementsVerified])
  useEffect(() => {
    if (!entitlementsVerified) return
    const tracks = ['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'] as const
    const unavailable = isAllAccessUnlocked ? [] : tracks.filter(track => !cloudTrackIds.includes(track))
    for (const track of unavailable) {
      useBookmarksStore.getState().purgePaidForTracks([track])
      useVaultStore.getState().purgePaidForTracks([track])
      useHistoryStore.getState().removePaidSavedSessionsForTrack(track)
      void deletePaidQuestionSnapshotsForTrack(track).catch(() => undefined)
      void deletePaidOfflineQuestionPacksForTrack(track).catch(() => undefined)
      try {
        const raw = localStorage.getItem('hyperion-saved-practice')
        if (raw) {
          const saved = JSON.parse(raw) as { track?: string; isFreeSession?: boolean }
          if (saved.track === track && saved.isFreeSession !== true) localStorage.removeItem('hyperion-saved-practice')
        }
      } catch { /* Local storage may be unavailable or contain old data. */ }
    }
  }, [cloudTrackIds, entitlementsVerified, isAllAccessUnlocked])

  useEffect(() => {
    if (!entitlementsChecked || (!isQuestionRunner && !isQuickScanViewer && !isFlashcards) || !guardedTrack) return
    if (isQuestionRunner && (sessionLoading || sessionQuestionCount === 0)) return
    const allowed = entitlementsVerified && (isAllAccessUnlocked || cloudTrackIds.includes('ALL') || cloudTrackIds.includes(guardedTrack))
    if (allowed) return
    const isPermittedFreeRunner = isFreeSession && (
      (isMockRunner && currentMode === 'MOCK') ||
      (isPracticeQuiz && (currentMode === 'PRACTICE' || currentMode === 'DRILL'))
    )
    if (isQuestionRunner && isPermittedFreeRunner) return
    const trackParam: Record<string, string> = {
      DECK_OIC_NW: 'oic_nw', GMDSS_GOC: 'gmdss', ENGINE_OIC_EW: 'engine_ew',
      DECK_MGT: 'deck_mgt', ENGINE_MGT: 'engine_mgt'
    }
    clearPaidQuestionCache()
    if (isQuestionRunner) usePracticeStore.getState().reset()
    navigate('/track?track=' + (trackParam[guardedTrack] || 'oic_nw'), { replace: true })
    useUIStore.getState().openPaywall('This paid question view needs a current, verified license. Renew access or reconnect to check your subscription.')
  }, [entitlementsChecked, entitlementsVerified, cloudTrackIds, isAllAccessUnlocked, isQuestionRunner, isQuickScanViewer, isFlashcards, guardedTrack, isFreeSession, currentMode, sessionLoading, sessionQuestionCount, navigate])

  // Free Reviewer is the only non-mock practice setup available without a license.
  // Direct URLs must obey the same access rule as the track-hub buttons.
  const isPracticeSetup = location.pathname === '/practice/competences' || location.pathname === '/practice'
  const setupParams = new URLSearchParams(location.search)
  const setupTrackKeyRaw = setupParams.get('track') || 'oic_nw'
  const setupTrackKey = quickScanKeys[setupTrackKeyRaw] ? setupTrackKeyRaw : 'oic_nw'
  const setupTrack = quickScanKeys[setupTrackKey]
  const setupMode = setupParams.get('mode') || ''
  const isExplicitFreeReviewerSetup = setupParams.get('free') === '1' && setupMode !== 'drill'
  const setupNeedsLicense = isPracticeSetup && !isExplicitFreeReviewerSetup

  useEffect(() => {
    if (!entitlementsChecked || !setupNeedsLicense) return
    const hasActiveLicense = entitlementsVerified && (
      isAllAccessUnlocked || cloudTrackIds.includes('ALL') ||
      (setupTrack != null && cloudTrackIds.includes(setupTrack))
    )
    if (hasActiveLicense) return

    navigate('/track?track=' + setupTrackKey, { replace: true })
    useUIStore.getState().openPaywall(
      setupMode === 'drill'
        ? 'Drill requires an active license for this track.'
        : 'Practice All Questions requires an active license. Free Reviewer and Timed Mock Exam remain available without a purchase.'
    )
  }, [entitlementsChecked, entitlementsVerified, cloudTrackIds, isAllAccessUnlocked, isPracticeSetup, setupNeedsLicense, setupTrack, setupTrackKey, setupMode, navigate])

  const hideNav = [
    '/practice/quiz',
    '/mock/exam',
    '/auth/callback'
  ].some((p) => location.pathname.startsWith(p))

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <TopLoadingIndicator />
      {!isOnline && (
        <div
          role="status"
          aria-live="polite"
          style={{
            padding: '0.45rem 1rem',
            textAlign: 'center',
            borderBottom: '1px solid var(--border)',
            background: 'var(--bg-card)',
            color: 'var(--warning, #b45309)',
            fontSize: '0.78rem',
            lineHeight: 1.45
          }}
        >
          <strong>OFFLINE MODE</strong>
          {' · '}Only downloaded question packs and saved sessions are available. New sign-ins, checkout, license changes, and cloud sync need an internet connection.
        </div>
      )}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, position: 'relative' }}>
            <button
              type="button"
              onClick={() => { if (q) toggleBookmark(q, !isFreeSession) }}
              aria-label={bookmarked ? 'Remove bookmark' : 'Bookmark question'}
              aria-pressed={bookmarked}
              title={bookmarked ? 'Bookmarked' : 'Bookmark question'}
              style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, border: 0, borderRadius: 8, background: 'transparent', color: bookmarked ? 'var(--accent)' : 'var(--text)', padding: 8, cursor: 'pointer' }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="25" height="25" fill={bookmarked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.85" strokeLinecap="round" strokeLinejoin="round">
                <path d="M6.75 4.25A1.75 1.75 0 0 1 8.5 2.5h7A1.75 1.75 0 0 1 17.25 4.25V21l-5.25-3.6L6.75 21V4.25Z" />
              </svg>
            </button>
            <button
              type="button"
              onClick={() => setSettingsOpen(v => !v)}
              aria-label="Question settings"
              aria-expanded={settingsOpen}
              title="Question settings"
              style={{ display: 'grid', placeItems: 'center', width: 44, height: 44, border: 0, borderRadius: 8, background: 'transparent', color: 'var(--text)', padding: 8, cursor: 'pointer' }}
            >
              <svg aria-hidden="true" viewBox="0 0 24 24" width="27" height="27" fill="currentColor">
                <path d="M19.14 12.94c.04-.31.06-.62.06-.94s-.02-.63-.07-.94l2.03-1.58a.5.5 0 0 0 .12-.61l-1.92-3.32a.5.5 0 0 0-.58-.2l-2.39.96a7.3 7.3 0 0 0-1.63-.94l-.36-2.52a.49.49 0 0 0-.49-.4h-3.82a.49.49 0 0 0-.49.4L9.24 5.37c-.59.24-1.13.56-1.63.94L5.22 5.35a.5.5 0 0 0-.58.2L2.72 8.87a.5.5 0 0 0 .12.61l2.03 1.58c-.05.31-.07.63-.07.94s.02.63.07.94l-2.03 1.58a.5.5 0 0 0-.12.61l1.92 3.32a.5.5 0 0 0 .58.2l2.39-.96c.5.38 1.04.7 1.63.94l.36 2.52a.49.49 0 0 0 .49.4h3.82a.49.49 0 0 0 .49-.4l.36-2.52c.59-.24 1.13-.56 1.63-.94l2.39.96a.5.5 0 0 0 .58-.2l1.92-3.32a.5.5 0 0 0-.12-.61l-2.03-1.58ZM12 15.5a3.5 3.5 0 1 1 0-7 3.5 3.5 0 0 1 0 7Z" />
              </svg>
            </button>
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
        <RouteErrorBoundary>
        <Suspense fallback={<div role="status" aria-live="polite" style={{ minHeight: 220, display: 'grid', placeItems: 'center', color: 'var(--text-muted)' }}>Loading Hyperion…</div>}>
        <Routes>
          <Route path="/" element={<><InstallPrompt variant="modal" iosOnly /><TrackSelectionScreen /></>} />
          <Route path="/account" element={<AccountScreen />} />
          <Route path="/manual-payment" element={<ManualPaymentScreen />} />
          <Route path="/orders" element={<OrdersPaymentHistoryScreen />} />
          <Route path="/checkout" element={<BasketScreen />} />
          <Route path="/basket" element={<BasketScreen />} />
          <Route path="/auth/callback" element={<OAuthCallbackScreen />} />
          <Route path="/admin/licenses" element={<AdminLicensesScreen />} />
          <Route path="/admin/payments" element={<AdminPaymentsScreen />} />
          <Route path="/admin/questions" element={<AdminQuestionBankScreen />} />
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
          <Route path="/vault" element={<VaultScreen />} />
          <Route path="/search" element={<SearchScreen />} />
          <Route path="/studytime" element={<StudyTimeScreen />} />
          <Route path="/install/ios" element={<IOSInstallGuideScreen />} />
          <Route path="/streak" element={<StudyTimeScreen />} />
          <Route path="*" element={<TrackSelectionScreen />} />
        </Routes>
        </Suspense>
        </RouteErrorBoundary>
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
