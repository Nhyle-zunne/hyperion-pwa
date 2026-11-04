# Licensed-only automatic progress synchronization

## Before/after audit

Previously authentication initialized progress for every signed-in user regardless
of current license. Startup could invoke recover-saved, read and write; reconnects,
store mutations and archive events could repeat background work. Missing local
archives could trigger read-session independently. Account cache/ownership setup
was intertwined with cloud reads, so simply skipping initialization for free users
would break local account isolation and renewal merging.

The isolated browser regression observed3learning-progress startup requests for a
signed-in free account before implementation. The same startup now sends0. The
expanded synthetic suite also asserts0 for free edits, browser reload, archive
saves/uploads, missing-archive fallback, reconnects and timer wakes. That is100%
of the covered free progress requests; it is not a production egress/usage forecast.
Auth, question access verification, licensing, checkout and payments remain allowed.

## Source files

- `src/stores/licenseStore.ts`: verified lease owner, active expiry and separate
  current-session cloud verification. Cached signed licenses retain local/offline
  study rights; a failed online verification disables cloud scheduling.
- `src/lib/cloudProgressAccess.ts`: shared account-bound active-grant scheduling
  gate and captured grant epoch for asynchronous work. No authorization comes from
  user-editable account metadata; server content checks remain authoritative.
- `src/lib/localProgressIdentity.ts`: synchronous auth identity/readiness and
  captured local-read epochs. Old decryptions cannot regain access after A→B→A.
- `src/lib/progressSync.ts`: local account preparation independent of network/
  licensing; encrypted per-account recovery, complete target cache before partial
  restore, owner set before writes, full pending snapshot retained on interruption.
  Gate startup/recovery/read/write/conflict/retry/archives and post-compression send.
  Activation/renewal hydrates existing cloud before merging/uploading owned work.
  Reconnect verifies licenses first. No heartbeat or free background progress calls.
- `src/lib/sessionArchive.ts`: free local encrypted archives remain available;
  cloud fallback/batches require active eligibility. Auth/owner/grant epochs are
  checked before requests, after decryption and before responses/acknowledgments.
  Claim only unowned guest archives referenced by the first account's own history.
- `src/App.tsx`: hide study views while changing local owners; Auth/account/
  checkout/admin routes remain available. Check-ins wait for matching owner state.
- `src/screens/HistoryScreen.tsx`: explain a missing local-only audit without
  automatically trying cloud recovery for an unlicensed account.

Test files: `cloud-progress-access.test.ts`, `local-progress-identity.test.ts`,
`license-refresh.test.ts`, `licensed-progress-browser-test.mjs`;
fixtures/runners: `sync-browser.ts`, `recovery-browser.tsx`,
`recovery-browser-test.mjs`, `recovery-supabase-fixture.ts`,
`recovery-bank-fixture.ts`, `run-recovery-browser.mjs`.
Workflow `.github/workflows/pwa-build.yml` runs the new regressions in CI.
Spec/plan under `docs/superpowers/` record implementation decisions.

## Data/security guarantees and scope

No database migration, production data write/deletion, revision retention change,
archive cleanup, backup removal or new subscription is part of this change.
Encrypted full session payloads/answers and account recovery snapshots use existing
AES-GCM IndexedDB storage. Existing history/statistics metadata store envelopes are
retained for compatibility; this does not claim to newly encrypt every metadata
field previously persisted in localStorage.

Cached paid question content is not placed into live practice from an unlicensed
or wrong-track account cache. Explicit saved-session resume retains existing
question authorization, including online-only Free Reviewer checks. Premium
bookmarks/mistakes/offline question-pack gates are unchanged. Historical records
remain saved on expiry and become eligible for merging on verified renewal.

The learning-progress Edge Function audit confirmed owner-scoped APIs, current
track verification for reads, and historical ownership backup rights. It remains
unchanged: a blanket denial would break older Android clients/expired-owner backup
contracts while still incurring Edge requests. PWA scheduling implements the zero
automatic traffic target. Android contracts/question-bank IDs remain unchanged;
older PWA/Android versions can continue their own existing authorized requests.

