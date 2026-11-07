# Query plans and payment reconciliation

User scope: inspect real plans for orders, entitlements, progress and admin searches, adjust indexes only where justified, and reduce duplicate backend payment verification while preserving exactly-once fulfillment under repeated notifications.

Query work: inspect indexes, table/cohort sizes and bounded SELECT EXPLAIN ANALYZE/BUFFERS plans without exporting user payloads. Document actual planner decisions and timings. Do not add unused admin name/email indexes to an application that filters an Auth directory in memory. Preserve RLS and recovery history.

Payment work: preserve fresh authentication on every request, strict stored-order/provider metadata, amount/currency/mode checks, webhook signature verification and the shared atomic finalizer. Coalesce overlapping verification work per owner/reference/mode within a warm Edge worker. Reuse only fully validated pending JSON responses for at most two seconds in a bounded private in-memory cache; never cache paid, error or authorization results. Provider GETs have an eight-second timeout and no immediate automatic retries. Cold workers may still issue separate provider reads; correctness remains enforced by database transactions.

Test existing same-reference idempotence and cross-reference payment-ID reuse under real PostgreSQL concurrency. Only if a failing test demonstrates a gap, add the smallest schema-only finalizer guard with a data-preserving rollback. Do not create real payments or change production orders/entitlements as tests.

1. Capture query-plan evidence in parallel with synthetic payment tests.
2. Reproduce provider duplication/timeout and any database race before changes.
3. Implement bounded verification coalescing and any demonstrated database guard; test signed webhook replay, auth/ownership/mode/amount/session rejection, retry failures, cache expiry and concurrency.
4. Run security/build/browser and full PostgreSQL CI; review. Apply any reviewed additive/schema-only database changes before deploying backend functions with existing JWT/webhook settings preserved; publish and verify the production release.

Evidence: the 34-plan production audit found existing access indexes sufficient at current sizes; no speculative index was added. An isolated PostgreSQL baseline race returned paid for both a basket and a legacy reference sharing one payment ID. The new transaction lock changes that to one paid result and one reconciliation-required result. Same-reference concurrency, repeated delivery, expiry stability and distinct legitimate renewals also pass. The local verification handler test reproduced two provider reads before coalescing and now confirms one. Deno checks, synthetic handler/SQL tests, security smoke checks and production build passed; review found no blockers.
