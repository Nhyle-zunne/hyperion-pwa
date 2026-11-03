# Conditional Android progress reads

Reduce repeated Supabase response egress without changing saved-data behavior.
The user delegated selection and implementation of one optimization.

## Approach
Use a SHA-256 fingerprint of the authenticated user's row revision and freshly
sanitized snapshot. On read, always verify current licenses and saved-question
access before comparing the optional known_snapshot_hash. A match returns
not_modified, snapshot_hash and updated_at, without data. Other clients retain
full read responses. Hashes include user identity and row revision.

Android keeps one account-scoped immutable JSON copy in process memory, never a
reference mutated by the merge adapter. Matching responses reconstruct a fresh
snapshot before the existing merge/write/conflict flow. Missing/broken caches
fall back to a full read. Sign-out and writes clear the cache. A process restart
simply performs a full read. No database migration or saved-record deletion.

Alternatives: a revision-only response could skip current entitlement/question
sanitization and is unsuitable. Persisting duplicate snapshots would extend the
cache across restarts but adds privacy/storage complexity; defer it. Delta sync
could save more traffic but changes merge semantics and has greater data risk.

## Verification
Exercise the real Edge handler: matching/changed snapshots, different accounts,
license expiry, verification failures, absent records and legacy clients. JVM
cache tests cover deep-copy safety, account isolation, invalid cache replies,
full-response compatibility, clearing and revision updates. Compile Android
through CI; explain that savings require installation of the updated app.
