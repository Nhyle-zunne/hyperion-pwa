# Release-safety checks

Run the same checks used by GitHub Actions before releasing changes that affect authentication, licensing, question delivery, payment review, or account retention:

```sh
bun install --frozen-lockfile
bun run test:security
bun run build
```

CI pins Bun 1.4.4 and installs the exact dependency graph from the committed `bun.lock`. Do not regenerate or change the lockfile casually; update it intentionally with the same Bun version, inspect the diff, and confirm CI passes.

## What the smoke suite covers

The source-level regression suite checks canonical product pricing, checkout and license finalization, question-bank private delivery, authorization for free and licensed question sets, offline entitlement-expiry rules, admin-only operations, cron-token protection, account-retention guards, PWA cache/source-map security settings, and required app routes.

These tests are regression guards, not a complete penetration test. Before changing license enforcement, test separately with disposable accounts in each state: signed out, free, active, expired, revoked, and admin. Exercise the question/count/search/flashcard/session-authorization endpoints and reconnect behavior after offline use. Never change a real customer's entitlement just to simulate an access state.

The live read-only checks carried out in October 2026 verified missing-session rejection for the protected endpoints, a private question-bank bucket, a complete 69/69 source-asset inventory, and cron-token rejection on both maintenance endpoints. No real payment or production account mutation is part of these checks.

A green CI run is necessary before release, but it does not replace the authenticated test-account matrix.
