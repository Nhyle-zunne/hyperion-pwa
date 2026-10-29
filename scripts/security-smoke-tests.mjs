import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { nextExpiryRefreshDelay, MAX_EXPIRY_REFRESH_TIMEOUT_MS } from '../src/lib/entitlementExpiryScheduler.mjs';
import { encryptJsonPayload, decryptJsonPayload } from '../src/lib/jsonPayloadCrypto.mjs';
import { fingerprintQuestion } from '../src/lib/questionFingerprint.mjs';
import { isGmdssFreeSampleQuestion, isOfflinePackSetComplete } from '../src/lib/offlinePackIntegrity.mjs';
import { createSerialAsyncQueue } from '../src/lib/serializedAsyncQueue.mjs';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  pricing, checkout, verify, webhook, questionBank, questionBankMigration,
  finalizerMigration, priceCorrectionMigration, functionConfig, app, practiceStore, mockExam, licenseStore, basketScreen, accountScreen,
  indexCss, manualPayment, ordersHistory, historyScreen, studyTimeScreen, trackSelectionScreen, studyTimeStore, progressSync,
  aboutScreen, termsScreen, privacyScreen, topLoadingIndicator, pageLoadingManager,
  questionBankClient, adminLicenses, adminPayments, adminQuestionBank,
  practiceConfigScreen, practiceCompetenceScreen, trackHubScreen, drillScreen,
  quickScanCompetenceScreen, quickScanViewerScreen, flashcardsScreen, searchScreen,
  appDrawer, installHook, installPrompt, iosInstallGuide, abandonedCheckoutCleanup, abandonedCheckoutMigration, adminLicenseManagement,
  accountActivityFunction, accountRetentionFunction, activityRetentionMigration, scheduleRetentionMigration, retentionReasonMigration, workflow
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
  read('../src/screens/AdminQuestionBankScreen.tsx'),
  read('../src/screens/PracticeConfigScreen.tsx'),
  read('../src/screens/PracticeCompetenceScreen.tsx'),
  read('../src/screens/TrackHubScreen.tsx'),
  read('../src/screens/DrillScreen.tsx'),
  read('../src/screens/QuickScanCompetenceScreen.tsx'),
  read('../src/screens/QuickScanViewerScreen.tsx'),
  read('../src/screens/FlashcardsScreen.tsx'),
  read('../src/screens/SearchScreen.tsx'),
  read('../src/components/AppDrawer.tsx'),
  read('../src/hooks/useInstallPrompt.ts'),
  read('../src/components/InstallPrompt.tsx'),
  read('../src/screens/IOSInstallGuideScreen.tsx'),
  read('../supabase/functions/expire-abandoned-checkouts/index.ts'),
  read('../supabase/migrations/20261028093640_schedule_12_hour_abandoned_paymongo_checkout_cleanup.sql'),
  read('../supabase/functions/admin-license-management/index.ts'),
  read('../supabase/functions/record-user-activity/index.ts'),
  read('../supabase/functions/expire-inactive-accounts/index.ts'),
  read('../supabase/migrations/20261028154702_add_user_activity_and_retention_tables.sql'),
  read('../supabase/migrations/20261028155349_schedule_inactive_account_cleanup.sql'),
  read('../supabase/migrations/20261028172256_expand_account_retention_audit_reason_check.sql'),
  read('../.github/workflows/pwa-build.yml')
]);

const offlineQuestionCache = await read('../src/lib/offlineQuestionCache.ts');
const submitManualPaymentFunction = await read('../supabase/functions/submit-manual-payment/index.ts');
const googlePlayLinkFunction = await read('../supabase/functions/link-google-play-subscription/index.ts');
const googlePlayRtdnFunction = await read('../supabase/functions/google-play-rtdn/index.ts');
const googlePlayLinkMigration = await read('../supabase/migrations/20261029164000_add_google_play_purchase_links.sql');
const googlePlaySchema = await read('../supabase/schema.sql');
const questionFingerprintSource = await read('../src/lib/questionFingerprint.mjs');
const offlinePwaConfig = await read('../vite.config.ts');
const encryptedPersistStorage = await read('../src/lib/encryptedPersistStorage.ts');
const progressSyncSource = await read('../src/lib/progressSync.ts');
const bookmarksStore = await read('../src/stores/bookmarksStore.ts');
const vaultStore = await read('../src/stores/vaultStore.ts');
const vaultScreen = await read('../src/screens/VaultScreen.tsx');
const practiceQuizScreen = await read('../src/screens/PracticeQuizScreen.tsx');
const questionBankAccessModule = await read('../supabase/functions/question-bank/access.mjs');
const { canAccessPaidTrack } = await import('../supabase/functions/question-bank/access.mjs');
const learningProgressTriggerMigration = await read('../supabase/migrations/20261028181820_revoke_client_execute_on_learning_progress_trigger.sql');
const offlineEntitlementSigningMigration = await read('../supabase/migrations/20261028181300_add_signed_offline_entitlements.sql');
const viteConfig = await read('../vite.config.ts');
const mainEntry = await read('../src/main.tsx');
const routeErrorBoundary = await read('../src/components/RouteErrorBoundary.tsx');
const adminPaymentReviewFunction = await read('../supabase/functions/admin-payment-review/index.ts');
const deleteAccount = await read('../supabase/functions/delete-account/index.ts');
const learningProgressFunction = await read('../supabase/functions/learning-progress/index.ts');
const progressPrivilegeMigration = await read('../supabase/migrations/20261029032520_revoke_client_access_to_learning_progress.sql');
const cancelCheckout = await read('../supabase/functions/cancel-checkout/index.ts');
const offlineEntitlementCrypto = await read('../src/lib/offlineEntitlementCrypto.mjs');
const sessionArchive = await read('../src/lib/sessionArchive.ts');
const { verifyOfflineEntitlementToken } = await import('../src/lib/offlineEntitlementCrypto.mjs');

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
const singleWebhookValidation = webhook.slice(webhook.indexOf("if (\n    order.product_code !=="));
assert.ok(singleWebhookValidation.includes("(typeof sessionAttrs?.livemode === 'boolean' && sessionAttrs.livemode !== isLive)"), 'Single-track webhook rejects a checkout session whose mode conflicts with the configured environment');
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
assert.ok(termsScreen.includes('October 29, 2026'), 'Terms updated date matches the latest substantive revision');
assert.ok(privacyScreen.includes('Firebase Analytics') && privacyScreen.includes('PayMongo') && privacyScreen.includes('daily app-open check-in streak'), 'Privacy policy describes current analytics, payment, and synced progress handling');
assert.ok(privacyScreen.includes('does not cancel a Google Play subscription') && privacyScreen.includes('A website/PWA license and Google Play subscription are independent'), 'Privacy policy explains separate license and deletion effects');
assert.ok(privacyScreen.includes('href="/account?tab=delete"') && !privacyScreen.includes('hyperionmaritime.org/delete-account'), 'Privacy policy links to the real in-app website account-deletion route');
assert.ok(privacyScreen.includes('October 29, 2026'), 'Privacy policy updated date matches the latest substantive revision');
assert.ok(app.includes("import TopLoadingIndicator from './components/TopLoadingIndicator'") && app.includes('<TopLoadingIndicator />'), 'Global top loader is mounted for every app route');
assert.ok(app.includes("withPageLoading('Checking licenses and access'") && app.includes('void refresh(true)'), 'Initial entitlement checks keep the top loader active until access state is hydrated');
assert.ok(topLoadingIndicator.includes('location.pathname') && topLoadingIndicator.includes('location.search') && topLoadingIndicator.includes('ROUTE_TRANSITION_MS = 480'), 'Top loader activates on page and query-string navigation');
assert.ok(topLoadingIndicator.includes('src="/logo.png"') && !topLoadingIndicator.includes('/logo.png?') && topLoadingIndicator.includes('hyperion-top-loader__logo'), 'Top loader uses the exact precached local Hyperion logo URL as its animated symbol');
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
assert.ok(!accountScreen.includes('/manual-payment?product=') && !accountScreen.includes('Pay manually with QR'), 'Bond Store product cards do not expose direct manual QR payment links');
assert.ok(basketScreen.includes('showManualPaymentFallback = manualPaymentItems.length > 0') && basketScreen.includes('PayMongo checkout is unavailable') && basketScreen.includes('to={`/manual-payment?product=${encodeURIComponent(code)}&term=${term}`}'), 'Manual QR payment links are only offered from Checkout when PayMongo is unavailable');
assert.ok(!manualPayment.includes('SEND PAYMENT SCREENSHOT VIA FACEBOOK'), 'Manual payment form does not show the Facebook proof button before submission');
assert.ok(manualPayment.includes('(manualSubmission || pendingManualOrder)') && manualPayment.includes('SEND PAYMENT PROOF VIA FACEBOOK') && manualPayment.indexOf('SEND PAYMENT PROOF VIA FACEBOOK') > manualPayment.indexOf('(manualSubmission || pendingManualOrder)'), 'Facebook proof button appears only after manual submission has been confirmed or an existing pending submission is loaded');
assert.ok(manualPayment.includes('In your Facebook message, include the email address you use to sign in to your Hyperion account.') && manualPayment.includes('Hyperion account email:</strong> {session.user.email'), 'Post-submission instructions explicitly provide the account email to include with payment proof');
assert.ok(manualPayment.includes('manualSubmission?.paymentReference || pendingManualOrder?.payment_reference') && manualPayment.includes('CANCEL MANUAL PAYMENT REQUEST'), 'Post-submission panel retains transaction reference and duplicate-request cancellation');
assert.ok(manualPayment.includes("navigate('/checkout')") && manualPayment.includes('← Back to Checkout') && manualPayment.includes('BACK TO CHECKOUT'), 'Manual QR page returns users to Checkout and no longer routes them to Bond Store');
assert.ok(ordersHistory.includes("withPageLoading('Loading orders and payment history'") && ordersHistory.includes("withPageLoading('Verifying payment status'"), 'Order history and payment reconciliation display the indicator');
assert.ok(adminLicenses.includes("withPageLoading('Loading license administration'") && adminPayments.includes("withPageLoading('Loading payment submissions'") && adminQuestionBank.includes("withPageLoading('Loading question-bank inventory'"), 'Admin data loading uses the shared indicator');
assert.ok(adminPayments.includes("useState<'active' | 'pending' | 'failed' | 'expired'>('pending')") && adminPayments.includes('role="tablist"') && adminPayments.includes('role="tab"'), 'Payment submissions are organized into accessible status tabs');
assert.ok(adminPayments.includes("['active', 'ACTIVE']") && adminPayments.includes("['pending', 'PENDING']") && adminPayments.includes("['failed', 'FAILED']") && adminPayments.includes("['expired', 'EXPIRED']"), 'Payment submissions provide Active, Pending, Failed, and Expired tabs');
assert.ok(adminPayments.includes("order.status === 'paid' && order.access_status === 'active'") && adminPayments.includes("order.status === 'submitted' || order.status === 'pending'") && adminPayments.includes("order.status === 'failed'"), 'Payment tab grouping uses effective access state and provider/order status');
assert.ok(adminPayments.includes('ordersByStatus[id].length') && adminPayments.includes('const visibleOrders = ordersByStatus[statusTab]') && adminPayments.includes('No {statusTab} payment submissions.'), 'Each payment tab shows its own count and empty state');
assert.ok(adminPayments.includes("if (order.access_status === 'revoked') return 'REVOKED'") && adminPayments.includes("if (order.access_status === 'not_current') return 'INACTIVE'") && adminPayments.includes("This tab also includes paid licenses that have been revoked"), 'Expired tab preserves visibility and labels for revoked or inactive historical payments');
assert.ok(adminPayments.includes('@media(max-width:760px)') && adminPayments.includes('grid-template-columns:repeat(2,minmax(0,1fr))'), 'Payment status tabs remain usable on mobile screens');
assert.ok(adminPayments.includes('<table className="admin-payment-table">') && adminPayments.includes('<th scope="col">Customer name</th>') && adminPayments.includes('<th scope="col">Email</th>') && adminPayments.includes('Date &amp; time submitted') && adminPayments.includes('Purchase') && adminPayments.includes('Status') && adminPayments.includes('More info'), 'Payment submissions use spreadsheet-style columns for customer, email, date, purchase, status, and details');
assert.ok(adminPayments.includes('aria-expanded={expanded}') && adminPayments.includes('aria-controls={`payment-details-${order.id}`}') && adminPayments.includes('Hide details ▲') && adminPayments.includes('Details ▼'), 'Each payment row has an accessible expandable details section');
assert.ok(adminPayments.includes('Order ID') && adminPayments.includes('Payment method') && adminPayments.includes('Transaction / reference') && adminPayments.includes('Payment proof') && adminPayments.includes('License access') && adminPayments.includes('Admin note'), 'Expandable payment details retain order references, proof, license access, and review notes');
assert.ok(adminPayments.includes('Approve &amp; unlock') && adminPayments.includes("review(order.id,'approve')") && adminPayments.includes("review(order.id,'reject')") && adminPayments.includes('Awaiting PayMongo confirmation'), 'Expandable rows preserve manual review actions and the PayMongo no-manual-approval warning');
assert.ok(!adminPayments.includes('admin-payment-orders-grid') && adminPayments.includes('admin-payment-table-wrap{width:100%;overflow-x:auto'), 'Large payment cards are replaced with a responsive horizontal-scrolling table');