A request issued before account/entitlement loss cannot be unsent. Its late result
must not apply, acknowledge pending local changes, or schedule follow-on work.
The tests pause reads/encryption/archive responses to verify those boundaries.
If safely preserving an old local account fails, switching fails closed and retains
its data rather than discarding it. Essential account routes stay accessible.

## Verification record

- Regression REDs:3free startup requests; unclaimed guest archive readable from a
  signed-in account; missing fresh-verification state; canceled B restoration
  leaking into C; A archive readable after auth switched B; old recovery response
  scheduling an extra read after revoke/renew (4rather than3).
- New browser suite GREEN after fixes: guest/free zero calls, local reload and
  answers, online-only free resume, activation/renewal merge without duplicate IDs,
  expiry/revocation mid-batch, offline account switching, guest ownership, offline
  startup with missing Auth session, paused A→B→C preservation and stale recovery.
- License9, cloud-access6 and local-identity3unit tests pass.
- Existing full saved-data browser regression passes, including paid cross-device
  restore, offline saves, bookmarks/mistakes, immutable audits, archive retries,
  practice/flashcards and failed local save recovery. Explicit recovery now asserts
  final saved IDs rather than an internal count that can be0after auto-recovery.
- Backend7tests and existing saved-data/revision SQL regressions pass. Backend and
  Android source contracts remain unchanged. Further CI/deployment receipts follow.

## Saved-session merge safeguard

Encrypted local metadata records the IDs this browser has already seen in cloud
saved-session collections. Renewal merges new remote IDs (including Android work
created during a local-only period) while respecting locally discarded known IDs
and existing soft-delete markers. Successful cloud reads/writes update this local
baseline without adding Supabase requests or changing Android's wire format.
Upgrade seeds it from existing per-account archive acknowledgments when possible.

Older installations without either ID history or an archive acknowledgment cannot
prove that an absent local ID represented a past permanent deletion. Preserve an
unseen existing cloud session rather than silently dropping it; such an ambiguous
legacy entry may reappear on renewal. Current-version known removals and soft
deletions have regression tests. No historical cloud copy is deleted to resolve
this ambiguity.

The final browser regressions additionally prove that first purchase retains an
existing remote Resume row, renewal retains a newly created Android session, and
both explicit discard and soft-delete behavior survive renewal. Local unit runs
pass45tests across9isolated files; backend runs pass7tests. Security smoke coverage
was updated for the renamed owner variable and strengthened to reject plaintext
account-cache writes. Production build and offline checks pass with the new code.

A final auth-race regression verifies that an older failed session lookup cannot
disable the newer account's verified cloud grant (RED→GREEN). The account/sequence
check runs before fallback changes scheduling state.

## Startup and expiry follow-up

CI exposed overlapping startup collection recovery and hydration. Local ownership
preparation now waits for local encrypted recovery. Licensed online cloud-ready
announcements follow cloud application; free/offline readiness remains local.
Tests wait for the restoration event plus actual records, not a partially loaded
store. Old study screens unmount while owner changes, and entitlement guards do
not act on the previous owner's session during that interval. Essential account
routes remain accessible.

A dedicated regression also reproduced an existing expiry problem: the paid-view
guard called the user-discard/reset action, deleting the local resumable archive.
It now saves progress locally and closes the paid view. Paid question components
and navigation controls do not mount without eligible access. The test confirms
answers and the encrypted snapshot survive expiry, makes0progress calls after
expiry, and resumes those answers after verified renewal.

The full-app backoff assertion now scopes repeated manual attempts to its own
archive IDs, avoiding unrelated background batches; the standalone sync suite
still checks exact global batching/backoff counts. Both verify pending encrypted
archives transfer when the backend recovers.
