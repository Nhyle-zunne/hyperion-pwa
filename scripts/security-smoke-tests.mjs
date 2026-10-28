import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  pricing, checkout, verify, webhook, questionBank, questionBankMigration,
  finalizerMigration, priceCorrectionMigration, functionConfig, app, practiceStore, mockExam, licenseStore, basketScreen, accountScreen,
  indexCss, manualPayment, ordersHistory, historyScreen, studyTimeScreen, trackSelectionScreen, studyTimeStore, progressSync,
  aboutScreen, termsScreen, privacyScreen, topLoadingIndicator, pageLoadingManager,
  questionBankClient, adminLicenses, adminPayments, adminQuestionBank
] = await Promise.all([
  read('../src/lib/supabase.ts'),
  read('../supabase/functions/create-checkout/index.ts'),
  read('../supabase/functions/verify-checkout/index.ts'),
  read('../supabase/functions/paymongo-webhook/index.ts'),
  read('../supabase/functions/question-bank/index.ts'),
  read('../supabase/migrations/20261026142927_secure_question_bank_private_storage.sql'),
  read('../supabase/migrations/20261027095847_finalize_paymongo_checkout_atomically.sql'),
  read('../supabase/migrations/20261027095917_correct_gmdss_monthly_price_in_payment_finalizer.sql'),
  read('../supabase/config.toml'),
  read('../src/App.tsx'),
  read('../src/stores/practiceStore.ts'),
  read('../src/screens/MockExamScreen.tsx'),
  read('../src/stores/licenseStore.ts'),
  read('../src/screens/BasketScreen.tsx'),
  read('../src/screens/AccountScreen.tsx'),
  read('../src/index.css'),
  read('../src/screens/ManualPaymentScreen.tsx'),
  read('../src/screens/OrdersPaymentHistoryScreen.tsx'),
  read('../src/screens/HistoryScreen.tsx'),
  read('../src/screens/StudyTimeScreen.tsx'),
  read('../src/screens/TrackSelectionScreen.tsx'),
  read('../src/stores/studyTimeStore.ts'),
  read('../src/lib/progressSync.ts'),
  read('../src/screens/AboutScreen.tsx'),
  read('../src/screens/TermsScreen.tsx'),
  read('../src/screens/PrivacyPolicyScreen.tsx'),
  read('../src/components/TopLoadingIndicator.tsx'),
  read('../src/lib/pageLoading.ts'),
  read('../src/lib/questionBank.ts'),
  read('../src/screens/AdminLicensesScreen.tsx'),
  read('../src/screens/AdminPaymentsScreen.tsx'),
  read('../src/screens/AdminQuestionBankScreen.tsx')
]);