assert.ok(adminLicenses.includes("useState<'name-asc' | 'joined-desc' | 'joined-asc'>('joined-desc')") && adminLicenses.includes('Alphabetical (A–Z)') && adminLicenses.includes('Date joined (newest first)') && adminLicenses.includes('Date joined (oldest first)'), 'Admin users default to newest-first and retain alphabetical/oldest-first sort options');
assert.ok(adminLicenses.includes('a.display_name ||') && adminLicenses.includes("localeCompare(b.display_name || ''") && adminLicenses.includes('Date.parse(a.created_at)') && adminLicenses.includes('Date.parse(b.created_at)'), 'User sorting compares display names and auth account creation dates');
assert.ok(adminLicenses.includes('const [activeLicenseOnly, setActiveLicenseOnly] = useState(false)') && adminLicenses.includes("license?.status === 'active'") && adminLicenses.includes('(!activeLicenseOnly || hasActiveLicense)'), 'Active-only filter uses current active license statuses and composes with search');
assert.ok(adminLicenses.includes('aria-pressed={activeLicenseOnly}') && adminLicenses.includes('Active licenses only') && adminLicenses.indexOf('Active licenses only') < adminLicenses.indexOf('Refresh users'), 'Active-license toggle appears before Refresh users and exposes its pressed state accessibly');
assert.ok(adminLicenses.includes("useState<'all' | ManagedUser['retention_status']>('all')") && adminLicenses.includes('Filter by account retention status') && adminLicenses.includes('option value="deletion_due">Deletion eligible</option>') && adminLicenses.includes("retentionFilter === 'all' || user.retention_status === retentionFilter"), 'Admin users can filter by retention status and locate deletion-eligible accounts');
assert.ok(adminLicenseManagement.includes("function effectiveStatus(row: any, now = Date.now())") && adminLicenseManagement.includes("if (row.status === 'revoked') return 'revoked'") && adminLicenseManagement.includes('expiry <= now') && adminLicenseManagement.includes("return 'active'"), 'Admin backend computes effective license status from revocation and expiry before filtering');
assert.ok(/(?:supabase|client)\.functions\.invoke\('record-user-activity'\)/.test(app) && app.includes("hyperion:last-website-activity") && app.includes("15 * 60 * 1000"), 'Authenticated site access is tracked with a client-side 15-minute write throttle');
assert.ok(accountActivityFunction.includes("userClient.auth.getUser()") && accountActivityFunction.includes("from('user_activity')") && accountActivityFunction.includes("15 * 60 * 1000"), 'Activity endpoint verifies the caller and throttles writes server-side');
assert.ok(accountRetentionFunction.includes('const INACTIVITY_DAYS = 30') && accountRetentionFunction.includes('const GRACE_DAYS = 30') && accountRetentionFunction.includes('const FREE_RETENTION_DAYS = INACTIVITY_DAYS + GRACE_DAYS') && accountRetentionFunction.includes("reason = 'free_account_inactivity_grace_ended'") && accountRetentionFunction.includes("reason = 'license_expired_and_inactivity_grace_ended'"), 'Retention function enforces 30 days of inactivity plus a separate 30-day grace period, while preserving post-expiry protection');
assert.ok(retentionReasonMigration.includes("'free_account_inactivity_grace_ended'") && retentionReasonMigration.includes("'license_expired_and_inactivity_grace_ended'") && retentionReasonMigration.includes("'free_account_inactive_30_days'") && retentionReasonMigration.includes("'license_expired_grace_period_ended'"), 'Retention audit constraint accepts both current and historical cleanup reason values');
assert.ok(accountRetentionFunction.includes("row.status === 'active' && parseDate(row.expires_at) > now") && accountRetentionFunction.includes('skippedActiveLicense++'), 'Any currently active website license protects the account from retention deletion');
assert.ok(accountRetentionFunction.includes('freshEntitlements') && accountRetentionFunction.includes('freshActivity') && accountRetentionFunction.includes('freshPendingOrders') && accountRetentionFunction.includes('freshPendingBatch'), 'Deletion rechecks license, activity, and payment state immediately before deletion');
assert.ok(accountRetentionFunction.includes('dryRun') && accountRetentionFunction.includes('deletion_attempted') && accountRetentionFunction.includes('adminAuditUsers'), 'Retention job supports non-destructive preflight, audit logging, and admin/audit protections');
assert.ok(accountRetentionFunction.includes('verify_account_retention_cron_token') && activityRetentionMigration.includes('revoke all on table public.user_activity from anon, authenticated') && activityRetentionMigration.includes('revoke all on table public.account_retention_audit from anon, authenticated'), 'Activity and retention internals are service-role-only and cron calls are token-protected');
assert.ok(scheduleRetentionMigration.includes("'hyperion-expire-inactive-accounts'") && scheduleRetentionMigration.includes("'0 4 * * *'") && scheduleRetentionMigration.includes('hyperion_account_retention_cron_token'), 'Daily retention job is scheduled through the private Vault token');
assert.ok(adminLicenseManagement.includes('last_accessed_at: lastAccessedAt') && adminLicenseManagement.includes('last_access_source: lastAccessSource') && adminLicenseManagement.includes('retention_status: retentionStatus') && adminLicenseManagement.includes('retention_due_at: retentionDueAt'), 'Admin API returns last access and the account retention state');
assert.ok(adminLicenses.includes('Last accessed') && adminLicenses.includes('retentionLabel(user)') && adminLicenses.includes('RENEWAL GRACE'), 'Admin user cards and detail modal display last website access and retention status');
assert.ok(accountScreen.includes('Your license has expired') && accountScreen.includes('View available licenses') && accountScreen.includes('30 * 24 * 60 * 60 * 1000') && accountScreen.includes('This is an account-retention safeguard, not extra paid access.'), 'Users with expired website licenses see their retention deadline without mistaking it for extra paid-track access');
assert.ok(termsScreen.includes('30 consecutive days without authenticated website activity') && termsScreen.includes('30-day renewal grace period'), 'Terms disclose inactivity-based account deletion and license-expiry grace');
assert.ok(privacyScreen.includes('Website access timestamps') && privacyScreen.includes('automated inactivity-retention process') && privacyScreen.includes('automated deletion is eligible only after both the renewal-grace and inactivity-plus-grace timing requirements have passed'), 'Privacy policy describes website activity logging and the combined inactivity/grace retention deadline');
assert.ok(termsScreen.includes('October 29, 2026') && privacyScreen.includes('October 29, 2026'), 'Legal pages show the current revision date for activity and retention disclosures');

