# Hyperion Maritime — Supabase Free transition checklist

Updated 2026-11-12. Project: `hyperion-maritime` (`evnjoezffghtrzqacwcj`). **This document does not change the billing plan.**

## 1. Measured baseline (read-only, 2026-11-12)

- PostgreSQL database: prior sample **241 MB (253,138,611 bytes)**; later read-only sample **257,586,867 bytes (~257.6 MB decimal)**, **51.52%** of a conservatively interpreted 500,000,000-byte Free database quota. Supabase documents **500 MB**, not an explicit 500 MiB allotment. The current value will change.
- Question-bank private Storage bucket: **220 objects, ~20 MB**; Free storage quota: 1 GiB. These are encrypted application assets; do not delete them to save 20 MB.
- Major PostgreSQL tables: progress revisions ~148 MB, session archives ~52 MB, current progress ~15 MB.
- PostgreSQL cumulative update counts: `google_play_purchase_links` 43,853; `google_play_entitlements` 23,201. Historical counters are **not** daily usage and don't prove their current rate.
- Existing Google Play background reconciliation: every 15 minutes; 20 links per pass; RTDN and authenticated client sync remain independent. This PR skips some **unchanged database entitlement writes** but still verifies Google with the same cadence; latest state, revocations, new expiries and failed reads always use original atomic RPC.
- Other cron tasks: abandoned PayMongo checkout cleanup every 30 minutes; inactive-account policy daily. Keep these in place unless separately audited with payment/retention tests.
- Current project is healthy. This check does **not** verify monthly egress, Edge invocations, or Supabase's host Disk IO % consumed. Inspect their actual usage charts; do not infer them from `pg_database_size` or cumulative WAL.

