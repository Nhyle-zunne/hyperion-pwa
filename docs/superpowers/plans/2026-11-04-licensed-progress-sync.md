# Licensed progress synchronization implementation plan

> Execute inline with superpowers:executing-plans; independent final review.

**Goal:** Zero automatic learning-progress requests for accounts without a verified active license.
**Architecture:** Account-local recovery is independent from a shared verified entitlement gate. All progress/archive boundaries use that gate; activation hydrates before merging/uploading.
**Tech stack:** TypeScript, Zustand, encrypted IndexedDB, Supabase Edge, Playwright/Bun/Deno.
**Spec:** ../specs/2026-11-04-licensed-progress-sync-design.md

## Constraints

No production record/revision/archive/backup deletion. Keep Android/PWA contracts,
server-side content authorization, payment/Auth, online-only free questions and
licensed features. No metadata-based authorization or new paid service.

## Review focus

- Entitlement resolves after auth: no startup free requests; activation still hydrates.
- Expiry/account change during await: no further requests, late apply or ACK.
- Account switching offline: restore only owner-bound local state and archives.
- Renewal with old cloud + newer local work: merge, do not overwrite or duplicate.
- Failed cloud read: keep dirty encrypted local work and retry only while licensed.

## Task1: Eligibility and account-local lifecycle

Files: licenseStore.ts, new lib/cloudProgressAccess.ts, progressSync.ts;
tests: license-refresh.test.ts and synthetic browser sync fixture.
- [x] Audit signed grant owner/expiry, auth ordering, encrypted persistence and Android contracts.
- [x] Add failing tests for guest/free/expired/revoked zero calls, owner binding, activation and renewal.
- [x] Add explicit verified entitlement account identity; derive account-bound sync permission.
- [x] Separate local account preparation/cache restoration from cloud initialization; invalidate timers and responses on entitlement changes.
- [x] Gate reads/writes/recovery/retries after async boundaries and preserve dirty work.
- [x] Verify local browser restart, offline account switch, activation merge, conflicts and failures.

## Task2: Archive boundaries and history recovery

Files: sessionArchive.ts, shared gate, existing browser fixtures/tests.
- [x] Write failing tests for free missing-archive and background uploads, activation batches and expiry mid-batch.
- [x] Gate network operations while preserving encrypted local saves/reads and immutable finished audits.
- [x] Verify guest/account ownership, no paid cache access through free UI, and online-only free resume behavior.
- [x] Audit Edge function; preserve server backup/recovery rights and authoritative content checks.

## Task3: Review, validation, deployment and measurements

- [x] Independent safety review; correct concrete regressions.
- [ ] Run Bun policy/license, Deno backend, SQL saved-data/revisions, full browser/sync fixtures, build/security/offline checks and relevant Android CI.
- [ ] Publish focused PR, pass CI, deploy through existing main workflow, verify live build/Edge configuration.
- [ ] Report exact changes, measured synthetic request counts, data guarantees and limitations. No real-user test writes.