assert.ok(trackSelectionScreen.includes('const [examPanelExpanded, setExamPanelExpanded] = useState(false)'), 'Dashboard exam and streak dropdown starts collapsed to save space');
assert.ok(trackSelectionScreen.includes('aria-expanded={examPanelExpanded}') && trackSelectionScreen.includes('aria-controls="dashboard-exam-details"'), 'Dashboard dropdown exposes its expanded state accessibly');
assert.ok(trackSelectionScreen.includes('aria-hidden={!examPanelExpanded}') && trackSelectionScreen.includes('ref={examDetailsRef}') && trackSelectionScreen.includes('examDetailsRef.current.inert = !examPanelExpanded') && trackSelectionScreen.includes("' is-expanded'"), 'Dropdown details transition smoothly and use native DOM inert state while collapsed');
assert.ok(trackSelectionScreen.includes('className="dashboard-exam-panel__streak">{streakStatus}</span>') && trackSelectionScreen.includes('MARINA LICENSURE EXAM'), 'Collapsed dropdown keeps exam target and streak summary visible');
assert.ok(trackSelectionScreen.includes('dashboard-exam-panel__date-input') && trackSelectionScreen.includes('onClick={saveTarget}'), 'Target date picker remains accessible within expanded dropdown');
assert.ok(trackSelectionScreen.includes('className={`dash-header dashboard-header-with-exam${examPanelExpanded ? \' is-expanded\' : \'\'}`}') && trackSelectionScreen.includes('className="dashboard-header-main"'), 'Exam target toggle is merged into the Hyperion brand header instead of a separate card');
assert.ok(!trackSelectionScreen.includes('<section className={`card dashboard-exam-panel'), 'Dashboard no longer renders a separate full-width exam dropdown card');
assert.ok(indexCss.includes('.dashboard-header-main {') && indexCss.includes('flex: 0 1 500px') && indexCss.includes('@media (max-width: 760px)'), 'Merged header uses horizontal desktop layout and a compact responsive mobile layout');
assert.ok(indexCss.includes('.dashboard-header-with-exam .dashboard-exam-panel__details') && indexCss.includes('width: 100%'), 'Expanded exam and streak details remain full-width beneath the merged header row');
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
assert.ok(mockExam.includes("getQuestionCountsByTrack(trackId, freeOnly)") && mockExam.includes("refreshCloudEntitlements"), 'Mock exam refreshes entitlement and requests counts for the correct access tier');
assert.ok(!mockExam.includes("getQuestionsByTrack(trackId, true)"), 'Mock exam selection never preloads the free question text for all users');
assert.ok(mockExam.includes("free: false") && mockExam.includes("limit: examItemCount") && mockExam.includes("timeLimitSec: examItemCount * 60"), 'Mock exam requests the configured competence count without forcing the free pool or shrinking the timer');
assert.ok(mockExam.includes("MOCK_COMPETENCES_BY_FUNCTION") && mockExam.includes("functionForCompetence(trackId, competence.id)"), 'Mock exam maps function and competence selection independently of loaded question text');
assert.ok(mockExam.includes("row.count < row.requiredCount") && mockExam.includes("INSUFFICIENT ITEMS"), 'Mock exam blocks a competence when the eligible pool cannot meet its configured count');
assert.ok(mockExam.includes('requiredCount: mockExamItemCount(trackId, competence.id)') && !mockExam.includes('.filter((competence) => competence.count > 0)'), 'Mock exam leaves zero-count competences visible so a missing pool is reported, not silently omitted');
assert.ok(['DECK_OIC_NW', 'GMDSS_GOC', 'ENGINE_OIC_EW', 'DECK_MGT', 'ENGINE_MGT'].every(track => mockExam.includes(track + ': {')), 'Mock exam preserves a configured competence distribution for all five tracks');
assert.ok(practiceStore.includes("mode === 'MOCK' && qs.length < finalLimit") && practiceStore.includes('The exam was not shortened'), 'Practice store rejects any mock sample shorter than the required item count');
assert.ok(questionBank.includes("if (randomSample) {") && questionBank.includes("Math.floor(Math.random() * (i + 1))") && questionBank.includes("allQuestions.slice(0, limit)"), 'Protected question-bank endpoint randomly shuffles the authorized competence pool before sampling without replacement');
assert.ok(questionBank.includes('if (!freeOnly)') && questionBank.includes('authorizeTrack(admin, user, isAdmin, track)'), 'Full-bank question requests remain server-authorized by an active track license or admin access');
assert.ok(questionBank.includes('if (freeOnly) text = sampleFreeCsv(assetPath, text)'), 'Free mock exam sampling remains restricted to the designated free sample');
assert.ok(mockExam.includes('SUBMIT EXAM'), 'Mock exam requires explicit submission');
assert.ok(mockExam.includes("window.addEventListener('beforeunload', blockExit)"), 'Mock exam guards accidental exit');
assert.ok(licenseStore.includes('canUseOfflineEntitlementsAfterError'), 'Offline entitlement fallback is constrained to offline/server outage scenarios');
assert.ok(app.includes("location.pathname === '/practice/competences' || location.pathname === '/practice'") && app.includes('setupNeedsLicense'), 'Direct Practice All Questions and practice-config URLs are guarded by track entitlement');
assert.ok(app.includes("setupParams.get('free') === '1' && setupMode !== 'drill'") && app.includes('Free Reviewer and Timed Mock Exam remain available without a purchase.'), 'Only the explicit Free Reviewer route bypasses practice setup licensing');
assert.ok(app.includes("isMockRunner && currentMode === 'MOCK'") && app.includes("isPracticeQuiz && currentMode === 'PRACTICE'") && app.includes('const isPermittedFreeRunner = isFreeSession'), 'Question-runner access only treats actual Mock and Free Reviewer sessions as free');
assert.ok(practiceStore.includes("mode !== 'MOCK' && !licensed && !isFreeReviewerSession") && practiceStore.includes("mode === 'PRACTICE' && free === true"), 'Practice store blocks unlicensed Practice All Questions and Drill sessions except explicit Free Reviewer');
assert.ok(practiceStore.includes("mode === 'MOCK' ? !licensed : isFreeReviewerSession"), 'Mock Exam remains usable as a free feature and uses the full pool only for licensed users');
assert.ok(practiceConfigScreen.includes('await refreshCloudEntitlements()') && practiceConfigScreen.includes('if (!freeMode && !hasLicense)') && practiceConfigScreen.includes('shuffleChoices, free: freeMode'), 'Practice configuration rechecks entitlement and no longer silently downgrades paid mode into free practice');
assert.ok(practiceCompetenceScreen.includes("if (!freeMode && !unlocked)") && practiceCompetenceScreen.includes("openPaywall('Practice')"), 'Practice competence links without the explicit free reviewer flag require a license');
assert.ok(trackHubScreen.includes("title: 'PRACTICE ALL QUESTIONS'") && trackHubScreen.includes("title: 'QUICK SCAN MODE'") && trackHubScreen.includes("title: 'FLASHCARD REVISION'") && trackHubScreen.includes('locked: !unlocked'), 'Track hub keeps paid practice, Quick Scan and Flashcards locked without the track license');
assert.ok(drillScreen.includes("if (!isUnlocked)") && drillScreen.includes("openPaywall('Drill')"), 'Drill mode requires an active track license');
assert.ok(quickScanCompetenceScreen.includes("{!unlocked &&") && quickScanCompetenceScreen.includes("unlocked ? navigate(`/quick-scan/view?track=${key}&competence=${encodeURIComponent(c.id)}`) : openPaywall('Quick Scan')") && quickScanViewerScreen.includes("getQuestionCountsByTrack(track, false)"), 'Quick Scan selection gates navigation and requests the protected full bank');
assert.ok(flashcardsScreen.includes("if (!isUnlocked)") && questionBank.includes('An active license is required to open flashcards'), 'Flashcard UI and server endpoint both enforce the license boundary');
assert.ok(searchScreen.includes("if (!isUnlocked)") && questionBank.includes('An active license is required to search this track'), 'Question search UI and server endpoint both enforce the license boundary');
assert.ok(searchScreen.includes('className="search-results-protected"') && searchScreen.includes('onCopy={(event) => event.preventDefault()}') && searchScreen.includes('onCut={(event) => event.preventDefault()}') && searchScreen.includes('onContextMenu={(event) => event.preventDefault()}'), 'Search question results prevent copying, cutting, and context-menu actions');
assert.ok(indexCss.includes('.search-results-protected,') && indexCss.includes('-webkit-user-select: none;') && indexCss.includes('user-select: none;') && indexCss.includes('-webkit-touch-callout: none;'), 'Search question result text cannot be selected through normal desktop or mobile text selection');
assert.ok(questionBank.includes('if (!freeOnly)') && questionBank.includes('An active license is required to retrieve these questions') && questionBank.includes('An active license is required to access paid question counts'), 'Backend rejects unauthenticated or unlicensed full-bank question and count requests');
assert.ok(questionBank.includes('if (freeOnly) text = sampleFreeCsv(assetPath, text)') && questionBank.includes('if (body.action === "flashcards")') && questionBank.includes('if (body.action === "search")'), 'Backend free requests are limited to the designated sample while paid-content actions remain separately guarded');
assert.ok(abandonedCheckoutCleanup.includes('12 * 60 * 60 * 1000') && abandonedCheckoutCleanup.includes('.lt(\'created_at\', cutoff)'), 'Abandoned PayMongo cleanup only considers checkouts older than 12 hours');
assert.ok(abandonedCheckoutCleanup.includes('x-hyperion-cron-token') && abandonedCheckoutCleanup.includes('verify_abandoned_checkout_cron_token'), 'Scheduled payment cleanup authenticates with a server-side secret');
assert.ok(abandonedCheckoutCleanup.includes('metadataMatches(record, session, isBatch)') && abandonedCheckoutCleanup.includes('status') && abandonedCheckoutCleanup.includes('/expire'), 'Cleanup verifies checkout metadata and provider state before expiring sessions');
assert.ok(abandonedCheckoutCleanup.includes('hasInFlightOrUnknownPayment(session)') && abandonedCheckoutCleanup.includes('summary.processing += 1'), 'Cleanup leaves processing or uncertain payments pending');
assert.ok(abandonedCheckoutCleanup.includes('finalize_paymongo_checkout') && abandonedCheckoutCleanup.includes('paidFinalized'), 'Cleanup recovers verified paid payments through the existing atomic finalizer');
assert.ok(abandonedCheckoutCleanup.includes('mark_abandoned_paymongo_checkout_failed') && abandonedCheckoutCleanup.includes('status') && abandonedCheckoutCleanup.includes('expired'), 'Cleanup marks an order failed only after PayMongo confirms expiry');
assert.ok(abandonedCheckoutMigration.includes('interval \'12 hours\'') && abandonedCheckoutMigration.includes('created_at <= now() - interval \'12 hours\''), 'Database transition has its own atomic 12-hour cutoff guard');
assert.ok(abandonedCheckoutMigration.includes('grant execute on function public.verify_abandoned_checkout_cron_token(text) to service_role') && abandonedCheckoutMigration.includes('revoke all on function public.verify_abandoned_checkout_cron_token(text) from public, anon, authenticated'), 'Cron token validation is service-role only');
assert.ok(abandonedCheckoutMigration.includes('hyperion-expire-abandoned-paymongo-checkouts') && abandonedCheckoutMigration.includes('*/5 * * * *') && abandonedCheckoutMigration.includes('vault.decrypted_secrets'), 'Supabase schedules cleanup every five minutes using secrets stored in Vault');
assert.ok(app.includes('<InstallPrompt variant="modal" iosOnly />') && app.includes('<Route path="/" element={<><InstallPrompt variant="modal" iosOnly /><TrackSelectionScreen /></>} />'), 'Initial entry page displays the install modal only on iOS');
assert.ok(installPrompt.includes("isIos ? (") && installPrompt.includes('<AppleAppStoreBadge onClick={dismiss} />') && installPrompt.includes('Download on the') && installPrompt.includes('App Store'), 'iPhone install prompt displays a prominent App Store-style badge instead of text instructions');
assert.ok(installPrompt.includes('to="/install/ios"') && installPrompt.includes('onClick={onClick}') && installPrompt.includes("onClick={dismiss}"), 'Apple install badge navigates directly to the iOS setup guide and dismisses the prompt');
assert.ok(installPrompt.includes('iosOnly = false') && installPrompt.includes('(iosOnly && !isIos)'), 'New entry popup is restricted to iPhone and iPad browsers');
assert.ok(installPrompt.includes('<GooglePlayBadge />') && installPrompt.includes('ADD HYPERION TO HOME SCREEN'), 'Existing Android Google Play badge and PWA installation action remain intact');
assert.ok(installHook.includes('export function getManualInstallInstructions()') && installHook.includes('brave://apps') && installHook.includes('Save and Share') && installHook.includes('Install page as app'), 'Install fallback provides browser-specific manual install recovery instructions');
assert.ok(installHook.includes('SamsungBrowser') && installHook.includes('Firefox on Android') && installHook.includes('Vivaldi on Android') && installHook.includes('Chrome on Android'), 'Mobile install guidance covers Samsung Internet, Firefox, Vivaldi, and Chrome');
assert.ok(installHook.includes('Microsoft Edge') && installHook.includes('Google Chrome') && installHook.includes('Firefox on Windows') && installHook.includes('Safari on Mac') && installHook.includes('Add to Dock'), 'Desktop install guidance covers Edge, Chrome, Firefox, and Safari with platform-appropriate directions');
assert.ok(installHook.includes('For this browser') && installHook.includes('Create shortcut'), 'Unrecognized browsers receive a universal fallback and supported-browser alternative');
assert.ok(appDrawer.includes('getManualInstallInstructions()') && appDrawer.includes('desktopInstallNotice'), 'Desktop drawer explains the browser-menu install path when no native prompt is exposed');
assert.ok(installPrompt.includes('getManualInstallInstructions()') && installPrompt.includes('{installMessage &&'), 'The install card displays manual-install guidance when the native prompt is unavailable');
assert.ok(iosInstallGuide.includes('Keep the name Hyperion.') && iosInstallGuide.includes('Keep the app name as Hyperion.') && iosInstallGuide.includes('open the new Hyperion icon.'), 'iOS install instructions consistently tell users to name and launch the app as Hyperion');
assert.ok(!iosInstallGuide.includes('Keep the app name as Hyperion Maritime.') && !iosInstallGuide.includes('Keep the name Hyperion Maritime.'), 'iOS install instructions do not contradict the requested Hyperion app name');


