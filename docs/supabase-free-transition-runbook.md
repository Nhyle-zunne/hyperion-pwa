# Hyperion Maritime — Supabase Free transition checklist

Updated 2026-11-12. Project: `hyperion-maritime` (`evnjoezffghtrzqacwcj`). **This document does not change the billing plan.**

## 1. Measured baseline (read-only, 2026-11-12)

- PostgreSQL database: **241 MB (253,138,611 bytes)**; 500 MiB Free quota; ~48% used, ~259 MiB available.
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

**Most important difference:** Free does not provide automatic Supabase daily database backups. Supabase recommends independent offsite exports. Do not downgrade until you have verified **a recent recoverable database backup and a separate copy of Storage objects**.

1. From Pro, download the latest available backup in Supabase **Database → Backups**, or perform a supported logical export with the Supabase CLI `supabase db dump`/PostgreSQL `pg_dump` using an authorized direct or pooler connection. A database export contains sensitive user, entitlement, order and audit records.
2. **Encrypt immediately** (e.g. with `age` or encrypted backup storage), store outside Supabase and outside this public GitHub repository. Do not commit SQL dumps, credentials, purchase tokens, question ciphertext keys, service-role keys or exported personal data. Retain offline decryption-key recovery instructions.
3. The SQL dump contains **Storage metadata, not Storage object bytes**. Export all private `question-banks` objects separately using authenticated Supabase Storage tooling, preserving exact paths, bytes, and encryption. Do not make the bucket public.
4. Test restoring into an **isolated** non-production environment. Verify table counts for `user_learning_progress`, `user_learning_progress_revisions`, `user_learning_session_archives`, `orders`, `entitlements` and Google Play linkage, plus object hashes/paths. Do not overwrite production to test.
5. Plan continued **regular offsite backups** after downgrade, with a written recovery interval and ownership of the encryption key. No automatic backup workflow has been enabled by this PR; it needs properly configured secrets, a secure destination and a verified restore rehearsal.

Source: https://supabase.com/docs/guides/platform/backups

## 4. Monitor quota and operational safety

- Run `supabase/reports/free-tier-readiness.sql` in Supabase SQL Editor. Record readings by date. Suggested internal alarms: **375 MB (75%) warning, 425 MB (85%) stop-and-investigate**; absolute Free quota 500 MB. **Do not delete customer recovery data to lower the meter**.
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
