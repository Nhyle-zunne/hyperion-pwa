# Messenger claims implementation plan

Spec: `docs/superpowers/specs/2026-11-25-messenger-claims-design.md`.

## Task 1 — Claim schema and atomic lifecycle

Files: `supabase/migrations/20261125110000_manual_checkout_claims.sql`, `scripts/tests/manual-checkout-claims-test.mjs`.
1. RED: Add invariants/tests for authenticated owner-only read, no client mutations, canonical server prices, idempotent open cart, max-three-open limit, 72h expiry and no payout on creation.
2. GREEN: Add table, RLS, service-role-only `create_manual_checkout_claim` RPC and `review_manual_checkout_claim` RPC with row locks and atomic multi-item fulfillment, including subscription order history and manual lifetime grants.
3. Verify: `node --test scripts/tests/manual-checkout-claims-test.mjs`.

## Task 2 — Authenticated customer checkout

Files: `supabase/functions/create-manual-checkout-claim/index.ts`, `src/lib/manualQrCheckout.ts`, `src/screens/AdminQrCheckoutScreen.tsx`, QR checkout tests.
1. RED: Test copy text includes claim ID and amount; invalid claims never claim successful copy.
2. GREEN: Authenticated function calls private RPC, one CTA creates/reuses claim then copies and opens Messenger, exposes fallback text and status; preserve original QR bytes and bank copy buttons.
3. Verify: `node --test scripts/tests/manual-qr-checkout-test.mjs scripts/tests/manual-checkout-claims-test.mjs`.

## Task 3 — Administrator verification workflow

Files: `supabase/functions/admin-payment-review/index.ts`, `src/screens/AdminPaymentsScreen.tsx`, tests.
1. RED: Test action guards and state transitions, meaningful statuses and preservation of legacy payment submissions.
2. GREEN: Add claim list, mark-proof-received, approve/reject via RPC, separate responsive section, messages explicitly distinguishing an attempted claim from bank-confirmed payment.
3. Verify: focused Node tests and production TypeScript build.

## Task 4 — Full verification and PR

Run `npm run test:security`, `npm run build`, `npm run test:offline-build`, relevant SQL tests and code review. Commit changes to isolated branch, push, open focused PR; do not merge/deploy without new authorization. Review focus: user spoofing, direct RLS writes, forged amounts, duplicate or concurrent approval, lifetime product conflicts, old PayMongo data, and status clarity.