assert.ok(questionBank.includes('if (body.action === "authorize-session")') && questionBank.includes('fingerprints.every(hash => allowedFingerprints.has(hash as string))'), 'Saved-session authorization verifies the server-defined free sample when the caller lacks a license');
assert.ok(questionBank.includes('fullQuestionFingerprints') && questionBank.includes('questionIds.every(id => questionIdBelongsToTrack(id, track))'), 'Licensed legacy sessions require private-bank fingerprint matches when old question IDs do not match the current track prefix');
assert.ok(questionBank.includes('const canonicalOptions') && learningProgressFunction.includes('const canonicalOptions'), 'Question access and cloud-progress filtering use stable option-order-independent fingerprints');
assert.ok(questionBankClient.includes("saveOfflineEntitlements") && questionBankClient.includes("body: { action: 'offline-license' }") && questionBankClient.includes('await getOfflineEntitlementExpiry(userId, track)'), 'Paid offline-pack downloads save and verify a signed, track-specific offline entitlement lease');
assert.ok(questionBankClient.includes("if (await matchesCachedPack(true)) return 'free-sample'") && questionBankClient.includes('if (await hasValidOfflineTrackLease(track)) return \'licensed\''), 'Saved-session fallback supports verified free samples and paid full-bank leases after network/server failures');
const originalQuestionFingerprint = await fingerprintQuestion({
  questionText: 'Which option is correct?',
  options: ['Alpha', 'Bravo', 'Charlie'],
  correctAnswerIndex: 1
});
const shuffledQuestionFingerprint = await fingerprintQuestion({
  questionText: 'Which option is correct?',
  options: ['Charlie', 'Alpha', 'Bravo'],
  correctAnswerIndex: 2
});
const changedAnswerFingerprint = await fingerprintQuestion({
  questionText: 'Which option is correct?',
  options: ['Charlie', 'Alpha', 'Bravo'],
  correctAnswerIndex: 0
});
assert.ok(originalQuestionFingerprint && shuffledQuestionFingerprint && changedAnswerFingerprint, 'Stable question fingerprints reject malformed inputs and hash valid saved questions');
assert.equal(originalQuestionFingerprint, shuffledQuestionFingerprint, 'Shuffling answer options preserves saved-session identity when the correct answer moves with its option');
assert.notEqual(originalQuestionFingerprint, changedAnswerFingerprint, 'Changing the correct answer does not preserve question identity');
assert.ok(questionBank.includes('const authHeader = req.headers.get("Authorization")') && questionBank.includes('.auth.getUser()'), 'Question-bank identity comes from a validated Supabase user token, not client metadata');
assert.ok(licenseStore.includes('return status === 0 || status >= 500'), 'Cached entitlement fallback is limited to genuine connectivity/server failures');
assert.ok(questionBankClient.includes('userId ? getOfflineEntitlementExpiry(userId, track) : null'), 'Offline entitlement lookup is scoped to the currently signed-in Supabase user');
assert.ok(offlineQuestionCache.includes('if (!stored || stored.userId !== userId) return null') && offlineQuestionCache.includes('expiresAt > Date.now()') && offlineEntitlementCrypto.includes('crypto.subtle.verify'), 'Offline entitlement cache requires a valid signature, matching account, and unexpired track lease');
assert.ok(questionBankClient.includes('if (error && canFallbackToOffline(error) && await offlineEntitlementExpiry(track))'), 'Online question fallback only consults saved paid packs after a network/server failure plus a valid local expiry');
assert.ok(questionBank.includes('body.freeOnly !== true') && questionBank.includes('Raw paid-bank delivery is disabled. Use paginated question delivery.'), 'Legacy raw-file endpoint cannot be used to retrieve paid-bank assets');


assert.ok(adminLicenseManagement.includes("client.auth.getUser()") && adminLicenseManagement.includes("ADMIN_EMAILS") && adminLicenseManagement.includes("Admin access denied."), 'Admin license management rejects non-admin sessions');
assert.ok(adminPaymentReviewFunction.includes("client.auth.getUser()") && adminPaymentReviewFunction.includes("ADMIN_EMAILS") && adminPaymentReviewFunction.includes("Admin access denied."), 'Admin payment review rejects non-admin sessions');
assert.ok(abandonedCheckoutCleanup.includes("const providedToken = req.headers.get('x-hyperion-cron-token')") && abandonedCheckoutCleanup.includes("tokenCheck.data !== true) return json({ error: 'Unauthorized scheduled job.' }, 401)"), 'Abandoned-checkout cleanup rejects requests without a verified cron token');
assert.ok(accountRetentionFunction.includes("const cronToken = req.headers.get('x-hyperion-account-retention-token')") && accountRetentionFunction.includes("if (!url || !service || !cronToken) return json({ error: 'Not authorized.' }, 401)") && accountRetentionFunction.includes('verify_account_retention_cron_token'), 'Account-retention cleanup requires and verifies its private cron token');
assert.ok(deleteAccount.includes("userClient.auth.getUser()") && deleteAccount.includes(".eq('user_id', user.id)"), 'Account deletion authenticates the caller and scopes payment dependencies to their own account');
assert.ok(cancelCheckout.includes("authClient.auth.getUser()") && cancelCheckout.includes(".eq('user_id', user.id)"), 'Checkout cancellation authenticates the caller and scopes order access to the owning user');


assert.ok(viteConfig.includes("globPatterns: ['**/*.{js,css,html,ico,png,svg,jpg,jpeg,webp,avif,woff2,webmanifest}']") && !viteConfig.includes('.csv') && !viteConfig.includes('.enc'), 'PWA pre-cache includes bundled screen images but excludes CSV and encrypted question-bank assets');
assert.ok(viteConfig.includes("navigateFallback: 'index.html'"), 'Deep links and client-side routes fall back to the cached app shell while offline');
assert.ok(viteConfig.includes('sourcemap: false'), 'Production build does not publish browser source maps');
assert.ok(mainEntry.includes("caches.delete('hyperion-question-banks')"), 'App startup deletes the legacy static question-bank cache');


assert.ok(questionBank.includes("body.action === \"offline-license-public-key\"") && questionBank.includes("Only the verification key is public") && questionBank.includes("key_ops: [\"verify\"]"), 'Offline signing-key endpoint returns only a verification key');
assert.ok(questionBank.includes("body.action === \"offline-license\"") && questionBank.includes("const claims = { v: 1, userId: user.id, issuedAt: now, tracks }") && questionBank.includes("crypto.subtle.sign"), 'Offline entitlement claims are issued by the authenticated server and cryptographically signed');
assert.ok(questionBank.includes('.eq("user_id", user.id)') && questionBank.includes('.eq("status", "active")') && questionBank.includes('.gt("expires_at", new Date(now).toISOString())'), 'Offline entitlement token only contains the signed-in user’s currently active, unexpired tracks');
assert.ok(offlineEntitlementSigningMigration.includes('private_jwk jsonb NOT NULL') && offlineEntitlementSigningMigration.includes('public_jwk jsonb NOT NULL') && offlineEntitlementSigningMigration.includes('ENABLE ROW LEVEL SECURITY'), 'Offline signing keys are stored in an RLS-protected table');
assert.ok(offlineEntitlementSigningMigration.includes('REVOKE ALL ON TABLE public.offline_entitlement_signing_keys FROM PUBLIC, anon, authenticated') && offlineEntitlementSigningMigration.includes('GRANT SELECT, INSERT ON TABLE public.offline_entitlement_signing_keys TO service_role'), 'Offline private signing keys cannot be read or written by client database roles');


assert.ok(offlineEntitlementCrypto.includes('OFFLINE_ENTITLEMENT_PUBLIC_KEY') && offlineEntitlementCrypto.includes('claims.userId !== expectedUserId') && offlineEntitlementCrypto.includes('signature.length !== 64'), 'Offline entitlement verifier pins the public key, account identity, and ECDSA signature size');
assert.ok(offlineQuestionCache.includes('JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY)') && offlineQuestionCache.includes("typeof value.token !== 'string'"), 'Legacy unsigned localStorage expiry records are not accepted as licenses');
assert.ok(licenseStore.includes("body: { action: 'offline-license' }") && licenseStore.includes('await saveOfflineEntitlements(session.user.id, offlineLicense.token)'), 'Online license refresh stores only a server-signed offline token');
assert.ok(licenseStore.includes('clearOfflineEntitlements(session.user.id)') && licenseStore.includes('await getOfflineEntitledTracks(session.user.id)'), 'Offline fallback verifies signed leases and clears stale leases on online authorization errors');

assert.ok(learningProgressTriggerMigration.includes('REVOKE ALL ON FUNCTION public.set_user_learning_progress_updated_at() FROM PUBLIC, anon, authenticated'), 'Trigger-only progress helper cannot be called directly by client roles');


const ephemeralSigningPair = await globalThis.crypto.subtle.generateKey(
  { name: 'ECDSA', namedCurve: 'P-256' },
  true,
  ['sign', 'verify']
);
const ephemeralPublicJwk = await globalThis.crypto.subtle.exportKey('jwk', ephemeralSigningPair.publicKey);
const base64Url = (bytes) => Buffer.from(bytes).toString('base64url');
const signOfflineClaims = async (claims) => {
  const payload = base64Url(Buffer.from(JSON.stringify(claims), 'utf8'));
  const signature = await globalThis.crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    ephemeralSigningPair.privateKey,
    Buffer.from(payload, 'utf8')
  );
  return payload + '.' + base64Url(new Uint8Array(signature));
};
const cryptoTestNow = Date.now();
const sampleClaims = {
  v: 1,
  userId: 'offline-license-test-user',
  issuedAt: cryptoTestNow,
  tracks: { DECK_OIC_NW: cryptoTestNow + 7 * 24 * 60 * 60 * 1000 }
};
const validOfflineToken = await signOfflineClaims(sampleClaims);
const validOfflineClaims = await verifyOfflineEntitlementToken(
  validOfflineToken,
  sampleClaims.userId,
  cryptoTestNow,
  ephemeralPublicJwk
);
assert.equal(validOfflineClaims?.tracks?.DECK_OIC_NW, sampleClaims.tracks.DECK_OIC_NW, 'A valid ECDSA-signed offline lease is accepted');
assert.equal(await verifyOfflineEntitlementToken(validOfflineToken, 'different-user', cryptoTestNow, ephemeralPublicJwk), null, 'Signed offline leases cannot be replayed across accounts');
const [validPayload, validSignature] = validOfflineToken.split('.');
const alteredClaims = { ...sampleClaims, tracks: { DECK_OIC_NW: cryptoTestNow + 365 * 24 * 60 * 60 * 1000 } };
const forgedExpiryToken = base64Url(Buffer.from(JSON.stringify(alteredClaims), 'utf8')) + '.' + validSignature;
assert.equal(await verifyOfflineEntitlementToken(forgedExpiryToken, sampleClaims.userId, cryptoTestNow, ephemeralPublicJwk), null, 'Editing a signed expiry invalidates the signature');
const expiredClaims = {
  v: 1,
  userId: sampleClaims.userId,
  issuedAt: cryptoTestNow - 60_000,
  tracks: { DECK_OIC_NW: cryptoTestNow - 1 }
};
const expiredToken = await signOfflineClaims(expiredClaims);
const expiredSignedClaims = await verifyOfflineEntitlementToken(expiredToken, sampleClaims.userId, cryptoTestNow, ephemeralPublicJwk);
assert.ok(expiredSignedClaims && expiredSignedClaims.tracks.DECK_OIC_NW <= cryptoTestNow, 'Signature verification does not make an expired track lease current');
const unsupportedClaims = { ...sampleClaims, tracks: { ALL: cryptoTestNow + 60_000 } };
const unsupportedToken = await signOfflineClaims(unsupportedClaims);
assert.equal(await verifyOfflineEntitlementToken(unsupportedToken, sampleClaims.userId, cryptoTestNow, ephemeralPublicJwk), null, 'Unknown entitlement track identifiers are rejected');


assert.ok(accountScreen.includes("status,granted_at,expires_at,renewed_at") && accountScreen.includes("function isCurrentLicense(item: OwnedTrack"), 'Account license display separates current access from past license records using entitlement status and expiry');
assert.ok(accountScreen.includes('Expired and revoked licenses') && accountScreen.includes("const revoked = item.status === 'revoked'"), 'Account page lists expired and revoked licenses transparently');
assert.ok(accountScreen.includes('EXPIRING SOON') && accountScreen.includes('purchase access again after this license expires'), 'Account page warns users before a license is about to expire without implying early renewal is available');
assert.ok(accountScreen.includes('This is an account-retention safeguard, not extra paid access.'), 'The retention grace period is not presented as extra paid-track access');


