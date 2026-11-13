import assert from 'node:assert/strict';
import { termPrices, legacyTermPrices, isAcceptedStoredPrice } from '../supabase/functions/_shared/paymentPrices.mjs';
import { readFile } from 'node:fs/promises';
import { nextExpiryRefreshDelay, MAX_EXPIRY_REFRESH_TIMEOUT_MS } from '../src/lib/entitlementExpiryScheduler.mjs';
import { encryptJsonPayload, decryptJsonPayload } from '../src/lib/jsonPayloadCrypto.mjs';
import { fingerprintQuestion } from '../src/lib/questionFingerprint.mjs';
import { isGmdssFreeSampleQuestion, isOfflinePackSetComplete } from '../src/lib/offlinePackIntegrity.mjs';
import { createSerialAsyncQueue } from '../src/lib/serializedAsyncQueue.mjs';

const workerDeployment = await readFile(new URL('../wrangler.toml', import.meta.url), 'utf8');
assert.match(workerDeployment, /^workers_dev\s*=\s*false\s*$/m, 'Production deployments must keep workers.dev disabled');
assert.match(workerDeployment, /^preview_urls\s*=\s*false\s*$/m, 'Production deployments must keep preview URLs disabled');

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  pricing, checkout, verify, webhook, questionBank, learningProgressFn, questionBankMigration,
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
  read('../supabase/functions/learning-progress/index.ts'),
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

const trackPurchaseDialog = await read('../src/components/TrackPurchaseDialog.tsx');
const bondStoreCardContent = await read('../src/components/BondStoreCardContent.tsx');
const bondStoreCardStyles = await read('../src/components/BondStoreCardContent.css');
const desktopAccountMenu = await read('../src/components/DesktopAccountMenu.tsx');
const bottomNav = await read('../src/components/BottomNav.tsx');
const pendingBuyNow = await read('../src/lib/pendingBuyNow.ts');
const oauthCallbackScreen = await read('../src/screens/OAuthCallbackScreen.tsx');
const paywallDialog = await read('../src/components/PaywallDialog.tsx');
const offlineQuestionCache = await read('../src/lib/offlineQuestionCache.ts');
const submitManualPaymentFunction = await read('../supabase/functions/submit-manual-payment/index.ts');
const googlePlayLinkFunction = await read('../supabase/functions/link-google-play-subscription/index.ts');
const googlePlayRtdnFunction = await read('../supabase/functions/google-play-rtdn/index.ts');
const googlePlayReconciliationFunction = await read('../supabase/functions/reconcile-google-play-subscriptions/index.ts');
const googlePlayLinkMigration = await read('../supabase/migrations/20261029184029_add_google_play_purchase_links.sql');
const googlePlayScheduleMigration = await read('../supabase/migrations/20261029184034_schedule_google_play_reconciliation.sql');
const googlePlaySchema = await read('../supabase/schema.sql');
const questionFingerprintSource = await read('../src/lib/questionFingerprint.mjs');
const offlinePwaConfig = await read('../vite.config.ts');
const encryptedPersistStorage = await read('../src/lib/encryptedPersistStorage.ts');
const progressSyncSource = await read('../src/lib/progressSync.ts');
const bookmarksStore = await read('../src/stores/bookmarksStore.ts');
const vaultStore = await read('../src/stores/vaultStore.ts');
const vaultScreen = await read('../src/screens/VaultScreen.tsx');
const bookmarksScreen = await read('../src/screens/BookmarksScreen.tsx');
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
const progressSnapshotComparisonMigration = await read('../supabase/migrations/20261031094513_add_low_egress_progress_snapshot_comparison.sql');
const cancelCheckout = await read('../supabase/functions/cancel-checkout/index.ts');
const offlineEntitlementCrypto = await read('../src/lib/offlineEntitlementCrypto.mjs');
const sessionArchive = await read('../src/lib/sessionArchive.ts');
const {
  verifyOfflineEntitlementToken,
  effectiveOfflineEntitlementNow,
  effectiveOfflineEntitlementNowMonotonic,
  anchorMonotonicOfflineEntitlementClock,
  resetMonotonicOfflineEntitlementClock,
  OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS
} = await import('../src/lib/offlineEntitlementCrypto.mjs');

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
  ['oic_nw', 29, 79, 499, 20, 50, 350],
  ['gmdss', 25, 59, 399, 15, 40, 250],
  ['engine_ew', 29, 79, 499, 20, 50, 350],
  ['deck_mgt', 59, 149, 999, 40, 100, 700],
  ['engine_mgt', 59, 149, 999, 40, 100, 700]
];
for (const [code, weekly, monthly, yearly, oldWeekly, oldMonthly, oldYearly] of terms) {
  assert.ok(
    pricing.includes(`code: '${code}'`) &&
    pricing.includes(`weeklyPrice: ${weekly}, monthlyPrice: ${monthly}, annualPrice: ${yearly}`),
    `Frontend catalogue has the canonical price for ${code}`
  );
  assert.deepEqual(termPrices[code], { week: weekly, month: monthly, year: yearly }, `Checkout server price for ${code}`);
  assert.deepEqual(legacyTermPrices[code], { week: oldWeekly, month: oldMonthly, year: oldYearly }, `Legacy prices preserved for ${code}`);
  for (const [term, current, previous] of [['week', weekly, oldWeekly], ['month', monthly, oldMonthly], ['year', yearly, oldYearly]]) {
    assert.ok(isAcceptedStoredPrice(code, term, current), `New paid order accepted: ${code}/${term}`);
    assert.ok(isAcceptedStoredPrice(code, term, previous), `Old paid order accepted: ${code}/${term}`);
    assert.equal(isAcceptedStoredPrice(code, term, current + 1), false, `Altered price rejected: ${code}/${term}`);
  }
  assert.ok(finalizerMigration.includes(`when '${code}' then case v_order.license_term`), `Database finalizer covers ${code}`);
}
for (const source of [checkout, verify, webhook, submitManualPaymentFunction]) {
  assert.ok(source.includes("from '../_shared/paymentPrices.mjs'"), 'All payment entrypoints use the shared price schedule');
}
assert.ok(checkout.includes('termPrices[code][termsByCode[code]]'), 'New PayMongo orders use the updated prices');
assert.ok(checkout.includes('body.expectedTotalPhp !== totalPrice'), 'Stale PWA price quote cannot create an unexpected new charge');
assert.ok(basketScreen.includes('expectedTotalPhp }'), 'PWA basket transmits the exact displayed quote to checkout');
assert.ok(submitManualPaymentFunction.includes('body.expectedAmountPhp !== prices[code][term]'), 'Manual endpoint rejects a stale quote before recording a transfer');
assert.ok(manualPayment.includes('expectedAmountPhp: licensePrice'), 'Manual payment submits the displayed amount for matching');
assert.ok(submitManualPaymentFunction.includes('const prices = termPrices'), 'New manual orders use the updated prices');
assert.ok(verify.includes('isAcceptedStoredPrice(') && webhook.includes('isAcceptedStoredPrice('), 'Payment verifiers accept historical recorded prices');
assert.equal(isAcceptedStoredPrice('made_up', 'week', 29), false, 'Unknown product price rejected');
assert.equal(isAcceptedStoredPrice('oic_nw', 'century', 29), false, 'Unknown duration rejected');
assert.equal(isAcceptedStoredPrice('oic_nw', 'week', NaN), false, 'NaN price rejected');
assert.equal(isAcceptedStoredPrice('oic_nw', 'week', 0), false, 'Free-price tampering rejected');
const priceMigration = await read('../supabase/migrations/20261113115708_accept_updated_paymongo_prices.sql');
assert.ok(priceMigration.includes('IF v_occurrences <> 2'), 'SQL migration refuses an unknown finalizer');
assert.ok(priceMigration.includes('EXECUTE replace(v_function, v_old_guard, v_new_guard)'), 'Migration updates both single and basket finalizer price checks');
for (const [code, weekly, monthly, yearly] of terms) {
  assert.ok(priceMigration.includes(`when '${code}' then case v_order.license_term when 'week' then ${weekly} when 'month' then ${monthly} when 'year' then ${yearly}`), `Database finalizer accepts updated ${code} prices`);
}

