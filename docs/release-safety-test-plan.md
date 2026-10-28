# Release-safety checks

Run the same two checks used by the GitHub Actions workflow before releasing changes that affect authentication, licensing, question delivery, payment review, or account retention:

```sh
bun install
bun run test:security
bun run build
```

## What the smoke suite covers

The source-level regression suite checks canonical product pricing, checkout and license finalization, question-bank private delivery, authorization for free and licensed question sets, offline entitlement-expiry rules, admin-only operations, cron-token protection, account-retention guards, and required app routes.

These tests are regression guards, not a complete penetration test. Before changing license enforcement, test separately with disposable accounts in each state: signed out, free, active, expired, revoked, and admin. Exercise the question/count/search/flashcard/session-authorization endpoints and reconnect behavior after offline use. Never change a real customer's entitlement just to simulate an access state.

The live read-only checks carried out in October 2026 verified missing-session rejection for the protected endpoints, a private question-bank bucket, a complete 69/69 source-asset inventory, and cron-token rejection on both maintenance endpoints. No real payment or production account mutation is part of these checks.

## Limitations

The repository currently has no committed Bun lockfile. Until `bun.lock` is generated and committed in a dependency-install environment, CI resolves compatible package versions from `package.json` rather than enforcing a frozen dependency graph. A green CI run is necessary before release, but it does not replace the authenticated test-account matrix.