assert.ok(questionBank.includes('import { canAccessPaidTrack } from "./access.mjs";') && questionBank.includes('loadEntitlement(admin, user.id, track)'), 'Question-bank endpoint uses the shared tested access decision with an account-and-track-scoped entitlement lookup');
assert.ok(questionBankAccessModule.includes("entitlement.status !== 'active'") && questionBankAccessModule.includes("expiresAt > now") && questionBankAccessModule.includes("entitlement.user_id !== expectedUserId") && questionBankAccessModule.includes("entitlement.track_id !== expectedTrack"), 'Access helper requires an active, unexpired entitlement matching both account and track');
const accessNow = Date.UTC(2026, 0, 1);
const validEntitlement = {
  user_id: 'test-user-active',
  track_id: 'DECK_OIC_NW',
  status: 'active',
  expires_at: new Date(accessNow + 60_000).toISOString()
};
assert.equal(canAccessPaidTrack({ userId: null, isAdmin: false, entitlement: validEntitlement, track: 'DECK_OIC_NW', now: accessNow }), false, 'Signed-out requests are denied even if an entitlement-shaped object is supplied');
assert.equal(canAccessPaidTrack({ userId: 'test-user-free', isAdmin: false, entitlement: null, track: 'DECK_OIC_NW', now: accessNow }), false, 'Signed-in users without a license are denied paid-track access');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: validEntitlement, track: 'DECK_OIC_NW', now: accessNow }), true, 'A matching active unexpired license grants access to its own track');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: { ...validEntitlement, expires_at: new Date(accessNow).toISOString() }, track: 'DECK_OIC_NW', now: accessNow }), false, 'A license expiring at the current instant is not active');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: { ...validEntitlement, expires_at: new Date(accessNow - 1).toISOString() }, track: 'DECK_OIC_NW', now: accessNow }), false, 'Expired licenses are denied');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: { ...validEntitlement, status: 'revoked' }, track: 'DECK_OIC_NW', now: accessNow }), false, 'Revoked licenses are denied even when their recorded expiry is in the future');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: { ...validEntitlement, status: 'expired' }, track: 'DECK_OIC_NW', now: accessNow }), false, 'Entitlements marked expired are denied even with a future timestamp');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: { ...validEntitlement, expires_at: null }, track: 'DECK_OIC_NW', now: accessNow }), false, 'Licenses with a missing expiry fail closed');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: { ...validEntitlement, expires_at: 'not-a-date' }, track: 'DECK_OIC_NW', now: accessNow }), false, 'Licenses with an invalid expiry fail closed');
assert.equal(canAccessPaidTrack({ userId: 'someone-else', isAdmin: false, entitlement: validEntitlement, track: 'DECK_OIC_NW', now: accessNow }), false, 'Entitlements cannot be replayed across user IDs');
assert.equal(canAccessPaidTrack({ userId: 'test-user-active', isAdmin: false, entitlement: validEntitlement, track: 'GMDSS_GOC', now: accessNow }), false, 'A license for one track cannot unlock another track');
assert.equal(canAccessPaidTrack({ userId: 'test-user-admin', isAdmin: true, entitlement: null, track: 'DECK_OIC_NW', now: accessNow }), true, 'Server-recognized admin access bypasses per-track entitlements');
assert.equal(canAccessPaidTrack({ userId: null, isAdmin: true, entitlement: null, track: 'DECK_OIC_NW', now: accessNow }), false, 'Admin-shaped client inputs cannot grant access without an authenticated user');
assert.equal(canAccessPaidTrack({ userId: 'test-user-free', isAdmin: 'true', entitlement: null, track: 'DECK_OIC_NW', now: accessNow }), false, 'A non-boolean admin flag cannot grant access');


assert.ok(trackHubScreen.includes("getOfflineEntitlementExpiry(userId, info.trackId)") && trackHubScreen.includes("offlineLicenseExpiry && offlineLicenseExpiry > Date.now()"), 'Offline panel checks the signed per-track lease before claiming paid offline access is verified');
assert.ok(trackHubScreen.includes('DEVICE ONLINE') && trackHubScreen.includes('DEVICE OFFLINE') && trackHubScreen.includes('Last saved on this device'), 'Offline panel displays connection and last-saved state');
assert.ok(trackHubScreen.includes('Reconnect before expiry to refresh your license.') && trackHubScreen.includes('valid offline license could not be verified on this device'), 'Offline panel explains the license expiry and reconnect requirement without promising indefinite access');
assert.ok(trackHubScreen.includes("window.addEventListener('focus', refreshOfflineState)") && trackHubScreen.includes("window.addEventListener('online', updateOnline)"), 'Offline readiness refreshes when the app regains focus or connectivity');


assert.ok(ordersHistory.includes("order.status === 'failed' && order.payment_method === 'PayMongo Checkout'") && ordersHistory.includes("'Checkout not completed'"), 'Expired/failed PayMongo checkout is not mislabeled as a rejected manual payment');
assert.ok(ordersHistory.includes("'Awaiting PayMongo payment'") && ordersHistory.includes('PayMongo has not confirmed this payment yet.'), 'Pending PayMongo checkout status explains the unresolved payment and next safe action');
assert.ok(ordersHistory.includes('No license was activated from this checkout.') && ordersHistory.includes("order.status === 'failed'"), 'Failed or cancelled checkouts clearly explain that no access was granted and users can restart safely');
assert.ok(ordersHistory.includes('This manual payment submission was rejected.') && ordersHistory.includes("order.status === 'submitted'"), 'Manual payment rejection remains distinct from an expired hosted checkout');


const schedulerNow = 1_000_000;
assert.equal(nextExpiryRefreshDelay([schedulerNow + 10_000, schedulerNow + 5_000], schedulerNow), 5_250, 'Expiry scheduler chooses the nearest future entitlement and adds only a small post-expiry buffer');
assert.equal(nextExpiryRefreshDelay([schedulerNow - 1, 'invalid'], schedulerNow), null, 'Expired and malformed dates do not schedule a timer');
assert.equal(nextExpiryRefreshDelay([], schedulerNow), null, 'No entitlements means no expiry timer');
assert.equal(nextExpiryRefreshDelay([schedulerNow + 5_000_000_000], schedulerNow), MAX_EXPIRY_REFRESH_TIMEOUT_MS, 'Distant expiries are clamped below the browser maximum timeout and can be re-armed');
assert.equal(nextExpiryRefreshDelay([schedulerNow + 10_000], schedulerNow, 0), null, 'Invalid timeout bounds fail closed');
assert.ok(licenseStore.includes('scheduleEntitlementExpiryRefresh') && licenseStore.includes('entitlementExpiryRevision'), 'License store schedules expiry refresh and exposes a revision for dependent account UI');
assert.ok(accountScreen.includes('refreshAccount(true, false)') && accountScreen.includes('Preserve the last known license display during network outages'), 'Account expiry refresh is quiet and does not erase known license details on a temporary network failure');


const snapshotCryptoKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
const syntheticSnapshot = {
  sessionId: 'test-session',
  questions: [{ id: 'Q-1', track: 'DECK_OIC_NW', competenceId: 'C1', questionText: 'confidential synthetic question', options: ['Option A', 'Option B'], correctAnswerIndex: 1, topic: 'test', functionId: 'F1' }],
  answers: {}, currentIndex: 0, track: 'DECK_OIC_NW', competenceId: 'C1', part: null,
  mode: 'PRACTICE', isFreeSession: false, startedAt: 1, timeLimitSec: 0, timeLeftSec: 0, streak: 0, bestStreak: 0, finished: false
};
const encryptedSnapshot = await encryptJsonPayload(syntheticSnapshot, snapshotCryptoKey, new Uint8Array(12).fill(7));
assert.equal((await decryptJsonPayload(encryptedSnapshot.iv, encryptedSnapshot.ciphertext, snapshotCryptoKey)).questions[0].questionText, 'confidential synthetic question', 'Encrypted session snapshots round-trip');
assert.equal(new TextDecoder().decode(encryptedSnapshot.ciphertext).includes('confidential synthetic question'), false, 'Ciphertext does not expose the synthetic question text');
const tamperedSnapshotCiphertext = encryptedSnapshot.ciphertext.slice();
tamperedSnapshotCiphertext[0] ^= 1;
await assert.rejects(() => decryptJsonPayload(encryptedSnapshot.iv, tamperedSnapshotCiphertext, snapshotCryptoKey), { name: 'OperationError' }, 'Tampered session snapshots fail authenticated decryption');
assert.ok(sessionArchive.includes('DATABASE_VERSION = 2') && sessionArchive.includes('encryptJsonPayload') && sessionArchive.includes('decryptJsonPayload') && sessionArchive.includes('migrateLegacySnapshots'), 'Session archive encrypts records and migrates legacy plaintext snapshots');
assert.ok(!sessionArchive.includes("db.put('snapshots', { id, snapshot })"), 'Session archive never directly writes plaintext question snapshots');
assert.ok(!practiceStore.includes("localStorage.setItem('hyperion-saved-practice'") && practiceStore.includes('migrateLegacyLocalStorageSavedPractice') && practiceStore.includes('never load it directly'), 'Question-containing session snapshots are removed from new localStorage writes and legacy copies are migrated before restore');
assert.ok(practiceStore.includes('The saved question snapshot is unavailable'), 'Resume fails clearly when no encrypted session snapshot is available instead of loading raw question text');
const saveProgressStart = practiceStore.indexOf('saveProgress: async () => {');
const snapshotWritePosition = practiceStore.indexOf('await saveSessionSnapshot(snapshot.sessionId, snapshot)', saveProgressStart);
const historyWritePosition = practiceStore.indexOf('useHistoryStore.getState().saveSession({', saveProgressStart);
assert.ok(practiceStore.includes('saveProgress: () => Promise<boolean>') && snapshotWritePosition >= saveProgressStart && historyWritePosition > snapshotWritePosition, 'History is recorded only after the encrypted session snapshot is safely persisted');

const autoSaveStart = practiceStore.indexOf('function persistActiveSession(s: PracticeState) {');
const autoSaveWritePosition = practiceStore.indexOf('saveSessionSnapshot(snapshot.sessionId, snapshot)', autoSaveStart);
const autoSaveHistoryPosition = practiceStore.indexOf('useHistoryStore.getState().saveSession({', autoSaveStart);
assert.ok(autoSaveWritePosition >= autoSaveStart && autoSaveHistoryPosition > autoSaveWritePosition && practiceStore.includes('void saveSessionSnapshot(snapshot.sessionId, snapshot).then(() => {'), 'Automatic autosave records resumable History only after the encrypted snapshot write succeeds');
assert.ok(practiceStore.includes('Avoid resurrecting a History row after this session was reset or finished while saving'), 'Late autosaves do not restore History after a session has ended');

assert.ok(practiceStore.includes('await deleteSessionSnapshot(snapshot.sessionId).catch(() => undefined)'), 'A session snapshot is removed if its History metadata cannot be saved');
assert.ok(practiceQuizScreen.includes('saved = await saveProgress()') && practiceQuizScreen.includes('Your session is still open') && practiceQuizScreen.includes('disabled={savingProgress}'), 'Save failure keeps the user in the session and prevents duplicate save requests');
assert.ok(!practiceQuizScreen.includes('aria-label="Back">← Back'), 'The question screen has no redundant second Back button inside the question content');
assert.ok(app.includes('<path d="M6.75 4.25A1.75 1.75') && app.includes('aria-pressed={bookmarked}'), 'The question header uses a clean accessible outline bookmark SVG');
assert.ok(app.includes('viewBox="0 0 24 24" width="27" height="27" fill="currentColor"') && app.includes('aria-expanded={settingsOpen}'), 'The question header uses a clean accessible gear SVG for settings');
assert.ok(!app.includes("'♧'") && !app.includes('>⚙</button>'), 'Emoji-like bookmark and gear glyphs are not used in the question header');
assert.ok(vaultScreen.includes('const saved = await usePracticeStore.getState().saveProgress()') && vaultScreen.includes('Could not save this drill on the device'), 'Mistakes Vault drills do not navigate as though a failed save succeeded');
assert.ok(!practiceStore.includes("localStorage.setItem('hyperion-saved-practice'") && practiceStore.includes('migrateLegacyLocalStorageSavedPractice') && practiceStore.includes('never load it directly'), 'Question-containing session snapshots are removed from new localStorage writes and legacy copies are migrated before restore');
assert.ok(practiceStore.includes('The saved question snapshot is unavailable'), 'Resume fails clearly when no encrypted session snapshot is available instead of loading raw question text');

