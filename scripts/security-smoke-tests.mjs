import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');
const [
  pricing, checkout, verify, webhook, questionBank, questionBankMigration,
  finalizerMigration, priceCorrectionMigration, functionConfig, app, practiceStore, mockExam, licenseStore, basketScreen, accountScreen,
  indexCss, manualPayment, ordersHistory, historyScreen, studyTimeScreen, trackSelectionScreen
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
  read('../src/screens/TrackSelectionScreen.tsx')
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
assert.ok(trackSelectionScreen.includes('for (let dayNumber = 1; dayNumber <= 7; dayNumber++)') && trackSelectionScreen.includes('const daysAgo = 7 - dayNumber'), 'Dashboard streak moves forward chronologically from Day 1 through Day 7');
assert.ok(trackSelectionScreen.includes('const label = `DAY ${dayNumber}`') && trackSelectionScreen.includes('dayNumber === 7 ? `TODAY · ${formattedDate}`'), 'Dashboard labels Day 1 to Day 7 with Today at the end');
assert.ok(trackSelectionScreen.includes('className="daily-streak-grid"') && trackSelectionScreen.includes('className="daily-streak-status"'), 'Dashboard streak uses dedicated responsive styling for large labels and status indicators');
assert.ok(indexCss.includes('.daily-streak-status') && indexCss.includes('font-size: clamp(2rem, 3.1vw, 3.1rem)') && indexCss.includes('@media (max-width: 599px)'), 'Streak labels and checkmarks scale up on desktop and remain responsive on mobile');

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
