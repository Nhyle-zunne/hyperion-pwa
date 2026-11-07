# Query plan audit: November 7, 2026

## Decision

Keep the existing indexes. Current production measurements do not justify an
additional index migration. No schema, policies, records or provider state were
changed. No production logs were queried. No deployment or rollback is needed.

[The redacted JSON artifact](query-plan-audit-2026-11-07.json) contains 34 actual
`EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` results with normal planner settings,
including bounded repeats of initially slower samples. It retains query shapes
and business constants, redacting account/order UUIDs, cursor timestamps and
session identifiers. No returned application records are persisted.

## Method and scope

Inspected current application SELECTs, production indexes, ownership policies,
table statistics and exact aggregate counts. Existing owner cohorts were chosen
by aggregate count: order owners had 10 and 3 records; two active-entitlement
owners each had 2 records; the revision owner had 31 records. Administrator
dependencies used the current 193 account IDs, and paid-order dependencies used
64 IDs. Identifiers were retained temporarily for plans and redacted afterward.

Most plans use the privileged SQL connection, representing service-role access
in Edge Functions. Four additional owner-history, keyset, pending and entitlement
plans use transaction-local `authenticated` role and JWT subject in a read-only
transaction followed by rollback. These exercise existing ownership RLS without
changing auth configuration or policies.

| Table | Exact rows at capture |
| --- | ---: |
| orders | 89 |
| entitlements | 78 |
| google_play_entitlements | 32 |
| user_learning_progress | 186 |
| user_learning_progress_revisions | 1,341 |
| user_learning_session_archives | 1,215 |
| user_activity | 153 |
| checkout_batches | 2 |
| license_admin_audit | 16 |

Archive statistics estimated 1,214 just before the exact count; production
continued normal activity during this audit. Orders occupied 160 kB including
indexes; revisions occupied 107 MB including indexes and TOAST.

## Measured access paths

Times are individual server execution samples, not percentiles or an SLA.
Every captured plan reported zero shared disk-read blocks.

| Request shape | Observed plan and evidence |
| --- | --- |
| History: owner, `created_at DESC, id DESC LIMIT 26` | Ten-order cohort: sequential scan plus sort, 9 shared-hit blocks, repeated 0.143–0.145 ms. Three-order cohort: `orders_user_id_idx` plus sort, 0.156 ms. Authenticated RLS sample: 0.167 ms. |
| History: full projection and two-column OR keyset | Sequential scan plus sort, 5 matching rows, 9 hits, 0.212 ms; authenticated RLS 0.216 ms. |
| Pending projection: owner/status/method, ID order, limit 100 | Existing `orders_one_open_per_user_product_uq` plus sort, 4 hits, repeated 0.091–0.092 ms; authenticated RLS 0.147 ms. ID-continuation predicate also measured (1.801 ms). No open pending records existed; these do not demonstrate a populated pending cohort. |
| Active unexpired entitlements by owner | Existing unique `(user_id, product_code)` bitmap scan, 2 hits, 0.074–0.122 ms for two cohorts; authenticated RLS 0.090 ms. Existing partial `entitlements_active_expiry_idx (user_id, expires_at) WHERE status = 'active'` is also installed; the planner preferred the unique owner prefix for these tiny cohorts. |
| Progress version, snapshot, owner plus matching version | Existing `user_learning_progress_pkey`, one row, 2 hits, 0.082–0.126 ms. The version-only request already avoids transferring snapshot JSONB. |
| Historical revisions: owner, captured-time order | Existing `learning_progress_revisions_owner (user_id, captured_at DESC)`, bitmap scan plus sort, 31 rows, 20 hits; repeated 0.257 and 0.270 ms. Initial 25.043 ms sample is retained; unchanged repeats do not support attributing it to a missing index. |
| Session archive: owner plus session ID | Existing composite primary key, one row, 3 hits, repeated 0.118–0.130 ms. |
| Admin activity cohort | Sequential scan, 153 matching rows, 2 hits, 1.944 ms. The cohort covers essentially the whole table. Existing `user_activity_pkey` covers selective owner lookups. |
| Admin open orders / pending batches | Existing partial open-order / `checkout_batches_user_status_idx` index-only scans, zero matches, 1 hit each, 0.082 / 0.746 ms. |
| Admin failed-checkout dependencies | Sequential scan, 6 matches from 89 orders, 3 hits, 0.837 ms. |
| Admin audit dependencies | Sequential scan, 16 rows, 1 hit, 1.279 ms. Existing `license_admin_audit_admin_user_idx` supports selective administrator lookups. |
| Admin website / Play license lists | Sequential scans plus sorts of all 78 / 32 rows, 5 / 4 hits, 0.215 / 0.147 ms. These requests fetch all licenses in pages. |
| Admin payment-review list | Sequential scan plus sort, 78 rows, 6 hits, 0.228 ms. Its 200-row limit exceeds the current result set. |
| Admin paid-order entitlement dependencies | Sequential scan, 64 rows, 2 hits, 0.105 ms. Existing `entitlements_order_id_idx` covers selective order lookups; this cohort returns most entitlements. |
| Admin reconciliation alerts | Empty sequential scan plus sort, 3 hits, 0.112 ms. |

Initial history/pending/archive samples were 1.277/1.266/1.968 ms; unchanged
repeats are retained. No planner switches, forced index scans, index creation or
production ANALYZE were used.

## Administrator search constraint

`admin-license-management` pages Auth `listUsers` (1,000 per page, at most 50
pages), loads license rows, and batches activity/payment/audit dependencies.
`AdminLicensesScreen.tsx` filters email, display name and ID with JavaScript
`includes` after loading those records; sorting also runs in memory. There is
no database email/name search predicate for a search index to accelerate.
The payment-review function also pages Auth to resolve owner emails.

No unused public-profile or Auth search index was added. Auth calls, full-list
transfers, UI filtering and pagination caps are application constraints. Changing
them needs a separately scoped search/pagination design.

## Limits and follow-up

Recheck history and its exact OR keyset when per-owner histories grow enough to
make sorts or filtered scans measurable. A future candidate is
`orders (user_id, created_at DESC, id DESC)`; this audit does not install it.
A pending-specific index needs a populated workload and measured benefit.
Existing partial uniqueness already bounds open orders per owner/product.

Recheck administrator full-list requests as accounts/licenses grow. Excellent
indexes cannot remove their transfer volume. These plans do not measure Auth
pagination, PostgREST serialization, network time or full browser latency.
EXPLAIN does not transfer result rows or necessarily detoast full JSONB payloads;
the revision plan does not prove recovery payload costs are negligible.

No synthetic large-table comparison was needed: existing selective paths are
indexed and measured broad scans touch only 1–9 cached blocks. A hypothetical
large-data win would not establish present production benefit. No billing
reduction, future-size performance or unseen-query claim follows from this audit.

