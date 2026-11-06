# Bounded payment polling

Approved scope: reduce payment-check requests and deploy, preserving server verification, signed webhooks, explicit refresh, and the checkout success-return flow.

Use one small scheduler for account, orders, and checkout background reconciliation. Check immediately, then wait 8, 15, 30, and 60 seconds, capped at 60 seconds. Stop after ten minutes of wall time; visibility/focus changes must not reset that budget or bypass the current delay. Pause while hidden or offline. Never overlap callbacks, and cancel future work on unmount/account changes. Preserve deadline, retry delay, and in-flight state across pending-order changes within the same screen/account. Only pending PayMongo orders created within 24 hours qualify for automatic reconciliation; manual refresh can still check older orders. Deduplicate checkout batch IDs.

Checkout's separate five-second data refresh also uses the bounded scheduler, while keeping refresh on return to the page after the automatic window ends. Confirmed payment still refreshes orders, entitlements, and basket state. Do not change backend payment processing or trust client-side payment claims.

1. Add deterministic tests for backoff, visibility/offline pauses, expiration, cancellation, in-flight work, failures, and old/batched orders; demonstrate failure before implementation.
2. Implement the shared scheduler and eligibility helper; replace the three reconciliation intervals and checkout data-refresh interval.
3. Extend the synthetic browser fixture to exercise recent/old pending orders, background pause, confirmation, and manual refresh. Register scheduler tests in CI.
4. Run scheduler, security, build, and account browser tests; review the diff; push a focused PR, merge after checks, and verify the live deployment.

Local verification passed: deterministic scheduler tests; full synthetic account browser suite including three-screen visibility/old-order checks, manual refresh and payment confirmation, and a two-batch deadline regression; release-safety smoke checks; production build; diff checks. Review found no remaining blockers after preserving the shared deadline and in-flight state.
