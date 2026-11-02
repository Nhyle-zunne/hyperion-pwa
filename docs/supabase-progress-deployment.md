# Keep progress backend and website deployments compatible

The website uses `recover-saved`, `read-session`, and `write-session` in addition to ordinary progress reads/writes. Publishing the frontend alone does not deploy Supabase functions or database migrations.

The preservation migration `20261102090000_preserve_saved_progress_and_session_audits.sql` adds service-only recovery copies and session archives, preserves omitted saved collections, honors explicit deletions, and protects completed audits. Apply it before the matching backend. Keep gateway JWT verification enabled for `learning-progress`.

With secure Supabase management access configured, from the repository root:

```sh
node scripts/deploy-learning-progress.mjs --bundle-only
node scripts/deploy-learning-progress.mjs
node scripts/deploy-learning-progress.mjs --verify-only
```

In the managed cloud environment, retain the inherited proxy and CA settings and set `NODE_USE_ENV_PROXY=1` for Node network commands. Never commit or print management credentials. The script checks the required schema before deployment and verifies deployed recovery/archive actions, gzip support, and gateway JWT enforcement afterward. It does not apply migrations implicitly.

Before releasing frontend changes, run the saved-data SQL/browser, production build, security and offline checks. The two Bun suites use global module mocks and are run in separate processes in CI:

```sh
bun test scripts/tests/license-offline.test.ts
bun test scripts/tests/github-offline-version.test.ts
```

A combined invocation currently fails due to cross-suite mock exports (`supabaseAnonKey`); separate runs both pass. This is a test-isolation limitation, not a production dependency failure.

## November 2, 2026 repair

Production had progress backend v124 without the recovery/archive handlers and no preservation schema. Applied the existing migration (recorded with its committed version) and deployed v125 with `verify_jwt=true`. All 114 existing progress accounts had a recovery copy after migration. The first observed post-deployment window contained 40 successful progress requests and no HTTP 400 responses.

Background archive synchronization now pauses after a failure, uses increasing delays for transient failures and a longer pause for unsupported/unauthorized requests, and avoids repeatedly fetching absent historical archives. Failed snapshots remain encrypted locally and retain their pending state. User-initiated audit reads remain available independently of background backoff. A browser regression reproduces the prior request flood, checks one failed request pauses the batch, and verifies that all pending snapshots upload once the backend recovers.

Validation: PostgreSQL preservation/recovery/permissions regression, Deno owner/expiry/archive/recovery checks, full saved-data browser suite, production build, security and offline build checks, nine offline-license tests, and five GitHub version migration tests passed. Question source, question IDs and quiz interfaces are unchanged by this repair.
