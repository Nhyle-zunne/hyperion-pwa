# Background Sync Implementation Plan

Goal: Reduce redundant recovery, retry and session-archive requests safely.
Spec: ../specs/2026-11-04-background-sync-design.md
Execute inline using test-first implementation.

1. Add failing policy tests for versioned per-account recovery, failed attempts,
   missing-row cooldown, bounded retries and wake throttling. Implement policy.
2. Add real-handler tests for atomic batch writes, JWT scope, per-item permissions,
   malformed/duplicate IDs, item limits and no partial writes. Implement new action.
3. Implement union/coalesced archive uploads, bounded batches and explicit ACKs;
   retain manual reads, encrypted writes and backoff. Extend real-browser fixture
   regressions for batching, failure/retry, account changes and no-op downloads.
4. Integrate policy with progress hydration and debounced archive events. Test
   repeated startup/reconnect and service failures without repeated recovery.
5. Review logging/test traffic; prevent fixture requests reaching production while
   keeping operational and security diagnostics. Review full diff independently.
6. Run type/build, saved-data SQL/browser, auth/offline and security checks. Deploy
   backward-compatible backend, verify it, then publish frontend and verify CI/site.