assert.ok(app.includes("const PracticeQuizScreen = lazy(() => import('./screens/PracticeQuizScreen'))") && app.includes("const AdminQuestionBankScreen = lazy(() => import('./screens/AdminQuestionBankScreen'))"), 'Heavy learning and admin screens load as separate route chunks');
assert.ok(app.includes('<Suspense fallback=') && app.includes('Loading Hyperion…'), 'Lazy routes present an accessible loading fallback while a screen chunk loads');
assert.ok(app.includes('<RouteErrorBoundary>') && routeErrorBoundary.includes('role="alert"') && routeErrorBoundary.includes('window.location.reload()') && routeErrorBoundary.includes('Reload Hyperion'), 'Failed lazy routes show an accessible recovery screen with a reload action');
assert.equal((app.match(/^import .* from '\.\/screens\//gm) || []).length, 0, 'Route screen components are not eagerly imported into the main application entry');

assert.ok(workflow.includes('uses: actions/checkout@v7') && workflow.includes('uses: actions/setup-node@v7'), 'CI uses GitHub Actions maintained for the current runner runtime');
assert.ok(workflow.includes('package-manager-cache: false') && workflow.includes('bun install --frozen-lockfile'), 'CI disables implicit npm caching and installs only from the frozen Bun lockfile');


const serializedBookmarks = JSON.stringify({ state: { items: [{ questionText: 'bookmark only synthetic question', options: ['A', 'B'], correctAnswerIndex: 1 }] }, version: 0 });
const encryptedStoreValue = await encryptJsonPayload(serializedBookmarks, snapshotCryptoKey);
const decryptedStoreValue = await decryptJsonPayload(encryptedStoreValue.iv, encryptedStoreValue.ciphertext, snapshotCryptoKey);
assert.equal(JSON.parse(decryptedStoreValue).state.items[0].questionText, 'bookmark only synthetic question', 'Encrypted Zustand storage payload round-trips');
assert.equal(new TextDecoder().decode(encryptedStoreValue.ciphertext).includes('bookmark only synthetic question'), false, 'Encrypted store values do not expose bookmarked question text');
assert.ok(bookmarksStore.includes("storage: createJSONStorage(() => encryptedPersistStorage)") && bookmarksStore.includes("name: 'hyperion-bookmarks'"), 'Bookmarks preserve their existing persisted key while switching to encrypted storage');
assert.ok(vaultStore.includes("storage: createJSONStorage(() => encryptedPersistStorage)") && vaultStore.includes("name: 'hyperion-vault'"), 'Mistakes vault preserves its existing persisted key while switching to encrypted storage');
assert.ok(vaultStore.includes('purgePaidForTracks') && vaultStore.includes('isFreeSession === true') && app.includes('useVaultStore.getState().purgePaidForTracks([track])'), 'Paid mistake-vault entries are removed when their track entitlement expires');
assert.ok(vaultScreen.includes('authorizeQuestionSet') && vaultScreen.includes('entitlementsVerified') && vaultScreen.includes('isFreeSession === true'), 'Vault hides paid cached question text without an active entitlement and validates free-sample candidates');
assert.ok(practiceStore.includes('addMistake(q, answer.selectedIndex, s.isFreeSession)') && practiceStore.includes('addMistake(q, index, isFreeSession)'), 'Mistake vault records whether a mistake came from a permitted free session');
assert.ok(encryptedPersistStorage.includes("await db.put('entries', { id: name, ...encrypted })") && encryptedPersistStorage.includes('Remove the cleartext copy only after the encrypted record is safely committed'), 'Legacy localStorage is migrated to encrypted IndexedDB before being removed');
assert.ok(encryptedPersistStorage.includes('Do not write an unencrypted fallback'), 'Encrypted storage never introduces a new plaintext fallback');
assert.ok((encryptedPersistStorage.match(/removeLegacyValue\(name\)/g) || []).length >= 4 && encryptedPersistStorage.includes('Once the encrypted copy is verified, remove any stale cleartext'), 'Verified encrypted reads and successful writes clean up stale plaintext persistence keys');
const serialQueue = createSerialAsyncQueue();
const queueOrder = [];
let releaseFirstWrite;
const firstWriteGate = new Promise((resolve) => { releaseFirstWrite = resolve; });
const queuedFirst = serialQueue(async () => { queueOrder.push('first-start'); await firstWriteGate; queueOrder.push('first-end'); });
const queuedSecond = serialQueue(async () => { queueOrder.push('second'); });
const queuedFailure = serialQueue(async () => { throw new Error('synthetic queue failure'); }).catch(() => undefined);
const queuedAfterFailure = serialQueue(async () => { queueOrder.push('after-failure'); });
releaseFirstWrite();
await Promise.all([queuedFirst, queuedSecond, queuedFailure, queuedAfterFailure]);
assert.deepEqual(queueOrder, ['first-start', 'first-end', 'second', 'after-failure'], 'Encrypted state operations preserve invocation order and continue after a failed operation');
assert.ok(encryptedPersistStorage.includes('createSerialAsyncQueue') && encryptedPersistStorage.includes('queueStorageOperation(async () =>'), 'Encrypted IndexedDB reads, writes, and removals share a serialized operation queue');



assert.ok(progressSyncSource.includes("storage['hyperion-bookmarks'] = JSON.stringify") && progressSyncSource.includes("storage['hyperion-vault'] = JSON.stringify"), 'Cloud progress snapshots include live bookmarks and mistakes from encrypted IndexedDB-backed stores');
assert.ok(progressSyncSource.includes('await writeEncryptedPersistedValue(key, value)') && progressSyncSource.includes('await removeEncryptedPersistedValue(key)'), 'Cloud restore writes bookmarks and mistakes back to encrypted IndexedDB before rehydrating stores');
assert.ok(progressSyncSource.includes('await writeEncryptedPersistedValue(accountCacheKey(ownerBeforeLoad)') && progressSyncSource.includes('await readEncryptedPersistedValue(accountCacheKey(userId))'), 'Account-switch recovery caches are encrypted rather than stored as question text in localStorage');
assert.ok(progressSyncSource.includes('migrateLegacyProgressCaches') && progressSyncSource.includes("key.startsWith('hyperion-progress-cache:')"), 'Legacy plaintext account progress caches are migrated into encrypted storage');
assert.ok(encryptedPersistStorage.includes('export function readEncryptedPersistedValue') && encryptedPersistStorage.includes('export function writeEncryptedPersistedValue'), 'Encrypted storage exposes a shared bridge for cloud progress restoration');


assert.ok(questionBank.includes('authorize-saved-questions') && questionBank.includes('allowedIndexes') && questionBank.includes('freeQuestionFingerprints'), 'Saved question collections can be filtered by current paid access or verified free-sample fingerprints');
assert.ok(learningProgressFunction.includes("admin.from('user_learning_progress')") && learningProgressFunction.includes("body.action === 'read'") && learningProgressFunction.includes("body.action === 'write'"), 'Progress reads and writes go through an authenticated server function');
assert.ok(learningProgressFunction.includes("client.functions.invoke('question-bank'") && learningProgressFunction.includes('sanitizeSnapshot'), 'Progress server responses are filtered through the protected question-bank authorization service');
assert.ok(learningProgressFunction.includes("req.headers.get('content-length')") && learningProgressFunction.includes('Number(declaredLength) > maxBytes'), 'Learning progress rejects oversized declared request bodies before reading them');
assert.ok(learningProgressFunction.includes('if (declaredLength && /^\\d+$/.test(declaredLength)'), 'Learning progress validates Content-Length as decimal digits before applying the early size check');
assert.ok(learningProgressFunction.includes('req.body?.getReader()') && learningProgressFunction.includes('totalBytes > maxBytes'), 'Learning progress enforces the UTF-8 byte limit while streaming request data');
assert.ok(learningProgressFunction.includes('error instanceof PayloadTooLargeError'), 'Oversized streamed payloads return HTTP 413 rather than a generic parsing error');
assert.ok(progressSyncSource.includes("functions.invoke('learning-progress'") && !progressSyncSource.includes(".from(TABLE)"), 'The browser no longer directly reads or writes user_learning_progress');
assert.ok(functionConfig.includes('[functions.learning-progress]') && functionConfig.includes('verify_jwt = true'), 'Learning progress endpoint requires a valid JWT');


assert.ok(progressPrivilegeMigration.includes('revoke all privileges on table public.user_learning_progress from PUBLIC, anon, authenticated') && progressPrivilegeMigration.includes('grant all privileges on table public.user_learning_progress to service_role'), 'Direct browser privileges are revoked while service-role access is retained');
assert.ok(progressPrivilegeMigration.includes('alter table public.user_learning_progress enable row level security') && progressPrivilegeMigration.includes('drop policy if exists "Users can read their own learning progress"'), 'Learning progress remains RLS-enabled without direct per-user JSON read policies');


const completePackManifest = {
  track: 'DECK_OIC_NW',
  freeOnly: false,
  questionCount: 3,
  groupCount: 2,
  complete: true
};
const completePackRecords = [
  { id: 'DECK_OIC_NW:licensed:C1:all', track: 'DECK_OIC_NW', freeOnly: false, questionCount: 2 },
  { id: 'DECK_OIC_NW:licensed:C2:all', track: 'DECK_OIC_NW', freeOnly: false, questionCount: 1 }
];
assert.equal(isOfflinePackSetComplete(completePackManifest, completePackRecords), true, 'A complete offline pack set passes manifest and group integrity validation');
assert.equal(isOfflinePackSetComplete(completePackManifest, completePackRecords.slice(0, 1)), false, 'Missing IndexedDB question groups invalidate the offline pack');
assert.equal(isOfflinePackSetComplete({ ...completePackManifest, questionCount: 4 }, completePackRecords), false, 'Mismatched manifest question totals invalidate the offline pack');
assert.equal(isOfflinePackSetComplete({ ...completePackManifest, complete: false }, completePackRecords), false, 'Interrupted offline downloads cannot be treated as complete packs');
const freeDeckManifest = { ...completePackManifest, track: 'DECK_OIC_NW', freeOnly: true, sampleVersion: 2 };
const freeDeckPacks = completePackRecords.map(pack => ({ ...pack, id: pack.id.replace('licensed', 'free'), freeOnly: true }));
assert.equal(isOfflinePackSetComplete({ ...freeDeckManifest, sampleVersion: undefined }, freeDeckPacks), false, 'Legacy Deck OIC free samples with an outdated shuffle rule are not trusted');
assert.equal(isOfflinePackSetComplete(freeDeckManifest, freeDeckPacks), true, 'New server-matched Deck OIC free sample manifests pass integrity validation');
assert.equal(isGmdssFreeSampleQuestion({ id: 'G-C1-P10-090' }), true, 'GMDSS C1 part 10 free-sample boundary is accepted');
assert.equal(isGmdssFreeSampleQuestion({ id: 'G-C1-P10-091' }), false, 'GMDSS C1 cannot expose questions beyond the 90-question free quota for a part');
assert.equal(isGmdssFreeSampleQuestion({ id: 'G-C2-P2-065' }), true, 'GMDSS C2 part 2 free-sample boundary is accepted');
assert.equal(isGmdssFreeSampleQuestion({ id: 'G-C2-P2-066' }), false, 'GMDSS C2 cannot expose questions beyond the 65-question free quota for a part');
assert.equal(isGmdssFreeSampleQuestion({ id: 'G-C2-P3-001' }), false, 'GMDSS free-sample validation rejects out-of-range source parts');
assert.ok(offlineQuestionCache.includes('isGmdssFreeSampleQuestion(question)'), 'Offline GMDSS packs are checked against server-defined per-part free quotas before use');
assert.ok(questionBankClient.includes("for (let part = 1; part <= 10; part++) sample.push(...byPart('C1', part).slice(0, 90))") && questionBankClient.includes("for (let part = 1; part <= 2; part++) sample.push(...byPart('C2', part).slice(0, 65))"), 'GMDSS free packs derived from a paid download follow the exact server quotas for every source part');
assert.equal(isOfflinePackSetComplete(completePackManifest, completePackRecords.map(pack => ({ ...pack, track: 'GMDSS_GOC' }))), false, 'Question packs from another track cannot satisfy a manifest');
assert.equal(isOfflinePackSetComplete(completePackManifest, [completePackRecords[0], completePackRecords[0]]), false, 'Duplicate IndexedDB pack IDs cannot satisfy a pack manifest');
assert.ok(offlineQuestionCache.includes('isOfflinePackSetComplete(manifest, metadata)'), 'Offline reads verify that manifest totals and lightweight pack metadata still agree after storage eviction');
assert.ok(offlineQuestionCache.includes('saveOfflineQuestionPackSets') && offlineQuestionCache.includes("db.transaction(['packs', 'packMeta', 'manifests'], 'readwrite')"), 'Question packs, their lightweight metadata, and manifests commit in one IndexedDB transaction');
assert.ok(questionBankClient.includes('await saveOfflineQuestionPackSets(updates)') && questionBankClient.includes('Keep any existing complete pack usable'), 'Failed offline downloads preserve the last complete question pack until an atomic replacement is ready');
assert.ok(questionBankClient.includes('export async function ensureOfflineFreeSamplePack') && questionBankClient.includes('const fullBank = await getOfflineQuestionsByTrack(track, false)') && questionBankClient.includes('freeSample(fullBank, track)'), 'An old Deck OIC offline free sample is repaired only from the complete cached bank and the current server-matched sampler');
assert.ok(questionBankClient.includes('async function hasValidOfflineTrackLease(track: TrackId): Promise<boolean>') && questionBankClient.includes('const expiry = await offlineEntitlementExpiry(track)') && questionBankClient.includes('expiry > Date.now()'), 'Saved paid-session recovery requires an unexpired server-signed lease for the same user and track');
const accessQuestionSetStart = questionBankClient.indexOf('export async function authorizeQuestionSetAccess');
const offlineAuthStart = questionBankClient.indexOf('if (offline) {', accessQuestionSetStart);
const offlineAuthEnd = questionBankClient.indexOf('\n\n  if (supabase)', offlineAuthStart);
const offlineAuthBlock = questionBankClient.slice(offlineAuthStart, offlineAuthEnd);
const paidLeaseFastPath = questionBankClient.indexOf('if (offline && await hasValidOfflineTrackLease(track)) return \'licensed\'', accessQuestionSetStart);
const fingerprintWorkStart = questionBankClient.indexOf('const fingerprintResults = await Promise.all(questions.map(fingerprintQuestion))', accessQuestionSetStart);
assert.ok(paidLeaseFastPath > accessQuestionSetStart && fingerprintWorkStart > paidLeaseFastPath && offlineAuthBlock.includes('matchesCachedPack(true)'), 'Paid offline sessions check the signed lease before expensive hashing, while unlicensed sessions are still matched to the official free sample');
assert.ok(offlineQuestionCache.includes("const DB_VERSION = 3") && offlineQuestionCache.includes('packMeta: { key: string; value: StoredOfflineQuestionPackMetadata }') && offlineQuestionCache.includes('MAX_DECRYPTED_PACK_CACHE'), 'Offline cache uses a lightweight metadata store and a bounded decrypted-pack cache');
const localCompetenceStart = offlineQuestionCache.indexOf('export async function getOfflineQuestionsByCompetence(');
const localCompetenceEnd = offlineQuestionCache.indexOf('export async function getOfflineQuestionsByTrack(', localCompetenceStart);
const localCompetenceReader = offlineQuestionCache.slice(localCompetenceStart, localCompetenceEnd);
assert.ok(localCompetenceReader.includes('getValidatedPackMetadata') && localCompetenceReader.includes("validated.db.get('packs', meta.id)") && !localCompetenceReader.includes('getOfflineQuestionPacks(track, freeOnly)'), 'Offline competence loading decrypts only the selected competence/part rather than every pack for the track');
assert.ok(questionBankClient.includes('const status = await getOfflinePackStatus(track, true)') && questionBankClient.includes('status?.complete && status.sampleVersion === 2'), 'A validated free pack skips the expensive repair/full-bank scan on every question load');
assert.ok(practiceStore.includes("if (typeof navigator === 'undefined' || navigator.onLine !== false)") && practiceStore.includes('await useLicenseStore.getState().refreshCloudEntitlements()'), 'Resuming saved sessions skips network entitlement refresh while offline');
assert.ok(questionFingerprintSource.includes('fingerprintCache.get(question)') && questionFingerprintSource.includes('fingerprintCache.set(question'), 'Repeated saved-session fingerprint checks reuse cached hashes for the same in-memory question objects');
const fallbackStart = questionBankClient.indexOf('// Safari/iOS and installed PWAs can report online while the API is unreachable.');
const fallbackBlock = questionBankClient.slice(fallbackStart, questionBankClient.indexOf('const freeQuestions = await getQuestionsByTrack(track, true);', fallbackStart));
assert.ok(fallbackBlock.indexOf('hasValidOfflineTrackLease(track)') >= 0 && fallbackBlock.indexOf("matchesCachedPack(true)") > fallbackBlock.indexOf('hasValidOfflineTrackLease(track)'), 'The same safe licensed-bank fallback applies when a browser reports online but the API is unreachable');
assert.ok(questionBankClient.includes('new JavaRandom(2065 + Number(compId.slice(1)) * 31)') && questionBank.includes('javaShuffle(valid, 2065 + Number(comp) * 31)'), 'Locally retained Deck OIC-NW free samples use the same deterministic per-competence selection as the protected server bank');
assert.ok(questionBankClient.includes("id: question.id.replace(/-\\d+$/") && questionBankClient.includes("String(index + 1).padStart(3, '0')"), 'Locally generated shuffled Deck OIC-NW free samples receive the same sequential question IDs as the protected server sample');
assert.ok(offlinePwaConfig.includes('jpg,jpeg,webp,avif') && offlinePwaConfig.includes('google-fonts-webfonts'), 'The service worker precaches bundled image formats and caches webfont assets for offline screens');
assert.ok(topLoadingIndicator.includes('src="/logo.png"') && !topLoadingIndicator.includes('/logo.png?'), 'The loading indicator uses the exact local image URL that the service worker precaches');
assert.ok(app.includes('OFFLINE MODE') && app.includes('Only downloaded question packs and saved sessions are available'), 'All routes clearly explain what remains available without a connection');
assert.ok(searchScreen.includes('Download the full question bank for this track before using Search offline') || questionBankClient.includes('Download the full question bank for this track before using Search offline'), 'Offline Search gives a clear download requirement instead of reporting a false zero-result search');
assert.ok(flashcardsScreen.includes('Download the full question bank for this track before using flashcards offline') || questionBankClient.includes('Download the full question bank for this track before using flashcards offline'), 'Offline Flashcards explains when the full bank must be downloaded first');
assert.ok(questionBank.includes('body.action === "content-versions"') && questionBank.includes('fullHash') && questionBank.includes('freeHash') && questionBank.includes('crypto.subtle.digest("SHA-256"'), 'The protected server exposes per-source content hashes without returning private question text');
assert.ok(questionBankClient.includes("body: { action: 'content-versions', track }") && questionBankClient.includes('checkOfflineQuestionPackUpdates') && questionBankClient.includes('changedVersionPaths'), 'The client compares downloaded source versions against current protected bank hashes');
assert.ok(offlineQuestionCache.includes('sourceVersions?: Record<string, string>') && offlineQuestionCache.includes('lastKnownUpdateState') && offlineQuestionCache.includes('recordOfflinePackVersionCheck'), 'Offline manifests persist per-source download versions and the last verified update state');
assert.ok(questionBankClient.includes('const versionsBefore = await fetchRemoteQuestionBankVersions(track)') && questionBankClient.includes('const versionsAfter = await fetchRemoteQuestionBankVersions(track)') && questionBankClient.includes('The question bank changed while downloading'), 'Question downloads verify the bank did not change during transfer before committing a fully updated manifest');
assert.ok(trackHubScreen.includes('FULLY UPDATED') && trackHubScreen.includes('UPDATE AVAILABLE') && trackHubScreen.includes('checkOfflineQuestionPackUpdates') && !trackHubScreen.includes('UPDATE OFFLINE QUESTION PACK'), 'Track page shows verified FULLY UPDATED or UPDATE AVAILABLE states instead of a confusing always-update button');
const offlineUpdateButtonStart = trackHubScreen.indexOf('<button', trackHubScreen.indexOf('OFFLINE ACCESS'));
const offlineUpdateButtonEnd = trackHubScreen.indexOf('</button>', offlineUpdateButtonStart);
const offlineUpdateButton = trackHubScreen.slice(offlineUpdateButtonStart, offlineUpdateButtonEnd);
assert.ok(offlineUpdateButton.includes("'FULLY UPDATED'") && offlineUpdateButton.includes("disabled={") && offlineUpdateButton.includes("offlineUpdateCheck.status === 'current'"), 'A downloaded pack that matches the latest bank displays a disabled FULLY UPDATED button');
assert.ok(offlineUpdateButton.includes("offlineUpdateCheck.status === 'available'") && offlineUpdateButton.includes("void startOfflineDownload()"), 'The question pack download action is only started when the user has no pack or an update is actually available');
assert.ok(offlineUpdateButton.includes("'UPDATE AVAILABLE · RECONNECT'") && offlineUpdateButton.includes("'FULLY UPDATED · LAST CHECK'"), 'Offline track pages show the last verified state and never offer an update download without connectivity');


assert.ok(
  checkout.includes("function isMissingGooglePlayEntitlementsTable(error: unknown)") &&
    checkout.includes("if (website.error || (play.error && !playTableMissing))") &&
    checkout.includes("!playTableMissing && play.data?.status === 'active'"),
  'PayMongo checkout remains usable before the Play migration while still rejecting other license-query errors'
);
assert.ok(
  submitManualPaymentFunction.includes("function isMissingGooglePlayEntitlementsTable(error: unknown)") &&
    submitManualPaymentFunction.includes("activePlayResult.error && !playTableMissing") &&
    submitManualPaymentFunction.includes("playTableMissing ? null : activePlayResult.data"),
  'Manual-payment submissions remain usable before the Play migration while still rejecting other license-query errors'
);
assert.ok(
  licenseStore.includes("candidate.code !== 'PGRST205'") &&
    licenseStore.includes("message.includes('google_play_entitlements')") &&
    licenseStore.includes("message.includes('schema cache')"),
  'Only a confirmed PostgREST missing-table response for google_play_entitlements is treated as an optional table'
);
assert.ok(
  licenseStore.includes('const errorStatus = websiteResult.error ? websiteResult.status : playResult.status') &&
    licenseStore.includes('canUseOfflineEntitlementsAfterError(error, errorStatus)') &&
    licenseStore.includes("if (typeof candidate?.code === 'string' && candidate.code.trim() !== '') return false") &&
    licenseStore.indexOf("if (typeof candidate?.code === 'string' && candidate.code.trim() !== '') return false") <
      licenseStore.indexOf("if (typeof navigator !== 'undefined' && navigator.onLine === false)"),
  'Coded authorization/database errors fail closed before offline fallback is considered'
);
assert.ok(
  licenseStore.includes('const error = websiteResult.error || (playTableMissing ? null : playResult.error)') &&
    licenseStore.includes('(playTableMissing ? [] : (playResult.data ?? []))'),
  'Missing optional Google Play table does not block website-license reads, while website query errors remain enforced'
);

assert.ok(googlePlayLinkFunction.includes("if (req.method === 'OPTIONS') return json(req, { ok: true })"), 'Google Play linking preflight responses use the same origin-aware CORS helper as normal responses');
assert.ok(googlePlayLinkFunction.includes("'http://localhost:5173'") && googlePlayLinkFunction.includes("'http://127.0.0.1:5173'"), 'Google Play linking CORS supports the documented local development origins');
assert.ok(
  accountScreen.includes("candidate.code !== 'PGRST205'") &&
    accountScreen.includes("message.includes('google_play_entitlements')") &&
    accountScreen.includes("message.includes('schema cache')"),
  'Account license display ignores only the exact missing optional Google Play table response'
);
assert.ok(
  accountScreen.includes('const entitlementError = entitlements.error || (playTableMissing ? null : playEntitlements.error)') &&
    accountScreen.includes('(playTableMissing ? [] : (playEntitlements.data ?? []))'),
  'A missing Google Play table does not hide existing website licenses in the Account page'
);
assert.ok(
  accountRetentionFunction.includes("function isMissingGooglePlayEntitlementsTable(error: unknown)") &&
    accountRetentionFunction.includes("candidate.code !== 'PGRST205'") &&
    accountRetentionFunction.includes("message.includes('google_play_entitlements')") &&
    accountRetentionFunction.includes("message.includes('schema cache')"),
  'Account-retention cleanup recognizes only the exact missing optional Google Play table response'
);
assert.ok(
  accountRetentionFunction.includes('if (result.error && !playTableMissing)') &&
    accountRetentionFunction.includes('if (playTableMissing || rows.length < PAGE_SIZE) break') &&
    accountRetentionFunction.includes('freshPlayEntitlements.error && !freshPlayTableMissing') &&
    accountRetentionFunction.includes('freshPlayTableMissing ? [] : ((freshPlayEntitlements.data || []) as Entitlement[])'),
  'Account retention stays operational before the Play migration while failing closed on other entitlement-query errors'
);
assert.ok(
  adminLicenseManagement.includes("function isMissingGooglePlayEntitlementsTable(error: unknown)") &&
    adminLicenseManagement.includes("if (result.error && !playTableMissing)") &&
    adminLicenseManagement.includes("playError && !isMissingGooglePlayEntitlementsTable(playError)"),
  'Admin website license management remains available before the Play table migration and still fails closed on other query errors'
);
assert.ok(
  questionBank.includes('function isMissingGooglePlayEntitlementsTable(error: unknown)') &&
    questionBank.includes('candidate.code !== "PGRST205"') &&
    questionBank.includes('message.includes("google_play_entitlements")') &&
    questionBank.includes('message.includes("schema cache")'),
  'Protected question-bank licensing recognizes only the exact missing optional Google Play table response'
);
assert.ok(
  questionBank.includes('if (website.error || (play.error && !playTableMissing))') &&
    questionBank.includes('playTableMissing ? null : play.data') &&
    questionBank.includes('playTableMissing ? [] : (play.data ?? [])'),
  'Website paid-track authorization and signed offline-license issuance remain compatible before the Google Play migration, while other query errors fail closed'
);
assert.ok(googlePlayLinkFunction.includes("userClient.auth.getUser()"), 'Google Play purchase linking requires a verified authenticated Hyperion user');
assert.ok(googlePlayLinkFunction.includes("admin.rpc('sync_google_play_subscription_atomic'") && !googlePlayLinkFunction.includes('upsertPlayEntitlement'), 'The verified link endpoint reconciles the whole subscription in one database transaction');
const atomicRpcStart = googlePlayLinkMigration.indexOf('CREATE OR REPLACE FUNCTION public.sync_google_play_subscription_atomic(');
const atomicRpcEnd = googlePlayLinkMigration.indexOf('REVOKE ALL ON FUNCTION public.sync_google_play_subscription_atomic(', atomicRpcStart);
const atomicRpcSource = googlePlayLinkMigration.slice(atomicRpcStart, atomicRpcEnd);
assert.ok(atomicRpcStart >= 0 && atomicRpcEnd > atomicRpcStart && atomicRpcSource.includes('ON CONFLICT (purchase_token_sha256) DO UPDATE') && atomicRpcSource.includes('user_id = EXCLUDED.user_id'), 'Atomic reconciliation checks token ownership on concurrent account-link attempts');
const dollarChar = String.fromCharCode(36);
const dollarQuote = dollarChar.repeat(2);
assert.ok(atomicRpcSource.includes('jsonb_array_elements(p_entitlements)') && atomicRpcSource.includes("current_entitlement.status <> 'revoked'") && !atomicRpcSource.includes('granted_at'), 'Atomic reconciliation retires stale track grants while preserving original grant timestamps');
assert.ok(atomicRpcSource.includes("AS " + dollarQuote + "\nDECLARE") && atomicRpcSource.includes("p_purchase_token_sha256 !~ '^[0-9a-f]{64}" + dollarChar + "'") && atomicRpcSource.includes('OR p_expires_at IS NULL') && atomicRpcSource.includes('RETURN v_link_id;'), 'Atomic reconciliation SQL has complete dollar quoting, full SHA-256 validation, and expiry validation');
const rpcDefinitionCount = googlePlayLinkMigration.split('CREATE OR REPLACE FUNCTION public.sync_google_play_subscription_atomic(').length - 1;
const rpcExpiryGuardCount = googlePlayLinkMigration.split('OR p_expires_at IS NULL').length - 1;
assert.ok(rpcDefinitionCount === 1 && rpcExpiryGuardCount === 1 && atomicRpcSource.trimEnd().endsWith('END;' + String.fromCharCode(10) + dollarQuote + ';'), 'Migration contains exactly one complete atomic RPC with one expiry guard and a proper closing delimiter');
const schemaAtomicRpcStart = googlePlaySchema.indexOf('CREATE OR REPLACE FUNCTION public.sync_google_play_subscription_atomic(');
const schemaAtomicRpcEnd = googlePlaySchema.indexOf('REVOKE ALL ON FUNCTION public.sync_google_play_subscription_atomic(', schemaAtomicRpcStart);
const schemaAtomicRpcSource = googlePlaySchema.slice(schemaAtomicRpcStart, schemaAtomicRpcEnd).trim();
assert.equal(schemaAtomicRpcSource, atomicRpcSource.trim(), 'The consolidated local schema and migration contain the same atomic RPC definition');
assert.ok(googlePlayRtdnFunction.includes('jwtVerify') && googlePlayRtdnFunction.includes('createRemoteJWKSet') && googlePlayRtdnFunction.includes('https://www.googleapis.com/oauth2/v3/certs'), 'RTDN authenticates Google Pub/Sub push tokens with Google signing keys');
assert.ok(googlePlayRtdnFunction.includes("GOOGLE_PLAY_PUBSUB_AUDIENCE") && googlePlayRtdnFunction.includes("GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL") && googlePlayRtdnFunction.includes('payload.email_verified === true'), 'RTDN validates the configured exact audience and verified service-account email');
assert.ok(googlePlayRtdnFunction.includes("notification?.packageName !== PACKAGE_NAME") && googlePlayRtdnFunction.includes('purchases/subscriptionsv2/tokens/'), 'RTDN checks the Android package and rereads current subscription state from Google Play');
assert.ok(googlePlayRtdnFunction.includes("if (!link) return respond(204)") && googlePlayRtdnFunction.includes("admin.rpc('sync_google_play_subscription_atomic'"), 'RTDN cannot create a new account association and uses the atomic entitlement reconciler for known tokens');
assert.ok(functionConfig.includes('[functions.google-play-rtdn]\nverify_jwt = false'), 'RTDN disables Supabase-JWT gateway checks because its handler verifies the Google OIDC bearer token itself');

assert.ok(googlePlayLinkFunction.includes("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") && googlePlayLinkFunction.includes("purchases/subscriptionsv2/tokens/"), 'Google Play tokens are checked against the Android Publisher API from the server');
assert.ok(googlePlayLinkFunction.includes("purchase_token_sha256") && googlePlayLinkFunction.includes("existing.user_id !== user.id"), 'Google Play purchase tokens are uniquely fingerprinted and cannot be claimed by a second Hyperion account');
assert.ok(googlePlayLinkFunction.includes("if (prior && prior.user_id !== user.id)") && googlePlayLinkFunction.includes("p_prior_purchase_link_id: priorPurchaseLink?.id ?? null") && googlePlayLinkMigration.includes("WHERE id = p_prior_purchase_link_id") && googlePlayLinkMigration.includes("AND user_id = p_user_id"), 'Replacement tokens retire prior grants only when the prior link belongs to the same Hyperion account');
assert.ok(
  googlePlayLinkMigration.includes("subscription_state = 'SUBSCRIPTION_STATE_REPLACED'") &&
    googlePlayLinkMigration.includes("A replaced Google Play purchase token cannot be linked again") &&
    googlePlayLinkFunction.includes("existing?.subscription_state === 'SUBSCRIPTION_STATE_REPLACED'") &&
    googlePlayRtdnFunction.includes("if (link.subscription_state === 'SUBSCRIPTION_STATE_REPLACED') return respond(204)") &&
    googlePlayLinkMigration.includes("public.google_play_purchase_links"),
  'Replaced predecessor tokens cannot be re-linked or reactivated by late RTDN notifications'
);
assert.ok(googlePlayLinkFunction.includes("'SUBSCRIPTION_STATE_ACTIVE'") && googlePlayLinkFunction.includes("'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'") && googlePlayLinkFunction.includes("'SUBSCRIPTION_STATE_CANCELED'") && googlePlayLinkFunction.includes("maxExpiry > now"), 'Google Play access is tied to an allowed subscription state and a future verified expiry');
assert.ok(googlePlayLinkMigration.includes("REVOKE ALL ON TABLE public.google_play_purchase_links FROM PUBLIC, anon, authenticated") && googlePlayLinkMigration.includes("REVOKE ALL ON TABLE public.google_play_entitlements FROM PUBLIC, anon, authenticated"), 'Google Play raw purchase tokens and entitlement writes are not exposed to browser roles');
assert.ok(googlePlayLinkMigration.includes('CREATE POLICY "Users read own Google Play entitlements"') && googlePlayLinkMigration.includes("USING ((SELECT auth.uid()) = user_id)"), 'Signed-in users can read only their own Google Play track entitlements');
assert.ok(googlePlayLinkMigration.includes("SET search_path = ''") && googlePlayLinkMigration.includes("REVOKE ALL ON FUNCTION public.revoke_google_play_entitlements_on_inactive_link() FROM PUBLIC, anon, authenticated"), 'The entitlement-revocation trigger uses a hardened function search path and restricted execution');
assert.ok(googlePlayLinkMigration.includes("CREATE TRIGGER google_play_link_inactive_revoke_entitlements") && googlePlayLinkMigration.includes("AFTER UPDATE OF status, expires_at, product_ids") && googlePlayLinkMigration.includes("NEW.status <> 'active'") && googlePlayLinkMigration.includes("AND status <> 'revoked'"), 'Inactive or expired Google Play links revoke all of their track entitlements in the database');
const adminMergeLoopStart = adminLicenseManagement.indexOf('for (const row of entitlements)')
const adminMergeLoopEnd = adminLicenseManagement.indexOf('const now = Date.now()', adminMergeLoopStart)
const adminMergeLoop = adminLicenseManagement.slice(adminMergeLoopStart, adminMergeLoopEnd)
assert.ok(
  adminLicenseManagement.indexOf('const retentionNow = Date.now()') >= 0 &&
    adminLicenseManagement.indexOf('const retentionNow = Date.now()') < adminMergeLoopStart &&
    adminMergeLoop.includes("effectiveStatus(previous, retentionNow)") &&
    !adminMergeLoop.includes("effectiveStatus(previous, now)"),
  'Admin license aggregation uses an initialized timestamp when merging duplicate product rows'
)
assert.ok(
  adminLicenseManagement.includes('has_active_google_play: hasActiveGooglePlay') &&
    adminLicenseManagement.includes("row.source === 'google_play' && rowActive") &&
    adminLicenses.includes('!license.has_active_google_play') &&
    adminLicenses.includes('license.has_active_google_play &&'),
  'Admin revocation controls are blocked only while a verified active Google Play entitlement exists, not merely because an old Play record exists'
)
assert.ok(googlePlayLinkMigration.includes("AND NOT (track_id = ANY(allowed_tracks))") && googlePlayLinkMigration.includes("'hyperion_all_access_pass' = ANY"), 'A changed verified product set atomically retires stale track grants while preserving all-access mapping');
assert.ok(googlePlaySchema.includes("CREATE TRIGGER google_play_link_inactive_revoke_entitlements") && googlePlaySchema.includes("AFTER UPDATE OF status, expires_at, product_ids") && googlePlaySchema.includes("AND NOT (track_id = ANY(allowed_tracks))"), 'The consolidated local schema includes the same Google Play entitlement reconciliation trigger');

console.log('Release-safety smoke checks passed.');
