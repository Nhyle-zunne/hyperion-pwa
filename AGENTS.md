# Hyperion development instructions

## Project and safety

This repository is `hyperion-pwa`: React/TypeScript/Vite frontend, Cloudflare Worker in `worker/`, and Supabase functions/migrations in `supabase/`. Consult `package.json`, `.github/workflows/pwa-build.yml`, and the implementation for current commands and architecture. Some older README deployment and question-storage descriptions predate the Worker/GitHub migration.

Preserve existing project instructions and task-specific requirements. Security, correctness, licensing enforcement, payment processing, accessibility, and user-data preservation take priority over shorter answers, smaller diffs, and skill preferences. Never remove validation, authorization, error handling, tests, or recovery guarantees merely to simplify code. Keep secrets out of source, logs, frontend bundles, and chat.

Question banks share the private `hyperion-reviewer/app/src/main/assets/questions` source with Android. Preserve server-side entitlement checks, expiration/revocation enforcement, encrypted storage, account isolation, historical revisions, sessions, bookmarks, and mistakes. Free access must not expose paid content through delivery or caches. Check Android compatibility before changing shared formats or identifiers. Do not delete production records or backups or run real payments as tests.

Use the existing payment instructions in [SUPABASE_PAYMENTS_SETUP.md](SUPABASE_PAYMENTS_SETUP.md), [release checks](docs/release-safety-test-plan.md), and [saved-data recovery guide](docs/SAVED_DATA_RECOVERY.md) when relevant. These instructions supplement those documents; they do not replace them.

## Repository skills

Repository-native skills live in `.agents/skills/<name>/SKILL.md`. Read the relevant skill before applying it. In Codex use `$skill-name` or explicitly name the skill and its file. See [the tooling guide](docs/codex-cloud-tools.md) for installation provenance, invocation, and runtime limitations.

- **Superpowers:** start with [using-superpowers](.agents/skills/using-superpowers/SKILL.md). Use brainstorming and writing-plans to establish scope and a reviewable plan; executing-plans for implementation; systematic-debugging for failures; test-driven-development for substantive behavior changes; verification-before-completion before success claims. Apply review and finishing skills when appropriate. Scale artifacts to the task and reuse an existing approved specification or plan. A complete user instruction already authorizes its stated reversible work; skill workflow preferences do not require repeating that approval.
- **Ponytail:** use [ponytail](.agents/skills/ponytail/SKILL.md) for the smallest complete, readable implementation. Reuse existing patterns and dependencies. Avoid speculative abstractions and clever one-liners. Simplification must preserve every safety and product guarantee above; do not use the optional ultra mode to drop requested work.
- **Caveman:** use [caveman](.agents/skills/caveman/SKILL.md) for concise communication. Lead with the result, keep essential evidence, exact commands, limitations, risks, and next actions. Use clear grammatical prose when compression could confuse. Keep persisted code, comments, documentation, and commit messages in normal technical prose. Report material risks or unverified checks once; no redundant closing boilerplate.

These roles complement each other: Superpowers controls process, Ponytail guides implementation simplicity, and Caveman guides chat style. Follow the user's requested detail level and mode changes. If a session also supplies the same skills through a plugin, use one copy for each workflow, not both. Upstream `superpowers:<name>` references refer to the corresponding repository skill when no plugin namespace is available.

Use only tools and permissions actually provided by the current Codex Cloud session. Optional subagent, model-routing, hook, visual-server, and machine-configuration instructions in upstream references are runtime-specific guidance, not requirements to install or enable them here. Follow the session's delegation and model-selection rules. If delegation is unavailable, execute and review inline and disclose that limitation. Do not install machine-wide plugins, lifecycle hooks, proxies, telemetry, or CLI middleware for this repository setup. Do not run bundled helper scripts without checking their relevance and prerequisites.

## Diagnostic log searches

Keep Supabase log investigations narrow; reading logs consumes the Log Query allowance. Do not query production logs for routine deployment checks or when source, test output, or existing evidence answers the question. For a specific incident, start with an explicit window of at most 15 minutes around it, pass both start and end timestamps to the logs tool, and filter by the relevant log source plus endpoint, status, request ID, or error when available. Use aggregate counts first unless individual entries are necessary. Apply filters in the query, not after retrieving results; a row limit alone does not bound bytes scanned. Widen only when the evidence requires it or the user explicitly requests a broader period, and explain why. Never poll the logs API or rerun an unchanged search without new evidence. Follow [the diagnostic runbook](docs/diagnostic-log-searches.md); preserve necessary error/security logging and never disable payment audits or recovery records to reduce diagnostic usage.

## Verification and delivery

For skill configuration, run `node scripts/tests/agent-skills-test.mjs`. For application changes, run the relevant tests listed in `package.json` and the release guide; `npm run test:security` and `npm run build` are the standard regression/build checks. Changes to progress or recovery also need the relevant revision, saved-data, offline-license, and browser checks. State precisely what passed and what was not tested. Do not claim cross-device or production acceptance from static tests alone.

Inspect diffs and preserve unrelated work. Main pushes trigger production deployment, so use a focused branch for review unless the user has authorized that release. Commit configuration when requested; do not infer permission for unrelated application changes or production data operations.
