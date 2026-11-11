# Incremental progress sync V2 — compatibility-first design

Date: 2026-11-11. Status: **staged**, not enabled in production.

## Goal and constraints

Cut network request payloads and unnecessary full progress rewrites across PWA and Android, while keeping offline practice, session audits, account isolation, licensing, and all existing recovery snapshots. Free users remain local only. Users on an old Android release must keep reading and writing without schema corruption or data loss.

## Evidence in current implementation

- Both PWA (`src/lib/progressSync.ts`) and Android (`SupabaseAccountManager.kt`, `LearningProgressSyncAdapter.kt`) send version-1 snapshots with a `storage` JSON object.
- PWA already tracks changed sections, but `action:'write'` sends the *entire* snapshot.
- Android merges Room + local vault into a full snapshot and pushes the same `write` action.
- The current SQL preservation trigger merges bookmark/mistake collections, retained deletion markers, and protects immutable history/recovery revisions.
- Session archive uploads are already independent and **must remain so**.

## Chosen approach: additive, revisioned section updates

Rejected: breaking the existing snapshot schema; letting clients directly update tables; adding a second source-of-truth with no bridge to old clients.

Keep `user_learning_progress.data` as the canonical and legacy-readable snapshot. Add two Edge actions after explicit deployment:

- `read-sections`: `{action:'read-sections',keys:[...],known_versions?:{[key]:etag}}`. Return `{versions,storage}`, with values only for changed keys. Server authorization always applies before any question-bearing data leaves the backend.
- `write-sections`: `{action:'write-sections',operation_id:UUID,updates:[{key,value,expected_version}]}`. One atomic transaction patches only listed keys, using opaque per-key revision tokens. An edit to bookmarks and one to history may commit independently. A conflicting update to *the same* key returns 409 and must be merged/retried by the client.
- Opaque version: md5 of canonical JSONB section value including its absent/null state, **not** a security credential. This is server-generated, never client-trusted authorization.
- A service-role-only receipt table keyed by `(user_id,operation_id)` stores the request fingerprint and exact acknowledgement. A retry with the same ID and content returns the same acknowledgement; reusing an ID for different contents is rejected.
- All patch writes update the existing progress row and invoke its existing preservation trigger; old `read`/`write` and legacy Android apps therefore retain the original contract. Old full writes remain subject to whole-row compare-and-swap.
- An operation never deletes a bookmark or mistake by omission; the existing explicit, timestamped `hyperion-progress-deletions` ledger must accompany those removals.

## Client rollout and durable outbox

1. Deploy and test SQL RPC + Edge handler first, without enabling V2 clients.
2. PWA: persist owner-scoped pending operations in encrypted IndexedDB *before* sending; track dirty storage keys (already mapped in the existing store), batch small updates; only remove an operation after an exact server acknowledgement. Read and merge only conflicted sections. Keep existing full-snapshot recovery for initial login, unknown server capability, failures, and periodic integrity checks.
3. Android: use Room/SharedPreferences to persist an owner-bound operation queue, and produce section updates from native bookmark/mistake/history changes. Keep Google sign-in / manual sync and existing full-snapshot merge as fallback. Upgrade only after PWA + SQL compatibility testing.
4. Gradual opt-in, telemetry on requests, server conflict rates and bytes, then widen. Never enable automatically just because the endpoint exists.

## Conflict policy

- Different sections: independent etags avoid false conflicts.
- Same section: fetch remote key only and use the existing merge rules (history by record ID/time, study time by segment ID, bookmarks/mistakes by item ID/timestamp; deletion ledger by per-ID mutation timestamp).
- Deleted/retired sessions: preserve history tombstones and 3-day recently-deleted retention.
- User account switch: cancel and segregate queued operations; never retry A's op under B's token.
- Unknown or old clients: continue full snapshot protocol and server-side preservation. Invalid auth or question access returns an error, **not** an acknowledgement.
- Network failure after commit: retry the exact same operation ID/content; acknowledgement is stable.
- SQL or sanitization failure: no partial write and no client acknowledgement.

## Non-goals of server foundation phase

Do not delete historic progress, backfill data, replace session archives, change subscriptions, or silently deploy a new protocol to production. No production DDL/application until synthetic migration and client regressions pass.

## Verification gates

Synthetic PostgreSQL: two owners, concurrent independent sections, same-key conflicts, no-op retry, deletion+resurrection protection, old full-writer compatibility, revision history preservation, SQL/role isolation, atomic rollback. Browser: offline unsent edits, account isolation, rehydration, cross-tab ownership, old-server fallback. Android: same scenarios in JVM/Room fixtures. Deployment needs a confirmed server readiness check and a rollback procedure.