// A regression test for webhook timestamp parsing: a numeric timestamp must match.
const timestampMatch = webhook.match(/if \(!\/(.+?)\/\.test\(timestamp\)/);
assert.ok(timestampMatch, 'Webhook timestamp-validation regex exists');
assert.equal(new RegExp(timestampMatch[1]).test('1793097458'), true, 'Webhook regex accepts numeric timestamps');
assert.equal(new RegExp(timestampMatch[1]).test('bad-timestamp'), false, 'Webhook regex rejects non-numeric timestamps');

const signatureIndex = webhook.indexOf('const expectedSignature = await hmacHex');
const parseIndex = webhook.indexOf('JSON.parse(raw)');
assert.ok(signatureIndex >= 0 && parseIndex > signatureIndex, 'Webhook verifies the exact raw body before parsing JSON');
assert.ok(webhook.includes("const suppliedSignature = isLive ? parts.li : parts.te"), 'Webhook signature selection follows configured mode');
assert.ok(webhook.includes("Deno.env.get('PAYMONGO_TEST_WEBHOOK_SECRET')") && webhook.includes("Deno.env.get('PAYMONGO_LIVE_WEBHOOK_SECRET')"), 'Webhook supports dedicated test and live signing secrets');
assert.ok(webhook.includes(")?.trim()"), 'Webhook signing secret is whitespace-normalized');
assert.ok(webhook.includes('equalConstantTime(expectedSignature, suppliedSignature)'), 'Webhook uses a constant-time signature comparison');
assert.ok(webhook.includes("Math.abs(Date.now() / 1000 - Number(timestamp)) > 300"), 'Webhook rejects stale signed requests');

const terms = [
  ['oic_nw', 20, 50, 350],
  ['gmdss', 15, 40, 250],
  ['engine_ew', 20, 50, 350],
  ['deck_mgt', 40, 100, 700],
  ['engine_mgt', 40, 100, 700]
];
for (const [code, weekly, monthly, yearly] of terms) {
  assert.ok(
    pricing.includes(`code: '${code}'`) &&
    pricing.includes(`weeklyPrice: ${weekly}, monthlyPrice: ${monthly}, annualPrice: ${yearly}`),
    `Frontend catalogue has the canonical price for ${code}`
  );
  const serverMap = `${code}: { week: ${weekly}, month: ${monthly}, year: ${yearly} }`;
  assert.ok(checkout.includes(serverMap), `Checkout server price for ${code}`);
  assert.ok(verify.includes(serverMap), `Verification server price for ${code}`);
  assert.ok(webhook.includes(serverMap), `Webhook server price for ${code}`);
  assert.ok(finalizerMigration.includes(`when '${code}' then case v_order.license_term`), `Database finalizer covers ${code}`);
}

assert.match(questionBankMigration, /values\s*\('question-banks',\s*'question-banks',\s*false/i, 'Question bank bucket is private');
assert.match(questionBank, /\.auth\.getUser\(\)/, 'Question-bank endpoint validates authenticated users');
assert.match(questionBank, /FREE_FINGERPRINT_CACHE_TTL_MS/, 'Free-question authorization fingerprints expire or invalidate');
assert.match(finalizerMigration, /search_path|SECURITY DEFINER/i, 'Finalizer migration defines a database function');
assert.match(finalizerMigration, /service_role/i, 'Finalizer migration restricts execution to the service role');
assert.match(priceCorrectionMigration, /month.*then 40/i, 'GMDSS monthly price correction is tracked in a separate migration');
assert.match(functionConfig, /\[functions\.paymongo-webhook\]\s*verify_jwt = false/, 'Webhook uses provider signature verification, not Supabase user JWT');
assert.match(functionConfig, /\[functions\.question-bank\]\s*verify_jwt = false/, 'Question bank performs application-level authorization');
assert.match(functionConfig, /\[functions\.create-checkout\]\s*verify_jwt = true/, 'Checkout requires an authenticated Hyperion session');
assert.ok(checkout.includes("body.action === 'status'"), 'Checkout endpoint exposes only a non-secret availability status action');
assert.ok(checkout.includes("const enabled = checkoutEnabled && Boolean(serviceKey) && keyMatchesMode"), 'Checkout status fails closed unless enabled and correctly configured');
assert.ok(basketScreen.includes("body: { action: 'status' }"), 'Basket loads checkout availability from the server');
assert.ok(basketScreen.includes('paymongoCheckoutEnabled !== true'), 'Checkout handler fails closed until server availability is confirmed');
assert.ok(basketScreen.includes('paymongoCheckoutEnabled === true ? <button'), 'PayMongo button is only rendered when the server says checkout is enabled');
assert.ok(basketScreen.includes('showManualPaymentFallback'), 'Basket exposes manual payment fallback when checkout is disabled');

assert.match(accountScreen, /queryParams:\s*\{\s*prompt:\s*'select_account'/, 'Google OAuth always prompts the user to choose an account');
assert.ok(accountScreen.includes('setDeletionSuccess(true)'), 'Successful account deletion opens a visible success dialog');
assert.ok(accountScreen.includes('data?.success !== true'), 'Deletion success dialog is gated on explicit server confirmation');
assert.ok(accountScreen.includes('Account deletion successful') && accountScreen.includes('aria-modal="true"'), 'Account deletion success is announced in an accessible modal');
assert.ok(accountScreen.includes('You can now sign in again and choose any Google account.'), 'Deletion confirmation tells users they can choose a different Google account');
assert.ok(accountScreen.includes('setSignedOutSuccess(true)'), 'Successful sign-out opens a visible confirmation dialog');
assert.ok(accountScreen.includes('Signed out successfully') && accountScreen.includes('aria-labelledby="sign-out-success-title"'), 'Sign-out confirmation is accessible and explicit');
assert.ok(accountScreen.includes('hyperion-success-card-enter') && accountScreen.includes('hyperion-success-card-exit'), 'Success dialogs animate in and out smoothly');
assert.ok(accountScreen.includes('account-success-backdrop--closing') && accountScreen.includes('onClick={closeSuccessModal}'), 'Continue triggers the animated dismissal for sign-out and account deletion');
assert.ok(accountScreen.includes('keepSuccessBackdropRef.current') && accountScreen.includes('if (nextSession || !keepSuccessBackdropRef.current)'), 'The page the user signed out from remains mounted behind the success dialog');
assert.ok(accountScreen.includes("navigate('/account', { replace: true })"), 'Dismissing sign-out or deletion success returns the user to the Accounts page');
assert.ok(accountScreen.includes('backdrop-filter:blur(12px)') && accountScreen.includes('radial-gradient(ellipse at 50% 36%'), 'Success dialogs use the polished blurred navy backdrop');
assert.ok(accountScreen.includes('prefers-reduced-motion:reduce'), 'Success dialog animations respect reduced-motion preferences');
assert.ok(accountScreen.includes('Unable to sign out. Please check your connection and try again.'), 'Sign-out errors are not reported as successful');
assert.ok(!['#c9a44c', '#f5c75e', 'rgba(245,199,94,.28)', '#a47e2e', '#946c12', '#dfc277'].some(color => accountScreen.toLowerCase().includes(color)), 'Account UI does not reintroduce gold brand accents');
assert.ok(!manualPayment.includes('#a47e2e') && !manualPayment.includes('#d6a33a'), 'Manual-payment UI does not use gold accents');
assert.ok(!ordersHistory.includes('#9a6b07') && !ordersHistory.includes('#e8c875'), 'Pending payment status uses neutral styling instead of gold');
assert.ok(historyScreen.includes("borderLeft: '4px solid var(--accent)'") && !historyScreen.includes("#f59e0b"), 'Study streak uses Hyperion green instead of gold');
assert.ok(studyTimeScreen.includes("'#3b82f6'") && !studyTimeScreen.includes("#f59e0b"), 'Study-time chart palette avoids gold accents');
assert.ok(indexCss.includes('--warning: #fb923c;') && indexCss.includes('--warning: #c2410c;'), 'Warnings use orange tones, not amber-gold');
assert.ok(trackSelectionScreen.includes('const firstVisibleDay = displayedStreakCount > 7 ? displayedStreakCount - 6 : 1') && trackSelectionScreen.includes('addDaysToKey(displayStartDate, dayNumber - 1)'), 'Streak days are numbered from the true start date, displaying the current seven-day window after Day 7');
assert.ok(trackSelectionScreen.includes('DAILY CHECK-IN STREAK') && trackSelectionScreen.includes('TODAY · ${formattedDate}'), 'Dashboard identifies a daily app-open check-in streak and marks today clearly');
assert.ok(trackSelectionScreen.includes('className="daily-streak-grid"') && trackSelectionScreen.includes('className="daily-streak-status"'), 'Dashboard streak uses dedicated responsive styling for large labels and status indicators');
assert.ok(indexCss.includes('.daily-streak-status') && indexCss.includes('font-size: clamp(2rem, 3.1vw, 3.1rem)') && indexCss.includes('@media (max-width: 599px)'), 'Streak labels and checkmarks scale up on desktop and remain responsive on mobile');
assert.ok(studyTimeStore.includes('recordDailyCheckIn') && studyTimeStore.includes('current.dailyCheckInLastDate === previousDayKey(today)'), 'Daily check-ins advance once per day and reset after a missed calendar day');
assert.ok(studyTimeStore.includes('dailyCheckInStartDate') && studyTimeStore.includes('dailyCheckInLastDate') && studyTimeStore.includes('dailyCheckInCount'), 'Daily check-in start date and consecutive count persist in the study-time store');
assert.ok(app.includes('hyperion:learning-progress-ready') && app.includes('recordDailyCheckIn()') && app.includes("addEventListener('visibilitychange', handleResume)"), 'App open and resume record daily check-ins after account progress hydration');
assert.ok(progressSync.includes('mergeDailyCheckIn(ls, rs)') && progressSync.includes("new Event('hyperion:learning-progress-ready')"), 'Daily check-in state merges across devices and initializes when cloud restore is unavailable');
assert.ok(progressSync.includes("dailyCheckInStartDate: '', dailyCheckInLastDate: '', dailyCheckInCount: 0"), 'Account switching clears the previous account check-in streak');
assert.ok(aboutScreen.includes('Google Play subscriptions:') && aboutScreen.includes('Website/PWA licenses:'), 'About page explicitly explains both platform license types');
assert.ok(aboutScreen.includes('same email address') && aboutScreen.includes('cannot be transferred or combined automatically'), 'About page warns that licenses are not merged by email');
assert.ok(termsScreen.includes('3.1 Google Play subscriptions (Android app)') && termsScreen.includes('3.2 Website/PWA licenses (hyperionmaritime.org)'), 'Terms distinguish Play subscriptions from website fixed-term licenses');
assert.ok(termsScreen.includes('does not automatically unlock a website/PWA license') && termsScreen.includes('do not automatically renew'), 'Terms explain cross-platform separation and website non-renewal');
assert.ok(termsScreen.includes('play.google.com/store/account/subscriptions') && termsScreen.includes('does not cancel a Google Play subscription'), 'Terms provide the correct Play subscription management path and cancellation separation');
assert.ok(termsScreen.includes('October 27, 2026'), 'Terms updated date matches the latest substantive revision');
assert.ok(privacyScreen.includes('Firebase Analytics') && privacyScreen.includes('PayMongo') && privacyScreen.includes('daily app-open check-in streak'), 'Privacy policy describes current analytics, payment, and synced progress handling');
assert.ok(privacyScreen.includes('does not cancel a Google Play subscription') && privacyScreen.includes('A website/PWA license and Google Play subscription are independent'), 'Privacy policy explains separate license and deletion effects');
assert.ok(privacyScreen.includes('href="/account?tab=delete"') && !privacyScreen.includes('hyperionmaritime.org/delete-account'), 'Privacy policy links to the real in-app website account-deletion route');
assert.ok(privacyScreen.includes('October 27, 2026'), 'Privacy policy updated date matches the latest substantive revision');
assert.ok(app.includes("import TopLoadingIndicator from './components/TopLoadingIndicator'") && app.includes('<TopLoadingIndicator />'), 'Global top loader is mounted for every app route');
assert.ok(app.includes("withPageLoading('Checking licenses and access'") && app.includes('void refresh(true)'), 'Initial entitlement checks keep the top loader active until access state is hydrated');
assert.ok(topLoadingIndicator.includes('location.pathname') && topLoadingIndicator.includes('location.search') && topLoadingIndicator.includes('ROUTE_TRANSITION_MS = 480'), 'Top loader activates on page and query-string navigation');
assert.ok(topLoadingIndicator.includes('src="/logo.png?v=2"') && topLoadingIndicator.includes('hyperion-top-loader__logo'), 'Top loader uses the existing Hyperion logo as its animated symbol');
assert.ok(indexCss.includes('.hyperion-top-loader__progress') && indexCss.includes('@keyframes hyperion-loader-sweep') && indexCss.includes('@keyframes hyperion-loader-ripple'), 'Top loader has animated progress and MARINA-style expanding rings');
assert.ok(indexCss.includes('width: 86px;') && indexCss.includes('height: 86px;') && indexCss.includes('@keyframes hyperion-loader-logo-breathe'), 'Top loading logo is substantially enlarged and gently pulsing');
assert.ok(topLoadingIndicator.includes('hyperion-top-loader__pulse--one') && topLoadingIndicator.includes('hyperion-top-loader__pulse--two') && topLoadingIndicator.includes('hyperion-top-loader__pulse--three'), 'Three staggered expanding pulses surround the Hyperion logo');
assert.ok(indexCss.includes('prefers-reduced-motion: reduce') && indexCss.includes('.hyperion-top-loader__logo'), 'Top loader supports reduced-motion preferences');
assert.ok(pageLoadingManager.includes('window.setTimeout(finish, 45_000)') && pageLoadingManager.includes('finally {\n    finish()'), 'Async loading tasks always release the indicator and have a watchdog');
assert.ok(questionBankClient.includes("withPageLoading('Loading questions'") && questionBankClient.includes("withPageLoading('Loading question counts'") && questionBankClient.includes("withPageLoading('Loading question bank'"), 'Question fetching and question-count requests keep the global indicator active');
assert.ok(questionBankClient.includes("withPageLoading('Downloading question pack'") && questionBankClient.includes("withPageLoading('Loading flashcards'"), 'Long content-pack and flashcard loads use the global indicator');
assert.ok(accountScreen.includes("withPageLoading('Loading account and licenses'") && accountScreen.includes("withPageLoading('Signing out'") && accountScreen.includes("withPageLoading('Deleting account'"), 'Account and account-security operations keep the indicator active while requests complete');
assert.ok(basketScreen.includes("withPageLoading('Loading checkout and licenses'") && basketScreen.includes("withPageLoading('Preparing secure checkout'") && basketScreen.includes("withPageLoading('Verifying payment status'") || basketScreen.includes("withPageLoading('Refreshing payment status'"), 'Checkout reads and PayMongo operations display the indicator');
assert.ok(manualPayment.includes("withPageLoading('Loading payment details'") && manualPayment.includes("withPageLoading('Submitting payment for review'"), 'Manual payment lookup and submission display the indicator');
assert.ok(ordersHistory.includes("withPageLoading('Loading orders and payment history'") && ordersHistory.includes("withPageLoading('Verifying payment status'"), 'Order history and payment reconciliation display the indicator');
assert.ok(adminLicenses.includes("withPageLoading('Loading license administration'") && adminPayments.includes("withPageLoading('Loading payment submissions'") && adminQuestionBank.includes("withPageLoading('Loading question-bank inventory'"), 'Admin data loading uses the shared indicator');
assert.ok(trackSelectionScreen.includes('const [examPanelExpanded, setExamPanelExpanded] = useState(false)'), 'Dashboard exam and streak dropdown starts collapsed to save space');
assert.ok(trackSelectionScreen.includes('aria-expanded={examPanelExpanded}') && trackSelectionScreen.includes('aria-controls="dashboard-exam-details"'), 'Dashboard dropdown exposes its expanded state accessibly');
assert.ok(trackSelectionScreen.includes('aria-hidden={!examPanelExpanded}') && trackSelectionScreen.includes('ref={examDetailsRef}') && trackSelectionScreen.includes('examDetailsRef.current.inert = !examPanelExpanded') && trackSelectionScreen.includes("' is-expanded'"), 'Dropdown details transition smoothly and use native DOM inert state while collapsed');
assert.ok(trackSelectionScreen.includes('className="dashboard-exam-panel__streak">{streakStatus}</span>') && trackSelectionScreen.includes('MARINA LICENSURE EXAM'), 'Collapsed dropdown keeps exam target and streak summary visible');
assert.ok(trackSelectionScreen.includes('dashboard-exam-panel__date-input') && trackSelectionScreen.includes('onClick={saveTarget}'), 'Target date picker remains accessible within expanded dropdown');
assert.ok(indexCss.includes('.dashboard-exam-panel__toggle') && indexCss.includes('.dashboard-exam-panel__streak') && indexCss.includes('@media (max-width: 599px)'), 'Dropdown summary uses compact responsive styling');
assert.ok(indexCss.includes('max-height 420ms cubic-bezier(.2,.75,.25,1)') && indexCss.includes('opacity 260ms ease 35ms') && indexCss.includes('transform 300ms cubic-bezier(.2,.75,.25,1)'), 'Dropdown opening and closing animate height, opacity, and vertical movement');
assert.ok(trackSelectionScreen.includes('<svg viewBox="0 0 24 24"') && trackSelectionScreen.includes('strokeLinecap="round"') && trackSelectionScreen.includes('strokeLinejoin="round"'), 'Dashboard dropdown uses a polished round-capped SVG chevron');
assert.ok(indexCss.includes('.dashboard-exam-panel__chevron.is-open') && indexCss.includes('transform: rotate(180deg)'), 'Chevron rotates smoothly to reflect expanded state');
assert.ok(indexCss.includes('visibility 0s linear 380ms') && indexCss.includes('pointer-events: none') && indexCss.includes('prefers-reduced-motion: reduce'), 'Closing animation hides details accessibly and respects reduced-motion settings');

for (const route of [
  '/account', '/checkout', '/manual-payment', '/orders', '/admin/licenses',
  '/admin/payments', '/admin/questions', '/practice/competences', '/practice',
  '/practice/quiz', '/drill', '/quick-scan', '/quick-scan/view', '/mock',
  '/mock/exam', '/history', '/flashcards', '/bookmarks', '/studytime'
]) {
  assert.ok(app.includes(`path="${route}"`), `App route exists: ${route}`);
}
assert.ok(practiceStore.includes('useHistoryStore.getState().saveSession'), 'Practice session saves History metadata');
assert.ok(practiceStore.includes('await saveSessionSnapshot(snapshot.sessionId, snapshot)'), 'Practice session snapshot is persisted');
assert.ok(practiceStore.includes('authorizeQuestionSetAccess(snapshot.track, snapshot.questions)'), 'Restoring saved questions rechecks authorization');
assert.ok(mockExam.includes('SUBMIT EXAM'), 'Mock exam requires explicit submission');
assert.ok(mockExam.includes("window.addEventListener('beforeunload', blockExit)"), 'Mock exam guards accidental exit');
assert.ok(licenseStore.includes('canUseOfflineEntitlementsAfterError'), 'Offline entitlement fallback is constrained to offline/server outage scenarios');

console.log('Release-safety smoke checks passed.');