assert.match(questionBankMigration, /values\s*\('question-banks',\s*'question-banks',\s*false/i, 'Question bank bucket is private');
assert.match(questionBank, /\.auth\.getUser\(\)/, 'Question-bank validates supplied user tokens with Auth while preserving guest free-sample access');
assert.ok(
  learningProgressFn.includes('verifiedUserFromGateway(req)') &&
  learningProgressFn.includes("claims.role !== 'authenticated'") &&
  learningProgressFn.includes("claims.exp <= Date.now() / 1000"),
  'Progress endpoint trusts only gateway-verified, authenticated, unexpired JWT claims'
);
assert.match(questionBank, /FREE_FINGERPRINT_CACHE_TTL_MS/, 'Free-question authorization fingerprints expire or invalidate');
assert.ok(
  questionBank.includes('cachedQuestionCounts') &&
  questionBank.includes('question_bank_asset_counts') &&
  questionBank.includes('source_etag'),
  'Question counts persist across Edge isolates and invalidate when source assets change'
);
assert.ok(
  questionBank.includes('full_fingerprints') &&
  questionBank.includes('sameAssetVersions') &&
  questionBank.includes('question_bank_track_free_fingerprints'),
  'Free and full authorization fingerprints persist with source-version validation'
);
assert.match(finalizerMigration, /search_path|SECURITY DEFINER/i, 'Finalizer migration defines a database function');
assert.match(finalizerMigration, /service_role/i, 'Finalizer migration restricts execution to the service role');
assert.match(priceCorrectionMigration, /month.*then 40/i, 'GMDSS monthly price correction is tracked in a separate migration');
assert.match(functionConfig, /\[functions\.paymongo-webhook\]\s*verify_jwt = false/, 'Webhook uses provider signature verification, not Supabase user JWT');
assert.match(functionConfig, /\[functions\.question-bank\]\s*verify_jwt = false/, 'Question bank preserves publishable-key guest access and validates user tokens in the handler');
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
assert.ok(aboutScreen.includes('same email address') && aboutScreen.includes('does not link purchases') && aboutScreen.includes('transferred or combined automatically'), 'About page explains that license linking requires the same Hyperion account and does not transfer purchases');
assert.ok(termsScreen.includes('3.1 Google Play subscriptions (Android)') && termsScreen.includes('3.2 Website/PWA licenses'), 'Terms distinguish Play subscriptions from website fixed-term licenses');
assert.ok(termsScreen.includes('recognize eligible active entitlements from either source') && termsScreen.includes('do not automatically renew'), 'Terms explain account-based license linking and fixed-term website non-renewal');
assert.ok(termsScreen.includes('play.google.com/store/account/subscriptions') && termsScreen.includes('does not cancel a Google Play subscription'), 'Terms provide the correct Play subscription management path and cancellation separation');
assert.ok(termsScreen.includes('October 30, 2026'), 'Terms updated date matches the latest substantive revision');
assert.ok(privacyScreen.includes('Firebase Remote Config') && privacyScreen.includes('PayMongo') && privacyScreen.includes('daily check-in/streak information') && privacyScreen.includes('do not sell personal information for advertising'), 'Privacy policy describes current configuration checks, payment processing, and progress handling without claiming an unused analytics SDK');
assert.ok(privacyScreen.includes('does not cancel a Google Play subscription') && privacyScreen.includes('Google Play and website purchases are billed through different systems'), 'Privacy policy explains separate billing and account-deletion effects');
assert.ok(privacyScreen.includes('href="/account?tab=delete"') && !privacyScreen.includes('hyperionmaritime.org/delete-account'), 'Privacy policy links to the real in-app website account-deletion route');
assert.ok(privacyScreen.includes('October 31, 2026'), 'Privacy policy updated date matches the latest substantive revision');
assert.ok(app.includes("import TopLoadingIndicator from './components/TopLoadingIndicator'") && app.includes('<TopLoadingIndicator />'), 'Global top loader is mounted for every app route');
assert.ok(
  app.includes("withPageLoading('Checking licenses and access'") &&
  app.includes('void refresh(true, true)') &&
  app.includes('if (refreshInFlight)') &&
  app.includes('let forcedRefreshQueued = false') &&
  app.includes('if (force) forcedRefreshQueued = true') &&
  app.includes('shouldRefreshLicenseForAuthEvent') &&
  app.includes("event === 'INITIAL_SESSION'") &&
  app.includes('refreshCachedEntitlements()') &&
  !app.includes('minimumRefreshIntervalMs = 10 * 60 * 1000'),
  'Entitlement refreshes run on startup/account change or explicit action, while wake checks signed expiry locally'
);
assert.ok(topLoadingIndicator.includes('location.pathname') && topLoadingIndicator.includes('location.search') && topLoadingIndicator.includes('ROUTE_TRANSITION_MS = 480'), 'Top loader activates on page and query-string navigation');
assert.ok(topLoadingIndicator.includes('src="/logo.png"') && !topLoadingIndicator.includes('/logo.png?') && topLoadingIndicator.includes('hyperion-top-loader__logo'), 'Top loader uses the exact precached local Hyperion logo URL as its animated symbol');
assert.ok(indexCss.includes('.hyperion-top-loader__progress') && indexCss.includes('@keyframes hyperion-loader-sweep'), 'Top loader retains loading progress feedback');
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
assert.ok(/(?:supabase|client)\.functions\.invoke\('record-user-activity'\)/.test(app) && app.includes("hyperion:last-website-activity") && app.includes("shouldRecordAccountActivity") && app.includes("canAttemptAccountActivity") && app.includes("localStorage.setItem(storageKey"), 'Authenticated paid-account activity is gated by account-scoped durable success hints and bounded outage retries');
assert.ok(accountActivityFunction.includes("userClient.auth.getUser()") && accountActivityFunction.includes("from('user_activity')") && accountActivityFunction.includes("ACCOUNT_ACTIVITY_INTERVAL_MS = 6 * 60 * 60 * 1000"), 'Activity endpoint verifies the caller and throttles SQL writes to six hours server-side');
assert.ok(app.includes('const activityHeartbeat = window.setInterval(onResume, 60 * 60 * 1000)') && app.includes('window.clearInterval(activityHeartbeat)'), 'Long-running visible paid study tabs keep a bounded activity heartbeat without route-driven probes');
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
assert.ok(termsScreen.includes('30 consecutive days without a recorded authenticated account-activity timestamp') && termsScreen.includes('30-day expiry-based grace period'), 'Terms disclose inactivity-based account deletion and license-expiry grace');
assert.ok(privacyScreen.includes('Account activity timestamps') && privacyScreen.includes('automated inactivity-retention process') && privacyScreen.includes('automated deletion is considered only after both the expiry-based grace period and the inactivity-plus-grace deadline have passed'), 'Privacy policy describes website activity logging and the combined inactivity/grace retention deadline');
assert.ok(termsScreen.includes('October 30, 2026') && privacyScreen.includes('October 31, 2026'), 'Legal pages show the current revision date for activity and retention disclosures');

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
assert.ok(mockExam.includes("getQuestionCountsByTrack(trackId, freeOnly)") && mockExam.includes("refreshCachedEntitlements"), 'Mock exam validates cached signed access and asks the protected inventory endpoint for the correct access tier');
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
assert.ok(licenseStore.includes('await applyCachedOfflineEntitlements(userId)'), 'Failed signed-lease refresh restores only the cached lease for the current account');
assert.ok(app.includes("location.pathname === '/practice/competences' || location.pathname === '/practice'") && app.includes('setupNeedsLicense'), 'Direct Practice All Questions and practice-config URLs are guarded by track entitlement');
assert.ok(app.includes("setupParams.get('free') === '1' && setupMode !== 'drill'") && app.includes('Free Reviewer and Timed Mock Exam remain available without a purchase.'), 'Only the explicit Free Reviewer route bypasses practice setup licensing');
assert.ok(app.includes("isMockRunner && currentMode === 'MOCK'") && app.includes("isPracticeQuiz && currentMode === 'PRACTICE'") && !app.includes("isPracticeQuiz && (currentMode === 'PRACTICE' || currentMode === 'DRILL')") && app.includes('const isPermittedFreeRunner = isFreeSession') && practiceStore.includes('authorizeQuestionSetAccess(track, activeQuestions)') && practiceStore.includes("isFreeSession: access === 'free-sample'"), 'Question-runner permits free-sample Free Reviewer and Mock sessions but never free-sample mistake drills');
assert.ok(practiceStore.includes("mode !== 'MOCK' && !licensed && !isFreeReviewerSession") && practiceStore.includes("mode === 'PRACTICE' && free === true"), 'Practice store blocks unlicensed Practice All Questions and Drill sessions except explicit Free Reviewer');
assert.ok(practiceStore.includes("mode === 'MOCK' ? !licensed : isFreeReviewerSession"), 'Mock Exam remains usable as a free feature and uses the full pool only for licensed users');
assert.ok(practiceConfigScreen.includes('await refreshCachedEntitlements()') && practiceConfigScreen.includes('if (!freeMode && !hasLicense)') && practiceConfigScreen.includes('shuffleChoices, free: freeMode'), 'Practice configuration enforces signed local expiry without repeated network license refresh');
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
assert.ok(app.includes("location.pathname === '/' && <InstallPrompt variant=\"modal\" iosOnly />") && app.includes('<Route path="/" element={<DashboardLanding />} />') && app.includes('<Route path="/tracks" element={<DashboardLanding />} />'), 'Both dashboard entry routes can recover OAuth checkout while only the homepage shows the iOS install prompt');
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
assert.ok(questionBankClient.includes("saveOfflineEntitlements") && questionBankClient.includes("body: { action: 'offline-license' }") && questionBankClient.includes('await hasValidOfflineTrackLease(track, userId)'), 'Paid offline-pack downloads save and verify a signed, track-specific offline entitlement lease');
assert.ok(
  questionBankClient.includes('return hasValidOfflineTrackLease(track)') &&
  questionBankClient.includes('if (offline) {\n    // Free users must reconnect to review.') &&
  questionBankClient.includes('Free reviewing is online-only. Open a Free Reviewer competence') &&
  !questionBankClient.includes("if (await matchesCachedPack(true)) return 'free-sample'"),
  'Free users cannot access saved free packs offline or trigger bulk fallback downloads; paid tracks require signed offline leases'
);
assert.ok(
  trackHubScreen.includes('if (!isCurrent() || !unlocked || !online || !accountUserId) return') &&
  trackHubScreen.includes('if (!unlocked) return') &&
  trackHubScreen.includes('canContinue: () => {') &&
  !trackHubScreen.includes('if (!unlocked && !online) await ensureOfflineFreeSamplePack(track)'),
  'Unlicensed track hubs do not prepare/download offline banks, and active transfers stop if their license is revoked'
);
assert.ok(
  questionBank.includes('Bulk question-file downloads require an active track license.') &&
  questionBank.includes('Question-file downloads require an active track license.'),
  'Backend rejects bulk and raw CSV file downloads for guests and unlicensed users'
);
assert.ok(
  questionBankClient.includes("if (freeOnly) throw new Error('Offline downloads require an active license for this track.')") &&
  questionBankClient.includes('assertDownloadAccount()\n  await saveOfflineQuestionPackSets(updates)'),
  'Paid offline download requires license verification and rechecks account/access before encrypted save'
);
assert.ok(
  questionBankClient.includes('QUESTION_BANK_VERSION_CHECK_COOLDOWN_MS = 5 * 60 * 1000') &&
  questionBankClient.includes('offlineQuestionVersionChecksInFlight') &&
  questionBankClient.includes('manifest.lastKnownUpdateState'),
  'Offline pack version checks are coalesced and throttled while preserving the last known update state'
);
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
// Signed-lease failure preservation is exercised by license-refresh.test.ts.
assert.ok(
  questionBank.includes('admin: isAdmin === true') &&
    !questionBank.includes('offlineAdminExpiry') &&
    licenseStore.includes('snapshot.isAdmin ? [...TRACK_IDS]'),
  'Signed administrator offline access is all-track and has no artificial seven-day expiry'
);

const offlineEntitlementLookupStart = questionBankClient.indexOf('async function hasValidOfflineTrackLease');
const offlineEntitlementLookupEnd = questionBankClient.indexOf('\n}', offlineEntitlementLookupStart);
const offlineEntitlementLookup = questionBankClient.slice(offlineEntitlementLookupStart, offlineEntitlementLookupEnd);
assert.ok(offlineEntitlementLookup.includes('getCachedOfflineEntitlementSnapshot()') && offlineEntitlementLookup.includes('snapshot.isAdmin') && !offlineEntitlementLookup.includes('supabase.auth.getSession()'), 'Offline question access accepts a verified administrator role without inventing a paid expiry and remains account-bound');
assert.ok(offlineQuestionCache.includes('if (!stored || stored.userId !== userId) return null') && offlineQuestionCache.includes('export async function getCachedOfflineEntitlementSnapshot(expectedUserId?: string)') && offlineQuestionCache.includes('if (owner && owner !== stored.userId) return null') && offlineQuestionCache.includes('expiresAt > verified.effectiveNow') && offlineEntitlementCrypto.includes('crypto.subtle.verify'), 'Offline entitlement cache can restore its signed account-bound track grants without a Supabase session and still enforces actual expiry and clock integrity');
assert.ok(questionBankClient.includes('if (error && canFallbackToOffline(error) && await hasValidOfflineTrackLease(track))'), 'Online question fallback only consults saved paid packs after a network/server failure plus a valid local expiry');
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
assert.ok(
  questionBank.includes("body.action === \"offline-license\"") &&
    questionBank.includes("const claims = { v: 1, userId: user.id, issuedAt: now, admin: isAdmin === true, tracks }") &&
    questionBank.includes("crypto.subtle.sign"),
  'Offline entitlement claims are issued by the authenticated server and cryptographically signed, including the administrator role without a fake expiry'
);
const activePaidEntitlements = await read('../supabase/functions/_shared/activePaidEntitlements.ts');
const activePaidEntitlementMigration = await read('../supabase/migrations/20261112002510_unify_current_paid_entitlement_reads.sql');
assert.ok(questionBank.includes('loadActivePaidEntitlements(admin, user.id)') &&
  activePaidEntitlements.includes("error.code !== 'PGRST202'") &&
  activePaidEntitlements.includes(".eq('status', 'active')") &&
  activePaidEntitlements.includes(".gt('expires_at', new Date(nowMs).toISOString())") &&
  activePaidEntitlementMigration.includes("e.status = 'active'") &&
  activePaidEntitlementMigration.includes("g.status = 'active'") &&
  activePaidEntitlementMigration.includes("e.expires_at > pg_catalog.now()") &&
  activePaidEntitlementMigration.includes("g.expires_at > pg_catalog.now()") &&
  activePaidEntitlementMigration.includes('security invoker') &&
  activePaidEntitlementMigration.includes('grant execute on function public.get_active_paid_track_entitlements(uuid,text)') &&
  activePaidEntitlementMigration.includes('to service_role;'),
  'Offline entitlement tokens must derive only from a private, current, expiry-checked website/Play query; service role only, failures fail closed');
assert.ok(offlineEntitlementSigningMigration.includes('private_jwk jsonb NOT NULL') && offlineEntitlementSigningMigration.includes('public_jwk jsonb NOT NULL') && offlineEntitlementSigningMigration.includes('ENABLE ROW LEVEL SECURITY'), 'Offline signing keys are stored in an RLS-protected table');
assert.ok(offlineEntitlementSigningMigration.includes('REVOKE ALL ON TABLE public.offline_entitlement_signing_keys FROM PUBLIC, anon, authenticated') && offlineEntitlementSigningMigration.includes('GRANT SELECT, INSERT ON TABLE public.offline_entitlement_signing_keys TO service_role'), 'Offline private signing keys cannot be read or written by client database roles');


assert.ok(offlineEntitlementCrypto.includes('OFFLINE_ENTITLEMENT_PUBLIC_KEY') && offlineEntitlementCrypto.includes('claims.userId !== expectedUserId') && offlineEntitlementCrypto.includes('signature.length !== 64'), 'Offline entitlement verifier pins the public key, account identity, and ECDSA signature size');
assert.ok(offlineEntitlementCrypto.includes('effectiveOfflineEntitlementNow') && offlineEntitlementCrypto.includes('OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS'), 'Offline entitlement validation exposes a bounded wall-clock rollback guard');
assert.ok(offlineQuestionCache.includes('lastVerifiedAt') && offlineQuestionCache.includes('persistOfflineEntitlementHighWaterMark') && offlineQuestionCache.includes('effectiveOfflineEntitlementNowMonotonic(Date.now(), stored.lastVerifiedAt)'), 'PWA offline grants persist a high-water mark and use monotonic time while the app remains open');
assert.ok(offlineQuestionCache.includes('navigator.storage.persist()') && offlineQuestionCache.includes('requestPersistentOfflineStorage'), 'PWA requests persistent origin storage after saving offline question packs to reduce browser eviction risk');
assert.ok(offlineQuestionCache.includes('JSON.parse(localStorage.getItem(ENTITLEMENTS_KEY)') && offlineQuestionCache.includes("typeof value.token !== 'string'"), 'Legacy unsigned localStorage expiry records are not accepted as licenses');
assert.ok(licenseStore.includes("body: { action: 'offline-license' }") && licenseStore.includes('await saveOfflineEntitlements(userId, data.token, () => generation === refreshGeneration, data.issuedAt)'), 'Online license refresh stores only a server-signed offline token');
assert.ok(
  licenseStore.includes('refreshSignedOfflineLease') &&
    licenseStore.includes('await saveOfflineEntitlements(userId, data.token, () => generation === refreshGeneration, data.issuedAt)') &&
    licenseStore.includes('await applyCachedOfflineEntitlements(userId)') &&
    !licenseStore.includes('clearOfflineEntitlements(session.user.id)'),
  'Both purchase sources use one server-signed cross-store lease and failed refreshes preserve the last valid same-account lease'
);
assert.ok(
  offlineQuestionCache.includes('claims.issuedAt !== serverNow') &&
    offlineEntitlementCrypto.includes('monotonicOfflineClockAnchor.fromServer') &&
    !licenseStore.includes('accessFlags(data.trackIds)'),
  'Server-signed time can correct a skewed device clock, but the unsigned response track list cannot grant access'
);
assert.ok(accountScreen.includes('useLicenseStore.getState().clearLicense()'), 'Only an intentional website sign-out clears the device-bound offline entitlement lease');
assert.ok(
  licenseStore.includes('getCachedOfflineEntitlementSnapshot') &&
    licenseStore.includes('navigator.onLine === false') &&
    licenseStore.includes('await applyCachedOfflineEntitlements()') &&
    licenseStore.includes('scheduleEntitlementExpiryRefresh(userId, expiryValues'),
  'Offline startup applies the locally signed entitlement and schedules refresh only at the real subscription expiry'
);

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
assert.equal(validOfflineClaims?.admin, false, 'Ordinary signed offline leases do not gain administrator privileges');
const adminOfflineClaims = {
  v: 1,
  userId: 'offline-admin-test-user',
  issuedAt: cryptoTestNow,
  admin: true,
  tracks: {}
};
const validAdminOfflineToken = await signOfflineClaims(adminOfflineClaims);
const verifiedAdminOfflineClaims = await verifyOfflineEntitlementToken(
  validAdminOfflineToken,
  adminOfflineClaims.userId,
  cryptoTestNow,
  ephemeralPublicJwk
);
assert.equal(verifiedAdminOfflineClaims?.admin, true, 'A server-signed administrator claim is recognized without inventing a track expiry');
assert.equal(
  await verifyOfflineEntitlementToken(
    await signOfflineClaims({ ...adminOfflineClaims, tracks: { DECK_OIC_NW: cryptoTestNow + 7 * 24 * 60 * 60 * 1000 } }),
    adminOfflineClaims.userId,
    cryptoTestNow,
    ephemeralPublicJwk
  ),
  null,
  'Administrator leases cannot smuggle a synthetic per-track subscription expiry'
);

assert.equal(await verifyOfflineEntitlementToken(validOfflineToken, 'different-user', cryptoTestNow, ephemeralPublicJwk), null, 'Signed offline leases cannot be replayed across accounts');
assert.equal(offlineEntitlementCrypto.includes('MAX_OFFLINE_ENTITLEMENT_AGE_MS'), false, 'Offline signed entitlement validity is not capped by an arbitrary token age');
assert.equal(OFFLINE_CLOCK_ROLLBACK_TOLERANCE_MS, 5 * 60 * 1000, 'Offline lease validation allows no more than five minutes of clock skew');
resetMonotonicOfflineEntitlementClock();
const monotonicBase = cryptoTestNow;
anchorMonotonicOfflineEntitlementClock(monotonicBase, 10_000);
assert.equal(
  effectiveOfflineEntitlementNowMonotonic(monotonicBase - 60 * 60 * 1000, monotonicBase, 70_000),
  monotonicBase + 60_000,
  'A wall-clock rollback while the PWA remains open cannot freeze the offline expiry countdown'
);
resetMonotonicOfflineEntitlementClock();
assert.equal(
  effectiveOfflineEntitlementNowMonotonic(cryptoTestNow - 6 * 60 * 1000, cryptoTestNow, 100),
  null,
  'After a browser restart, a clock behind the persisted high-water mark fails closed until corrected'
);
resetMonotonicOfflineEntitlementClock();
assert.equal(
  effectiveOfflineEntitlementNowMonotonic(cryptoTestNow + 60 * 60 * 1000, cryptoTestNow, 100),
  cryptoTestNow + 60 * 60 * 1000,
  'A forward clock adjustment is never allowed to extend offline access'
);
resetMonotonicOfflineEntitlementClock();
assert.equal(
  effectiveOfflineEntitlementNow(cryptoTestNow - 2 * 60 * 1000, cryptoTestNow),
  cryptoTestNow,
  'A small clock rollback cannot move the effective lease time backwards'
);
assert.equal(
  effectiveOfflineEntitlementNow(cryptoTestNow - 6 * 60 * 1000, cryptoTestNow),
  null,
  'A material device-clock rollback rejects cached offline access'
);
const smallRollbackEffectiveNow = effectiveOfflineEntitlementNow(cryptoTestNow - 2 * 60 * 1000, cryptoTestNow);
assert.ok(
  await verifyOfflineEntitlementToken(validOfflineToken, sampleClaims.userId, smallRollbackEffectiveNow, ephemeralPublicJwk),
  'A small device-clock rollback verifies a signed lease against the last observed time'
);
assert.equal(
  effectiveOfflineEntitlementNow(cryptoTestNow + 2 * 60 * 1000, cryptoTestNow),
  cryptoTestNow + 2 * 60 * 1000,
  'A forward-moving device clock advances the offline lease high-water mark'
);
assert.equal(
  effectiveOfflineEntitlementNow(Number.NaN, cryptoTestNow),
  null,
  'Invalid device time cannot validate an offline entitlement'
);

const longOfflineClaims = {
  ...sampleClaims,
  issuedAt: cryptoTestNow - 30 * 24 * 60 * 60 * 1000,
  tracks: { DECK_OIC_NW: cryptoTestNow + 7 * 24 * 60 * 60 * 1000 }
};
const longOfflineToken = await signOfflineClaims(longOfflineClaims);
assert.equal(
  (await verifyOfflineEntitlementToken(longOfflineToken, sampleClaims.userId, cryptoTestNow, ephemeralPublicJwk))?.tracks?.DECK_OIC_NW,
  longOfflineClaims.tracks.DECK_OIC_NW,
  'A signed grant remains valid after more than 72 hours offline while the actual track expiry is still in the future'
);
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


assert.ok(trackHubScreen.includes('getCachedOfflineEntitlementSnapshot(accountUserId ?? undefined)') && trackHubScreen.includes('offlineLicenseAdmin') && trackHubScreen.includes('offlineLicenseExpiry && offlineLicenseExpiry > Date.now()'), 'Offline panel distinguishes a signed administrator role from a paid per-track expiry');
assert.ok(trackHubScreen.includes('DEVICE ONLINE') && trackHubScreen.includes('DEVICE OFFLINE') && trackHubScreen.includes('Last saved on this device'), 'Offline panel displays connection and last-saved state');
assert.ok(trackHubScreen.includes('Reconnect before expiry to refresh your license.') && trackHubScreen.includes('Administrator access is verified on this device and has no subscription expiry.') && trackHubScreen.includes('valid offline license could not be verified on this device'), 'Offline panel explains paid expiry and no-expiry administrator role separately');
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

const autoSaveStart = practiceStore.indexOf('function persistActiveSession(s: PracticeState): Promise<void> {');
const autoSaveWritePosition = practiceStore.indexOf('saveSessionSnapshot(snapshot.sessionId, snapshot)', autoSaveStart);
const autoSaveHistoryPosition = practiceStore.indexOf('useHistoryStore.getState().saveSession({', autoSaveStart);
assert.ok(autoSaveWritePosition >= autoSaveStart && autoSaveHistoryPosition > autoSaveWritePosition && practiceStore.includes('return saveSessionSnapshot(snapshot.sessionId, snapshot).then(() => {') && practiceStore.includes('await persistActiveSession(get())'), 'Automatic autosave records resumable History only after the encrypted snapshot write succeeds');
assert.ok(practiceStore.includes('Avoid resurrecting a History row after this session was reset or finished while saving'), 'Late autosaves do not restore History after a session has ended');
assert.ok(practiceQuizScreen.includes('if (!resumeSessionId) return') && !practiceQuizScreen.includes('void restoreSavedProgress()'), 'Bare practice URLs must not restore the newest saved session from an unrelated track');

assert.ok(practiceStore.includes('await deleteSessionSnapshot(snapshot.sessionId).catch(() => undefined)'), 'A session snapshot is removed if its History metadata cannot be saved');
assert.ok(practiceQuizScreen.includes('saved = await saveProgress()') && practiceQuizScreen.includes('Your session is still open') && practiceQuizScreen.includes('disabled={savingProgress}'), 'Save failure keeps the user in the session and prevents duplicate save requests');
assert.ok(!practiceQuizScreen.includes('aria-label="Back">← Back'), 'The question screen has no redundant second Back button inside the question content');

const androidMaterialIcons = await read('../src/components/MaterialIcon.tsx');
const desktopAccountTrigger = await read('../src/components/DesktopAccountMenu.tsx');
const firstVisitCookieConsent = await read('../src/components/CookieConsent.tsx');
const allTrackHubModes = await read('../src/screens/TrackHubScreen.tsx');
assert.ok(practiceQuizScreen.includes('<MaterialIcon name="gridView" size={22} />') && !practiceQuizScreen.includes('>▦</button>') && androidMaterialIcons.includes('"gridView"'), 'Practice and drill use the same GridView palette vector as the Android application');
assert.ok(historyScreen.includes('<MaterialIcon name="filterList" size={20} />') && androidMaterialIcons.includes('"filterList"'), 'History audit uses the Android FilterList palette vector');
assert.ok(desktopAccountTrigger.includes("onClick={() => { setOpen(false); navigate('/account?tab=payments') }}") && desktopAccountTrigger.includes('onMouseEnter={() => setOpen(true)}'), 'Desktop Account clicks open Bond Store while hovering shows its dropdown');
assert.ok(['school','tune','menuBook','timer','style','autoFixHigh','analytics','search'].every(icon => allTrackHubModes.includes("icon: '" + icon + "'")) && allTrackHubModes.includes("<MaterialIcon name={mode.locked ? 'lock' : mode.icon}"), 'Every track reuses the eight Android Material mode icons including lock-state parity');
assert.ok(firstVisitCookieConsent.includes("useState(() => !hasCookieChoice())") && firstVisitCookieConsent.includes("'hyperion-cookie-consent'") && firstVisitCookieConsent.includes("choose('essential')") && firstVisitCookieConsent.includes("choose('accepted')"), 'First visit without a stored cookie choice shows Accept/Essential-only banner and persists the explicit selection');


const sessionElapsedTimer = await read('../src/components/SessionElapsedTimer.tsx');
assert.ok(practiceQuizScreen.includes('quiz-heading-with-timer') && practiceQuizScreen.includes('<SessionElapsedTimer startedAt={startedAt} inline />'), 'Practice and drill place the elapsed timer alongside the main question count for every track');
assert.ok(!practiceQuizScreen.includes('Q {currentIndex + 1} / {questions.length}') && !practiceQuizScreen.includes('{q.topic}'), 'Practice and drill do not show a duplicate question-count row or repeat the topic inside the question box');
assert.ok(quickScanViewerScreen.includes('quick-scan-progress-timer') && quickScanViewerScreen.includes('<SessionElapsedTimer startedAt={startedAt} inline />') && !quickScanViewerScreen.includes('{q.topic}'), 'Quick Scan aligns its timer with item progress and does not repeat topic text in the question card');
assert.ok(!mockExam.includes('{q.topic}') && mockExam.includes('QUESTION {index + 1} OF {questions.length}'), 'Mock exam retains per-question numbering but removes topic titles from question content');
assert.ok(sessionElapsedTimer.includes('inline = false') && sessionElapsedTimer.includes('margin: inline ? 0'), 'Inline elapsed display is optional and existing timer callers preserve previous layout');
assert.ok(indexCss.includes('.quiz-heading-with-timer') && indexCss.includes('.quick-scan-progress-timer'), 'Question headings have responsive compact timer-aligned styling');
const offlineHubScreen = await read('../src/screens/TrackHubScreen.tsx');
const offlineHubStyles = await read('../src/screens/TrackHubScreen.css');
assert.ok(offlineHubScreen.includes('await downloadOfflinePack(track, false, (downloaded, total) =>') && offlineHubScreen.includes('downloaded, total,') && offlineHubScreen.includes("phase: total > 0 && downloaded >= total ? 'saving' : 'downloading'"), 'Background licensed offline packs report real question counts and wait for verified save before completion');
assert.ok(offlineHubScreen.includes("const downloadPercent = hasMeasuredProgress") && offlineHubScreen.includes('Math.min(99,') && offlineHubScreen.includes('offlineStatus?.questionCount.toLocaleString()'), 'Offline progress never claims 100% before the complete encrypted pack is saved and then shows real saved counts');
assert.ok(offlineHubScreen.includes('currentOfflineTransfer') && offlineHubScreen.includes('hyperion:offline-transfer') && offlineHubScreen.includes('accountUserId && transfer.trackId === info.trackId && transfer.userId === accountUserId'), 'Offline progress survives a track page remount and is scoped to the current track and signed-in account');
assert.ok(offlineHubScreen.includes('role="progressbar"') && offlineHubScreen.includes('aria-valuenow=') && offlineHubScreen.includes('hub-offline-spinner'), 'Offline readiness exposes accessible progress and a spinner while checking or downloading');
assert.ok(offlineHubStyles.includes('.hub-offline-progress-track') && offlineHubStyles.includes('hyperion-offline-indeterminate') && offlineHubStyles.includes('hyperion-offline-spin'), 'Offline track UI styles include determinate and indeterminate progress animations');

const questionBookmarkButton = await read('../src/components/QuestionBookmarkButton.tsx');
assert.ok(questionBookmarkButton.includes('<path d="M6.75 4.25A1.75 1.75') && questionBookmarkButton.includes('aria-pressed={bookmarked}') && app.includes('QuestionBookmarkButton'), 'The shared question bookmark control uses an accessible outline SVG');
assert.ok(app.includes('!isMockRunner && <QuestionBookmarkButton') && mockExam.includes('questionNumber={index + 1}') && mockExam.includes('question={q}'), 'Scrolling mock exams bookmark each question rather than a hidden current index');
assert.ok(app.includes('viewBox="0 0 24 24" width="27" height="27" fill="currentColor"') && app.includes('aria-expanded={settingsOpen}'), 'The question header uses a clean accessible gear SVG for settings');
assert.ok(!app.includes("'♧'") && !app.includes('>⚙</button>'), 'Emoji-like bookmark and gear glyphs are not used in the question header');
assert.ok(vaultScreen.includes("createSavedQuestionSelection('mistakes'") && vaultScreen.includes('saved mistakes remain on this device'), 'Mistakes open a durable saved-set configuration instead of starting before configuration');
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
assert.ok(!app.includes('purgePaidForTracks') && !app.includes('deletePaidQuestionSnapshotsForTrack') && !app.includes('removePaidSavedSessionsForTrack') && vaultStore.includes('never a deletion'), 'License changes gate access without deleting saved study data or audits');
assert.ok(vaultScreen.includes('entitlementsVerified') && vaultScreen.includes('isTrackUnlocked(item.track)') && !vaultScreen.includes('authorizeQuestionSet'), 'Vault hides every track without an active entitlement and does not expose free-sample mistakes');
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
assert.ok(progressSyncSource.includes('await writeEncryptedPersistedValue(key, value, ownerId)') && progressSyncSource.includes('await removeEncryptedPersistedValue(key)'), 'Cloud restore writes bookmarks and mistakes back to encrypted IndexedDB before rehydrating stores');
assert.ok(progressSyncSource.includes('await writeEncryptedPersistedValue(accountCacheKey(owner)') && !progressSyncSource.includes('localStorage.setItem(accountCacheKey(') && progressSyncSource.includes('await readEncryptedPersistedValue(accountCacheKey(userId))'), 'Account-switch recovery caches are encrypted rather than stored as question text in localStorage');
assert.ok(progressSyncSource.includes('migrateLegacyProgressCaches') && progressSyncSource.includes("key.startsWith('hyperion-progress-cache:')"), 'Legacy plaintext account progress caches are migrated into encrypted storage');
assert.ok(encryptedPersistStorage.includes('export function readEncryptedPersistedValue') && encryptedPersistStorage.includes('export function writeEncryptedPersistedValue'), 'Encrypted storage exposes a shared bridge for cloud progress restoration');


assert.ok(questionBank.includes('authorize-saved-questions') && questionBank.includes('allowedIndexes') && questionBank.includes('freeQuestionFingerprints'), 'Saved question collections can be filtered by current paid access or verified free-sample fingerprints');
assert.ok(learningProgressFunction.includes("admin.from('user_learning_progress')") && learningProgressFunction.includes("body.action === 'read'") && learningProgressFunction.includes("body.action === 'write'"), 'Progress reads and writes go through an authenticated server function');
assert.ok(learningProgressFunction.includes("expected_updated_at") && learningProgressFunction.includes(".eq('updated_at', expectedUpdatedAt)") && learningProgressFunction.includes("conflict: true }, 409"), 'Progress writes use version-checked compare-and-swap instead of overwriting concurrent device changes');
assert.ok(!learningProgressFunction.includes(".upsert({ user_id: user.id, data: sanitized }"), 'Learning progress no longer uses an unconditional whole-snapshot upsert');
assert.ok(progressSyncSource.includes("expected_updated_at: expectedUpdatedAt") && progressSyncSource.includes("attempt < 3") && progressSyncSource.includes("const isConflict = status === 409"), 'PWA progress sync re-reads and merges before retrying concurrent-write conflicts');
assert.ok(learningProgressFunction.includes("client.functions.invoke('question-bank'") && learningProgressFunction.includes('sanitizeSnapshot'), 'Progress server responses are filtered through the protected question-bank authorization service');
assert.ok(learningProgressFunction.includes("req.headers.get('content-length')") && learningProgressFunction.includes('Number(declaredLength) > maxBytes'), 'Learning progress rejects oversized declared request bodies before reading them');
assert.ok(learningProgressFunction.includes('if (declaredLength && /^\\d+$/.test(declaredLength)'), 'Learning progress validates Content-Length as decimal digits before applying the early size check');
assert.ok(learningProgressFunction.includes('decodedStream.getReader()') && learningProgressFunction.includes('totalBytes > maxBytes') && learningProgressFunction.includes("new DecompressionStream('gzip')"), 'Learning progress enforces the decompressed UTF-8 byte limit while streaming request data');
assert.ok(learningProgressFunction.includes("'content-encoding'") && progressSyncSource.includes("new CompressionStream('gzip')") && progressSyncSource.includes("'Content-Encoding': 'gzip'"), 'PWA progress writes use bounded server-side gzip decompression and compressed client uploads');
assert.ok(learningProgressFunction.includes('error instanceof PayloadTooLargeError'), 'Oversized streamed payloads return HTTP 413 rather than a generic parsing error');
assert.ok(progressSyncSource.includes("functions.invoke('learning-progress'") && !progressSyncSource.includes(".from(TABLE)"), 'The browser no longer directly reads or writes user_learning_progress');
assert.ok(functionConfig.includes('[functions.learning-progress]') && functionConfig.includes('verify_jwt = true'), 'Learning progress endpoint requires a valid JWT');


assert.ok(progressPrivilegeMigration.includes('revoke all privileges on table public.user_learning_progress from PUBLIC, anon, authenticated') && progressPrivilegeMigration.includes('grant all privileges on table public.user_learning_progress to service_role'), 'Direct browser privileges are revoked while service-role access is retained');
assert.ok(
  progressSnapshotComparisonMigration.includes('SECURITY DEFINER') &&
  progressSnapshotComparisonMigration.includes('REVOKE ALL ON FUNCTION public.compare_user_learning_progress') &&
  progressSnapshotComparisonMigration.includes('TO service_role') &&
  learningProgressFunction.includes("'compare_user_learning_progress'"),
  'No-op progress comparison stays inside Postgres and the RPC is restricted to service_role'
);
assert.ok(
  learningProgressFunction.includes('PROGRESS_ROW_CACHE_TTL_MS') &&
  learningProgressFunction.includes("select('updated_at')") &&
  learningProgressFunction.includes('revision.updated_at === cached.updatedAt') &&
  learningProgressFunction.includes('sanitizeSnapshot(client, snapshotData, allowedTracks)'),
  'Warm-isolate progress reads verify the latest DB version and re-sanitize cached data against current entitlements'
);

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
const offlineDownloadStart = questionBankClient.indexOf('async function downloadOfflinePackInternal');
const offlineDownloadSessionGate = questionBankClient.indexOf('await supabase.auth.getSession()', offlineDownloadStart);
const offlineDownloadLicenseGate = questionBankClient.indexOf("body: { action: 'offline-license' }", offlineDownloadStart);
const offlineDownloadVersionRequest = questionBankClient.indexOf('const versionsBefore = await fetchRemoteQuestionBankVersions(track)', offlineDownloadStart);
const offlineDownloadCountsRequest = questionBankClient.indexOf('await fetchRevisionQuestionCounts(track, false, versionsBefore.bankRevision)', offlineDownloadStart);
assert.ok(
  offlineDownloadStart >= 0 &&
  questionBankClient.includes("if (freeOnly) throw new Error('Offline downloads require an active license for this track.')") &&
  offlineDownloadSessionGate > offlineDownloadStart &&
  offlineDownloadLicenseGate > offlineDownloadSessionGate &&
  questionBankClient.includes('!offlineLicense.trackIds.includes(track)') &&
  offlineDownloadVersionRequest > offlineDownloadLicenseGate &&
  offlineDownloadCountsRequest > offlineDownloadVersionRequest,
  'Offline pack downloads reject free packs and verify a server-signed entitlement for the selected track before requesting bank metadata or question counts'
);
assert.ok(
  practiceConfigScreen.includes("next.set('purchase', '1')") && practiceConfigScreen.includes("next.set('purchase_term'"),
  'Unlicensed Practice All Questions opens a track purchase dialog instead of navigating to the locked Account page'
);
assert.ok(
  app.includes("import TrackPurchaseDialog from './components/TrackPurchaseDialog'") && app.includes('<TrackPurchaseDialog />'),
  'Track purchase dialog is mounted globally so it survives the OAuth callback return to practice'
);
assert.ok(
  // Pricing, artwork and plan selectors are now a single shared source
  // rendered by both the Bond Store and the purchase popup.
  bondStoreCardContent.includes('LICENSE_TERMS') &&
  bondStoreCardContent.includes('priceForTerm(product, term)') &&
  bondStoreCardContent.includes('BOND_STORE_FEATURES.map') &&
  bondStoreCardStyles.includes('/store-art/hyperion-banner-sprite.png') &&
  accountScreen.includes('<BondStoreCardContent') &&
  trackPurchaseDialog.includes('<BondStoreCardContent') &&
  trackPurchaseDialog.includes("provider: 'google'") &&
  trackPurchaseDialog.includes("set('purchase_product', product.code)") &&
  trackPurchaseDialog.includes('rememberPendingBuyNow(product.code, term)') &&
  trackPurchaseDialog.includes('const nextBasket = [{ code: product.code, term }]') &&
  trackPurchaseDialog.includes('const selection = [{ code: product.code, term }]') &&
  trackPurchaseDialog.includes('navigate(buyNowCheckoutPath(product.code, term))'),
  'Buy Now keeps the selected track and term before Google OAuth and opens only that track in Checkout'
);
assert.ok(
  trackHubScreen.includes("title: 'TIMED MOCK EXAM',\n      audience: 'licensed'") &&
  mockExam.includes("Timed Mock Exam requires an active license") &&
  mockExam.includes("if (!accessChecked || !hasMockAccess)") &&
  practiceStore.includes("if (!licensed && !isFreeReviewerSession)") &&
  practiceStore.includes("snapshot.mode === 'MOCK' && !licensedForMock"),
  'Timed Mock Exam is hidden from free tracks and denied on direct URLs, new sessions and resumed attempts'
);
assert.ok(
  pendingBuyNow.includes("PENDING_BUY_NOW_KEY = 'hyperion-pending-buy-now-v1'") &&
  pendingBuyNow.includes('MAX_PENDING_AGE_MS = 10 * 60 * 1000') &&
  pendingBuyNow.includes("PAID_PRODUCTS.some(product => product.code === pending.code)") &&
  pendingBuyNow.includes("pending.term === 'week' || pending.term === 'month' || pending.term === 'year'") &&
  pendingBuyNow.includes("age >= 0 && age <= MAX_PENDING_AGE_MS") &&
  pendingBuyNow.includes("localStorage.setItem('hyperion-account-basket-v1'") &&
  pendingBuyNow.includes('path, startedAt, mode: \'redirect\''),
  'Guest Buy Now stores only a real track, valid duration and short-lived checkout return for OAuth'
);
assert.ok(
  app.includes('function DashboardLanding()') &&
  app.includes("supabase.auth.getSession()") &&
  app.includes('supabase.auth.onAuthStateChange') &&
  app.includes('const selection = readPendingBuyNow()') &&
  app.includes('clearMatchingBuyNowReturn(destination)') &&
  app.includes('navigate(destination, { replace: true })') &&
  oauthCallbackScreen.includes("if (pending && (returnTo === '/' || returnTo.startsWith('/checkout')))") &&
  oauthCallbackScreen.includes('returnTo = buyNowCheckoutPath(pending.code, pending.term)') &&
  oauthCallbackScreen.includes('clearPendingBuyNow()'),
  'Either a valid OAuth callback or an authenticated Site URL homepage fallback opens the pending Checkout instead of Dashboard'
);
assert.ok(
  basketScreen.includes('function directBuyNowSelection(params: URLSearchParams): BasketItem | null') &&
  basketScreen.includes("params.get('buy_product')") &&
  basketScreen.includes("params.get('buy_term')") &&
  basketScreen.includes('return requested ? [requested] : savedBasket()') &&
  basketScreen.includes('if (requested) setBasket([requested])') &&
  basketScreen.includes("navigate('/checkout', { replace: true })"),
  'Checkout restores a valid track/term selection from the sign-in return URL and consumes the one-time URL'
);
assert.ok(
  checkout.includes('body.returnTo') &&
  checkout.includes("target.pathname !== '/practice'") &&
  checkout.includes("buildReturnUrl('success')") &&
  checkout.includes("buildReturnUrl('cancelled')"),
  'Single-track checkout returns to the originating practice purchase dialog only for a validated same-app practice path'
);

assert.ok(
  !trackHubScreen.includes('DOWNLOAD FULL BANK FOR OFFLINE') &&
  trackHubScreen.includes('!unlocked || !online || !accountUserId') &&
  trackHubScreen.includes("gated('Mistakes Notebook'") &&
  trackHubScreen.includes('background: true,') && trackHubScreen.includes('canContinue: () => {'),
  'Manual bank downloads are removed and automatic encrypted preparation requires an online licensed account'
);
assert.ok(questionBankClient.includes('export async function ensureOfflineFreeSamplePack') && questionBankClient.includes('const fullBank = await getOfflineQuestionsByTrack(track, false)') && questionBankClient.includes('freeSample(fullBank, track)'), 'An old Deck OIC offline free sample is repaired only from the complete cached bank and the current server-matched sampler');
assert.ok(questionBankClient.includes('async function hasValidOfflineTrackLease(track: TrackId, expectedUserId?: string): Promise<boolean>') && questionBankClient.includes('snapshot.isAdmin') && questionBankClient.includes('snapshot.trackExpiries[track]'), 'Saved paid-session recovery accepts either an authenticated administrator role or the same track’s unexpired signed license');
const accessQuestionSetStart = questionBankClient.indexOf('export async function authorizeQuestionSetAccess');
const offlineAuthStart = questionBankClient.indexOf('if (offline) {', accessQuestionSetStart);
const offlineAuthEnd = questionBankClient.indexOf('\n\n  if (supabase)', offlineAuthStart);
const offlineAuthBlock = questionBankClient.slice(offlineAuthStart, offlineAuthEnd);
const paidLeaseFastPath = questionBankClient.indexOf('if (offline && await hasValidOfflineTrackLease(track)) return \'licensed\'', accessQuestionSetStart);
const fingerprintWorkStart = questionBankClient.indexOf('const fingerprintResults = await Promise.all(questions.map(fingerprintQuestion))', accessQuestionSetStart);
assert.ok(paidLeaseFastPath > accessQuestionSetStart && fingerprintWorkStart > paidLeaseFastPath && offlineAuthBlock.includes('return null') && !offlineAuthBlock.includes("return 'free-sample'"), 'Paid offline sessions check a signed lease before hashing; unlicensed offline free samples cannot authorize saved sessions');
assert.ok(offlineQuestionCache.includes("const DB_VERSION = 3") && offlineQuestionCache.includes('packMeta: { key: string; value: StoredOfflineQuestionPackMetadata }') && offlineQuestionCache.includes('MAX_DECRYPTED_PACK_CACHE'), 'Offline cache uses a lightweight metadata store and a bounded decrypted-pack cache');
const localCompetenceStart = offlineQuestionCache.indexOf('export async function getOfflineQuestionsByCompetence(');
const localCompetenceEnd = offlineQuestionCache.indexOf('export async function getOfflineQuestionsByTrack(', localCompetenceStart);
const localCompetenceReader = offlineQuestionCache.slice(localCompetenceStart, localCompetenceEnd);
assert.ok(localCompetenceReader.includes('getValidatedPackMetadata') && localCompetenceReader.includes("validated.db.get('packs', meta.id)") && !localCompetenceReader.includes('getOfflineQuestionPacks(track, freeOnly)'), 'Offline competence loading decrypts only the selected competence/part rather than every pack for the track');
assert.ok(questionBankClient.includes('const status = await getOfflinePackStatus(track, true)') && questionBankClient.includes('status?.complete && status.sampleVersion === 2'), 'A validated free pack skips the expensive repair/full-bank scan on every question load');
assert.ok(practiceStore.includes('await useLicenseStore.getState().refreshCachedEntitlements()') && !practiceStore.includes('refreshCloudEntitlements()') && practiceStore.includes('authorizeQuestionSetAccess(snapshot.track, snapshot.questions)'), 'Saved-session resume checks local signed expiry and online server authorization without extra license refresh');
assert.ok(questionFingerprintSource.includes('fingerprintCache.get(question)') && questionFingerprintSource.includes('fingerprintCache.set(question'), 'Repeated saved-session fingerprint checks reuse cached hashes for the same in-memory question objects');
const fallbackStart = questionBankClient.indexOf('// Safari/iOS and installed PWAs can report online while the API is unreachable.');
const fallbackBlock = questionBankClient.slice(fallbackStart, questionBankClient.indexOf('  } catch {', fallbackStart));
assert.ok(fallbackBlock.includes('hasValidOfflineTrackLease(track)') && !fallbackBlock.includes("matchesCachedPack(true)") && !fallbackBlock.includes('getQuestionsByTrack(track, true)'), 'API-unreachable recovery allows only a signed licensed pack and never bulk-downloads free content');
assert.ok(questionBankClient.includes('new JavaRandom(2065 + Number(compId.slice(1)) * 31)') && questionBank.includes('javaShuffle(valid, 2065 + Number(comp) * 31)'), 'Locally retained Deck OIC-NW free samples use the same deterministic per-competence selection as the protected server bank');
assert.ok(questionBankClient.includes("id: question.id.replace(/-\\d+$/") && questionBankClient.includes("String(index + 1).padStart(3, '0')"), 'Locally generated shuffled Deck OIC-NW free samples receive the same sequential question IDs as the protected server sample');
assert.ok(offlinePwaConfig.includes('jpg,jpeg,webp,avif') && offlinePwaConfig.includes('google-fonts-webfonts'), 'The service worker precaches bundled image formats and caches webfont assets for offline screens');
assert.ok(topLoadingIndicator.includes('src="/logo.png"') && !topLoadingIndicator.includes('/logo.png?'), 'The loading indicator uses the exact local image URL that the service worker precaches');
assert.ok(app.includes('OFFLINE MODE') && app.includes('Only questions already saved on this device and saved sessions are available'), 'All routes clearly explain what remains available without a connection');
assert.ok(searchScreen.includes('Open this track online and wait for automatic offline preparation before using Search offline') || questionBankClient.includes('Open this track online and wait for automatic offline preparation before using Search offline'), 'Offline Search gives a clear download requirement instead of reporting a false zero-result search');
assert.ok(flashcardsScreen.includes('Open this track online and wait for automatic offline preparation before using flashcards offline') || questionBankClient.includes('Open this track online and wait for automatic offline preparation before using flashcards offline'), 'Offline Flashcards explains when the full bank must be downloaded first');
assert.ok(questionBank.includes('body.action === "content-versions"') && questionBank.includes('body.action === "content-versions-legacy"') && questionBank.includes('GITHUB_BANK_FILES') && questionBank.includes('fullHash') && questionBank.includes('freeHash'), 'The protected server exposes lightweight Storage metadata versions and retains the legacy hash route only for migration without returning private question text');
assert.ok(questionBankClient.includes("action: legacyContentHashes ? 'content-versions-legacy' : 'content-versions'") && questionBankClient.includes('checkOfflineQuestionPackUpdates') && questionBankClient.includes('changedVersionPaths') && questionBankClient.includes("'github-content-sha256-v1'") && questionBankClient.includes('legacyVersionMigrationChecked'), 'The client compares offline packs with lightweight metadata versions and migrates old hash manifests once');
assert.ok(offlineQuestionCache.includes('sourceVersions?: Record<string, string>') && offlineQuestionCache.includes('lastKnownUpdateState') && offlineQuestionCache.includes('recordOfflinePackVersionCheck'), 'Offline manifests persist per-source download versions and the last verified update state');
assert.ok(questionBankClient.includes('const versionsBefore = await fetchRemoteQuestionBankVersions(track)') && questionBankClient.includes('const versionsAfter = await fetchRemoteQuestionBankVersions(track)') && questionBankClient.includes('The question bank changed while downloading'), 'Question downloads verify the bank did not change during transfer before committing a fully updated manifest');
assert.ok(trackHubScreen.includes('checkOfflineQuestionPackUpdates') && trackHubScreen.includes("check?.status !== 'available'") && trackHubScreen.includes('offlinePreparationInFlight'), 'Background preparation reuses complete packs and serializes updates only when a new version is available');
assert.ok(!trackHubScreen.includes('startOfflineDownload') && !trackHubScreen.includes('UPDATE AVAILABLE') && trackHubScreen.includes('accountGeneration.current'), 'No manual download/update controls remain and stale account results are invalidated');



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
  !licenseStore.includes("from('entitlements')") &&
    !licenseStore.includes("from('google_play_entitlements')") &&
    licenseStore.includes("body: { action: 'offline-license' }"),
  'Client entitlement state uses the server-signed merged grant instead of independently querying purchase-source tables'
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
  activePaidEntitlements.includes('function missingLegacyPlayTable(error:') &&
    activePaidEntitlements.includes("error?.code === 'PGRST205'") &&
    activePaidEntitlements.includes("includes('google_play_entitlements')") &&
    activePaidEntitlements.includes("includes('schema cache')"),
  'Protected paid-track licensing recognizes only the exact missing optional Google Play table response'
);
assert.ok(
  activePaidEntitlements.includes("error.code !== 'PGRST202'") &&
    activePaidEntitlements.includes('if (website.error || (play.error && !missingLegacyPlayTable(play.error)))') &&
    activePaidEntitlements.includes('play.error ? [] : (play.data ?? [])'),
  'Rolling migration fallback is allowed only for a missing RPC and fails closed for all other errors'
);
assert.ok(
  questionBank.includes('loadActivePaidEntitlements(admin, userId, track)') &&
    activePaidEntitlements.includes(".eq('status', 'active')") &&
    activePaidEntitlements.includes(".gt('expires_at', new Date(nowMs).toISOString())") &&
    activePaidEntitlements.includes('Date.parse(previous.expires_at) < expiry') &&
    activePaidEntitlementMigration.includes("e.expires_at > pg_catalog.now()") &&
    activePaidEntitlementMigration.includes("g.expires_at > pg_catalog.now()") &&
    activePaidEntitlementMigration.includes('group by grants.track_id'),
  'Paid-track authorization uses active unexpired grants and picks the latest overlapping expiry'
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
assert.ok(googlePlayRtdnFunction.includes("GOOGLE_PLAY_PUBSUB_AUDIENCE") && googlePlayRtdnFunction.includes("GOOGLE_PLAY_PUBSUB_SERVICE_ACCOUNT_EMAIL") && googlePlayRtdnFunction.includes('payload.email_verified !== true'), 'RTDN validates the configured exact audience and verified service-account email');
assert.ok(googlePlayRtdnFunction.includes("notification?.packageName !== PACKAGE_NAME") && googlePlayRtdnFunction.includes('purchases/subscriptionsv2/tokens/'), 'RTDN checks the Android package and rereads current subscription state from Google Play');
assert.ok(googlePlayRtdnFunction.includes("google_play_rtdn_ignored_unlinked_token") && googlePlayRtdnFunction.includes("google_play_rtdn_subscription_reconciled") && googlePlayRtdnFunction.includes("admin.rpc('sync_google_play_subscription_atomic'"), 'RTDN safely acknowledges unknown tokens, logs aggregate reconciliation outcomes, and uses the atomic entitlement reconciler for known tokens');
assert.ok(functionConfig.includes('[functions.google-play-rtdn]\nverify_jwt = false'), 'RTDN disables Supabase-JWT gateway checks because its handler verifies the Google OIDC bearer token itself');

assert.ok(googlePlayLinkFunction.includes("GOOGLE_PLAY_SERVICE_ACCOUNT_JSON") && googlePlayLinkFunction.includes("purchases/subscriptionsv2/tokens/"), 'Google Play tokens are checked against the Android Publisher API from the server');
assert.ok(googlePlayLinkFunction.includes("purchase_token_sha256") && googlePlayLinkFunction.includes("existing.user_id !== user.id"), 'Google Play purchase tokens are uniquely fingerprinted and cannot be claimed by a second Hyperion account');
assert.ok(googlePlayLinkFunction.includes("if (prior && prior.user_id !== user.id)") && googlePlayLinkFunction.includes("p_prior_purchase_link_id: priorPurchaseLink?.id ?? null") && googlePlayLinkMigration.includes("WHERE id = p_prior_purchase_link_id") && googlePlayLinkMigration.includes("AND user_id = p_user_id"), 'Replacement tokens retire prior grants only when the prior link belongs to the same Hyperion account');
assert.ok(
  googlePlayLinkMigration.includes("subscription_state = 'SUBSCRIPTION_STATE_REPLACED'") &&
    googlePlayLinkMigration.includes("A replaced Google Play purchase token cannot be linked again") &&
    googlePlayLinkFunction.includes("existing?.subscription_state === 'SUBSCRIPTION_STATE_REPLACED'") &&
    googlePlayRtdnFunction.includes("link.subscription_state === 'SUBSCRIPTION_STATE_REPLACED'") && googlePlayRtdnFunction.includes("google_play_rtdn_ignored_replaced_token") &&
    googlePlayLinkMigration.includes("public.google_play_purchase_links"),
  'Replaced predecessor tokens cannot be re-linked or reactivated by late RTDN notifications'
);
assert.ok(googlePlayLinkFunction.includes("'SUBSCRIPTION_STATE_ACTIVE'") && googlePlayLinkFunction.includes("'SUBSCRIPTION_STATE_IN_GRACE_PERIOD'") && googlePlayLinkFunction.includes("'SUBSCRIPTION_STATE_CANCELED'") && googlePlayLinkFunction.includes("maxExpiry > now"), 'Google Play access is tied to an allowed subscription state and a future verified expiry');

assert.ok(
  googlePlayReconciliationFunction.includes("verify_google_play_reconciliation_cron_token") &&
    googlePlayReconciliationFunction.includes("x-hyperion-google-play-reconcile-token") &&
    googlePlayReconciliationFunction.includes(".limit(BATCH_SIZE)") &&
    googlePlayReconciliationFunction.includes(".order('last_reconciliation_attempt_at', { ascending: true })") &&
    googlePlayReconciliationFunction.includes("SUBSCRIPTION_STATE_REPLACED"),
  'Periodic Play reconciliation requires a Vault-verified private token, processes a bounded fair batch, and skips replaced predecessor tokens'
);
assert.ok(
  googlePlayScheduleMigration.includes("hyperion_google_play_reconciliation_enabled") &&
    googlePlayScheduleMigration.includes("vault.create_secret(\n      'false'") &&
    googlePlayScheduleMigration.includes("'*/15 * * * *'") &&
    googlePlayScheduleMigration.includes("WHEN EXISTS") &&
    googlePlayScheduleMigration.includes("verify_google_play_reconciliation_cron_token"),
  'The recurring job is registered every 15 minutes but sends no network request until the explicit Vault enable flag is true'
);
assert.ok(
  googlePlayLinkMigration.includes('last_reconciliation_attempt_at timestamptz NOT NULL DEFAULT now()') &&
    googlePlayLinkMigration.includes('google_play_purchase_links_reconciliation_attempt_idx') &&
    googlePlaySchema.includes('last_reconciliation_attempt_at timestamptz NOT NULL DEFAULT now()') &&
    functionConfig.includes('[functions.reconcile-google-play-subscriptions]') &&
    functionConfig.slice(functionConfig.indexOf('[functions.reconcile-google-play-subscriptions]')).split(/\r?\n/)[1]?.trim() === 'verify_jwt = false',
  'The reconciler has its fair-scheduling column/index and is configured for private handler-level authentication'
);
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

// Mistakes notebook navigation and access regression coverage.
assert.ok(app.includes("const VaultScreen = lazy(() => import('./screens/VaultScreen'))"), 'Mistakes notebook screen is lazy-loaded');
assert.ok(app.includes('<Route path="/vault" element={showTrackAccessCheck ?') && app.includes(': <VaultScreen />} />') && app.includes("location.pathname === '/vault' && setupParams.has('track')"), 'Mistakes notebook has a track-guarded route while the global notebook remains usable');
assert.ok(app.includes("currentMode === 'PRACTICE'") && !app.includes("currentMode === 'PRACTICE' || currentMode === 'DRILL'"), 'Free practice remains available but free-sample mistake drills require a license');
assert.ok(appDrawer.includes('Mistakes notebook') && appDrawer.includes('path="/vault"'), 'Mistakes notebook is available from the app drawer');
assert.ok(trackHubScreen.includes("gated('Mistakes Notebook'") && trackHubScreen.includes('`/vault?track=${key}`'), 'Each track hub opens its scoped mistakes notebook through the license gate');
assert.ok(vaultScreen.includes('useSearchParams') && vaultScreen.includes('scopedItems'), 'Mistakes notebook supports global and track-scoped views');
assert.ok(vaultScreen.includes('hasAnyActiveLicense') && vaultScreen.includes('An active license is required') && vaultScreen.includes('isTrackUnlocked(item.track)'), 'Mistakes notebook is locked without a license and filters mistakes to their active licensed track');
assert.ok(!vaultScreen.includes('verifiedFreeItems') && !vaultScreen.includes('authorizeQuestionSet'), 'Free-sample mistakes cannot bypass the Mistakes Notebook license gate');
assert.ok(trackHubScreen.includes("badge: !unlocked ? 'LICENSE REQUIRED'"), 'Track hub clearly marks the notebook as license-required for unlicensed tracks');
assert.ok(paywallDialog.includes('const purchaseCode = paidProductCodeForTrackId(trackValue)') && !paywallDialog.includes('entitlementsVerified ?'), 'Guests see the correct track-specific Bond Store purchase dialog without requiring an authenticated license lease');
assert.ok(licenseStore.includes('refreshGeneration++') && licenseStore.includes('generation !== refreshGeneration') && licenseStore.includes('clearLicense:') && licenseStore.includes('clearOfflineEntitlements();'), 'Explicit sign-out invalidates in-flight lease restoration while temporary session expiry retains the signed offline grant');
assert.ok(app.includes('const showTrackAccessCheck = setupNeedsLicense && (!entitlementsChecked || !hasActiveSetupLicense)') && app.includes('<Route path="/practice/competences" element={showTrackAccessCheck ?'), 'Unlicensed direct Practice All Questions URLs do not render protected competence counts before redirecting to the Bond Store popup');

assert.ok(vaultStore.includes('recordCorrectAttempt') && vaultStore.includes('consecutiveCorrect: 0') && vaultStore.includes('next >= threshold'), 'Mistakes reset redemption progress after wrong answers and are removed after consecutive correct answers');
assert.ok(practiceStore.includes('recordCorrectAttempt(q.id)') && practiceStore.includes("if (s.mode === 'MOCK') for (const q of s.questions)") && practiceStore.includes("if (answer?.isCorrect) useVaultStore.getState().recordCorrectAttempt(q.id)"), 'Correct answers in practice/drill and mock exams advance notebook redemption progress');
assert.ok(vaultScreen.includes('2 consecutive correct answers') && vaultScreen.includes('Math.min(item.consecutiveCorrect,2)'), 'Mistakes notebook explains and displays redemption progress');
assert.ok(vaultScreen.includes('Mistakes by track & competence') && vaultScreen.includes('Search results') && vaultScreen.includes('Practice track') && vaultScreen.includes('expandedCompetencies'), 'Mistakes notebook groups by track and competence, supports searchable results, and offers scoped drills');
assert.ok(bookmarksScreen.includes('Bookmarks by track & competence') && bookmarksScreen.includes('Search results') && bookmarksScreen.includes('Practice track') && bookmarksScreen.includes('expandedCompetencies'), 'Bookmarks group by track and competence, support searchable results, and offer scoped practice');
assert.ok(bookmarksScreen.includes('q.functionId') && bookmarksScreen.includes('q.explanation') && vaultScreen.includes('item.functionId') && vaultScreen.includes('item.explanation'), 'Saved-question search covers function and explanation metadata as well as question text');
// Desktop Account dropdown: correct destinations and an authenticated, license-clearing logout.
assert.ok(
  bottomNav.includes('<DesktopAccountMenu />') &&
  desktopAccountMenu.includes("to: '/account?tab=payments'") &&
  desktopAccountMenu.includes("to: '/account?tab=licenses'") &&
  desktopAccountMenu.includes("to: '/orders'") &&
  desktopAccountMenu.includes('Sign Out'),
  'Desktop Account dropdown shows Bond Store, My Licenses, Orders, and Sign Out'
);
assert.ok(
  desktopAccountMenu.includes("accountLinks.filter(link => signedIn || link.to === '/account?tab=payments')") &&
  desktopAccountMenu.includes('{signedIn ? (') &&
  desktopAccountMenu.includes('Sign In'),
  'Signed-out visitors see only Bond Store and Sign In; licenses, orders, and Sign Out require a session'
);
assert.ok(
  desktopAccountMenu.includes('onClick={() => { void signInWithGoogle() }}') &&
  desktopAccountMenu.includes("const { error } = await client.auth.signInWithOAuth({") &&
  desktopAccountMenu.includes("provider: 'google'") &&
  desktopAccountMenu.includes("redirectTo: 'https://hyperionmaritime.org/auth/callback'") &&
  desktopAccountMenu.includes("queryParams: { prompt: 'select_account' }") &&
  desktopAccountMenu.includes("localStorage.setItem('hyperion-oauth-return-to'") &&
  desktopAccountMenu.includes("mode: 'redirect'") &&
  !desktopAccountMenu.includes('to="/account"'),
  'Guest desktop Sign In starts Google OAuth directly and returns through the existing callback without opening Bond Store first'
);
assert.ok(
  desktopAccountMenu.includes('onMouseEnter={() => setOpen(true)}') &&
  desktopAccountMenu.includes('onMouseLeave=') &&
  desktopAccountMenu.includes("event.key === 'Escape'") &&
  desktopAccountMenu.includes("document.addEventListener('pointerdown', handleOutsideClick)") &&
  desktopAccountMenu.includes('aria-expanded={open}') &&
  desktopAccountMenu.includes('hidden={!open}'),
  'Desktop Account dropdown opens on hover or keyboard interaction and closes on escape/outside click'
);
assert.ok(
  desktopAccountMenu.includes('client.auth.signOut()') &&
  desktopAccountMenu.includes('useLicenseStore.getState().clearLicense()') &&
  desktopAccountMenu.includes("navigate('/account', { replace: true })") &&
  desktopAccountMenu.includes('if (!client || !signedIn || signingOut) return'),
  'Desktop Sign Out authenticates the session state, clears licenses, and returns to Account'
);
assert.ok(
  indexCss.includes('.app-bottom-nav > a[href="/account"] { display: none !important; }') &&
  indexCss.includes('.desktop-account-menu { display: none; }') &&
  indexCss.includes('.app-bottom-nav .desktop-account-popover[hidden] { display: none !important; }'),
  'Desktop dropdown replaces only the desktop Account tab and preserves mobile navigation'
);

console.log('Release-safety smoke checks passed.');

assert.ok(!questionBankClient.includes("supabase!.functions.invoke('question-bank'") && (await read('../src/lib/questionBankTransport.ts')).includes("fetcher('/api/question-bank/questions'") && questionBankClient.includes('invokeQuestionBank({'), 'Normal and automatic-pack question pages share GitHub Worker routing');