Free plan (Supabase's current documentation): 500 MB database, 1 GB Storage, 5 GB uncached + 5 GB cached egress, 500k Edge Function calls/month, 50k Auth MAU, 200 peak Realtime connections. Function wall-time limits and compute RAM differ from paid.

## 2. Production safeguards and rollback

- Protected preexisting progress revisions remain untouched; maintain 10 future recovery checkpoints per account and 5-minute routine checkpoint spacing.
- Finished exams, bookmarks/mistakes, deletion tombstones, offline packs and older devices retain their existing access rules. Free users should not download paid question banks or upload progress.
- The Google Play no-op guard must run only **after the Google API response is verified**, all link checks complete, and the server has returned current grants. When any comparison fails, run the original `sync_google_play_subscription_atomic` RPC. Reconciliation/RTDN frequency stays unchanged. A forced material reconciliation occurs at least every six hours, even when content is identical.
- If entitlement display differs or a refund/revocation is delayed, revert only the Edge Function to its prior version; do not change licenses or disable Google Play RTDN/cron. No migration or account data rewrite is needed for this optimization.
- Never prune protected revision IDs, delete question-bank bucket objects or run `VACUUM FULL` as an emergency space fix.

## 3. Backup BEFORE downgrading

**Current blocker (2026-11-12):** The existing `.github/workflows/private-database-backup.yml` intentionally runs only for a **private** repository, while `Nhyle-zunne/hyperion-pwa` is currently **public**. Therefore the daily database backup job is **skipped**, not protecting production, and the existing script does not export actual Storage object bytes. Keep the security guard: do not enable private-data backups into public-repo Actions artifacts. Use a separately controlled private backup environment or a trusted local machine, with secrets and encryption keys kept outside the public repository. Neither a production ciphertext nor a successful isolated restore was verified in this audit.

**Most important difference:** Free does not provide automatic Supabase daily database backups. Supabase recommends independent offsite exports. Do not downgrade until you have verified **a recent recoverable database backup and a separate copy of Storage objects**.

1. From Pro, download the latest available backup in Supabase **Database → Backups**, or perform a supported logical export with the Supabase CLI `supabase db dump`/PostgreSQL `pg_dump` using an authorized direct or pooler connection. A database export contains sensitive user, entitlement, order and audit records.
2. **Encrypt immediately** (e.g. with `age` or encrypted backup storage), store outside Supabase and outside this public GitHub repository. Do not commit SQL dumps, credentials, purchase tokens, question ciphertext keys, service-role keys or exported personal data. Retain offline decryption-key recovery instructions.
3. The SQL dump contains **Storage metadata, not Storage object bytes**. Export all private `question-banks` objects separately using authenticated Supabase Storage tooling, preserving exact paths, bytes, and encryption. Do not make the bucket public.
4. Test restoring into an **isolated** non-production environment. Verify table counts for `user_learning_progress`, `user_learning_progress_revisions`, `user_learning_session_archives`, `orders`, `entitlements` and Google Play linkage, plus object hashes/paths. Do not overwrite production to test.
5. Plan continued **regular offsite backups** after downgrade, with a written recovery interval and ownership of the encryption key. No automatic backup workflow has been enabled by this PR; it needs properly configured secrets, a secure destination and a verified restore rehearsal.

Source: https://supabase.com/docs/guides/platform/backups

## 4. Monitor quota and operational safety

- Run `supabase/reports/free-tier-readiness.sql` in Supabase SQL Editor. It now uses conservative decimal limits of **500,000,000 bytes for the database** and **1,000,000,000 bytes for Storage**, with **75% warning / 85% critical** thresholds. Record dated readings; a quota-only green result is not Nano I/O readiness. **Do not delete customer recovery data to lower the meter**.
- In Supabase organization **Billing → Usage**, review uncached/cached egress and Edge Function invocations *over the current billing period*. The SQL report cannot inspect them. Look specifically for authenticated question-bank bytes accidentally served through Supabase rather than the GitHub/Cloudflare delivery path.
- In **Observability**, inspect Disk IO % consumed over days, not only cumulative WAL totals. Free has shared CPU and less RAM; a low logical database size does not guarantee low disk pressure.
- Test a real PayMongo checkout return + webhook license grant, revocation, Google sign-in, Android/PWA license sync, active/expired Google Play entitlements, offline licensed packs and saved-session recovery after the plan change. Avoid live duplicate payments: perform controlled purchases/refunds with the correct environment.
- Set a calendar check of Supabase pause warnings. **Free projects can pause after about 7 days of insufficient real activity.** Genuine user traffic may keep the project active but is not a guarantee; artificial keep-alive pings are not a substitute for a paid availability guarantee. A paused Auth/DB may interrupt checkout/license activation. When uptime is a non-negotiable requirement, Free is not equivalent to Pro.
- Before downgrading, confirm the *organization-level* bill, any extra paid projects/add-ons, current storage and egress billing cycle. The downgrade may settle usage already incurred under Pro.

Sources:
https://supabase.com/docs/guides/platform/billing-on-supabase
https://supabase.com/docs/guides/platform/free-project-pausing
https://supabase.com/docs/guides/platform/manage-your-subscription

## 5. Free transition acceptance criteria

Do **not** mark the transition complete until all are verified:

- Current DB under 375 MB, Storage under 1 GB, egress/Edge usage below plan quota with margin.
- Independent encrypted and test-restored database backup **plus all Storage objects**.
- Paid website/Android license sync and Google Play RTDN tested; no direct client table writes or privileged data exposure.
- Zero paid question-bank download requests for unlicensed users; unchanged encrypted offline packs served from local cache.
- Original full-snapshot progress recovery still works; cross-platform incremental V2 must remain disabled until its separate end-to-end tests pass.
- Supabase Free inactivity pause and lack of automatic daily backups consciously accepted as business availability risks.

**No guarantee of zero outage** is possible on Free. This runbook is a risk-reduction checklist, not a claim of paid-tier reliability.


## 6. November 12 archive traffic reduction and safe measurement

- PWA routine **draft** session archives now use a **30-second window beginning at the first changed encrypted IndexedDB save**, rather than the previous 12-second window. This only coalesces network uploads: IndexedDB writes for every real change still complete immediately.
- A completed exam remains an **immediate cloud checkpoint**. Hiding or navigating away from the app makes an additional best-effort flush, but browsers may abort it; the durable IndexedDB archive and login/reconnect retry are the recovery safety net.
- The deduplicating SQL RPC still rejects unchanged and stale archive writes. Server licensing and user ownership are checked on every cloud request; nothing is cached to circumvent entitlement expiration.
- This is **not** a promise of a particular percentage reduction. The savings depend on whether an active user generates multiple draft edits within each coalescing window. Rare or isolated saves are unaffected.
- In Edge Function logs, group request counts by **deployment version** as well as endpoint and hour. On November 12, approximately 16,796 of 17,490 recent progress requests came from historical Edge version 129; extrapolating that 24-hour total would greatly overstate the projected rate for version 132. New backend/client features cannot be assessed using old versions' traffic.
- Review the project's **actual billable Edge invocations** (not raw request log counts), cached and uncached bandwidth, and Auth users in **Billing → Usage**; compare at least **48–72 hours of representative traffic** following the PWA release against the same times of day before release. Use a conservative buffer: if a 30-day projection is anywhere near the Free allowance, do not downgrade.
- `supabase/reports/free-tier-readiness.sql` now also reports the size and count of V2 operation receipts. Receipts should be zero while both clients keep V2 disabled. Do not manually remove receipts when the protocol eventually becomes active because an offline client may need to replay an unacknowledged operation.
- A public-GitHub CI synthetic database backup test is **not** a verified offsite production backup. Secure encrypted external backups and restore them in an isolated test project before going Free.

### Verification of draft archive delivery

1. Start a paid session online, change several answers during 30 seconds, and verify encrypted local resume survives reload **before** cloud confirmation.
2. Finish an exam and verify the completed record and audit can be opened again after switching devices.
3. Go offline during a draft, edit questions, reconnect, and verify cloud history catches up without overwriting a newer completed audit.
4. Switch Google accounts and verify no progress from the previous account is sent to the newly signed-in one.
5. Revoke/expire a license and verify that paid question access is denied while prior saved user history is preserved.

Do **not** claim a production Free transition is complete until these acceptance cases and the independent backup are confirmed.


## Nano compute and I/O eligibility — 2026-11-12

**Do not treat a high PostgreSQL cache hit rate or a small database as proof that Nano is safe.** Current PostgreSQL counters are cumulative since their own reset timestamps. In the Nov 12 audit, database ~246 MiB, cumulative cache hit ~99.96%, active connections low, zero replication slots; however `pg_stat_wal` recorded ~18 GB **since Oct 2**, mainly from older full progress and session-archive writes. This is **not** current disk I/O in GB/day.

Published Nano minima: 250 sustained IOPS, 5 MB/s sustained throughput, and up to 0.5 GB RAM (versus Micro 500 IOPS, 11 MB/s, 1 GB RAM). Nano is available as the base **Free-plan** compute, not a normal newly selectable paid-Pro instance. Compute resizing can incur downtime; do not alter the organization plan before verifying backups.

1. Use `supabase/reports/nano-io-readiness.sql` twice, 15–60 minutes apart, and calculate **deltas** of WAL bytes, page reads, write counts and table growth. These are database indicators and do not equal physical IOPS, actual hardware throughput or disk-budget balance.
2. In Supabase Dashboard → Observability → Database Health and Infrastructure settings, compare the **lowest sampled Disk IO Budget balance over seven days** (not just averaged balance), CPU/IOWait, memory pressure, swap, throughput and read/write IOPS. A low historical average is not enough if short periods hit zero. Track after the most recent PWA rollout, not mixed legacy function versions.
3. Look for a full normal weekday plus a peak user session and scheduled Google Play reconciliation. Project Nano's smaller memory footprint can increase cache misses and swap I/O even when current compute has 99.96% cache hits.
4. Before downsizing, produce a **real, encrypted, offsite production database + all private Storage files backup** and perform an isolated restore. Previous CI only tested synthetic fixtures.
5. Confirm actual monthly Edge **billable invocations**, bandwidth, Free storage limits, Auth limits, and accept Free projects' inactivity pauses. No Nano guarantee is possible until the actual infrastructure I/O and memory metrics are observed.
6. If those metrics suggest margin, use a scheduled low-traffic maintenance window to move to Free/Nano (or the smallest supported plan/compute), and monitor the worst IO balance, swap, checkout, license renewals, and saved audits after the change. Be prepared to restore higher compute if I/O throttles.

### Activity tracking efficiency

Routine paid-account activity (used solely to protect accounts from long-term inactivity cleanup) is now attempted at most once every **six hours per account/device** from the PWA; success hints persist across browser reloads and tabs, while failures back off for ten minutes rather than retrying on every focus. The service itself suppresses redundant cross-device database writes for six hours, including requests from older PWA versions. A 30-day inactivity period **plus** a further 30-day grace is still evaluated by the existing retention worker; payment licensing, expiry, renewal and immediate admin revocations are independent of activity markers. Free/unsigned users remain excluded from optional activity calls.

This reduces unnecessary Edge, Supabase Auth and PostgreSQL activity for frequent PWA visits. **It does not reduce the full-snapshot progress WAL by itself**. Only compare like-for-like post-deploy traffic to quantify the benefit.

Current compute documentation: https://supabase.com/docs/guides/platform/compute-and-disk
High Disk I/O troubleshooting: https://supabase.com/kb/troubleshooting/exhaust-disk-io
