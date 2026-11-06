# Smaller backend responses

Goal: reduce transferred data without hiding orders, weakening access checks, losing saved progress, or changing admin totals/filter semantics.

Order history: fetch 25 visible records plus one lookahead row, ordered by creation time and ID using a cursor rather than offsets. Load older records only on request. Keep pending-payment discovery independent of the visible page, using a narrow projection, so hidden pending orders remain verifiable. Avoid that extra query when the complete history already fits on one page. Retain loaded records on automatic paid refreshes; explicit refresh may return to the latest page. Remove unused response columns. Guard stale pagination/account requests.

License admin: opt in to a compact response that omits default unlicensed-track records; reconstruct those defaults in the frontend. Old clients retain their previous contract. Preserve all users, global counts, search/filter behavior, licenses and retention fields. Compression, if implemented, must respect Accept-Encoding and private no-store responses. Do not implement pagination that repeatedly reloads the complete auth directory and increases backend traffic.

Progress reads already have conditional response hashes and gzip; preserve those existing protections.

1. Build synthetic query and browser regressions for smaller pages, tied timestamps, concurrent insertions, older history, pending orders outside the page, failures, and refresh behavior.
2. Implement scoped order queries and pagination; independently implement/test the compact admin contract.
3. Run focused, account browser, security, and production-build checks; review and register tests in CI.
4. Deploy the backwards-compatible admin backend before the frontend that opts into it; verify the installed backend and production release. No database records or schemas need changes.

Local verification passed: order query tests (including 206 pending records across pages and microsecond cursors), compact/legacy admin response and gzip tests, payment polling tests, release-safety smoke checks, production build, and the account browser suite. Browser coverage includes 65 historical records, page failures/retries, off-page pending payments, preservation of loaded history on automatic payment confirmation, entitlement refresh, and account-switch isolation during a held refresh. Review found no remaining blockers after adding stale-owner checks.

Synthetic admin payload measurement: 14,126 bytes legacy versus 4,899 bytes compact (65% reduction before gzip) for 12 fixture accounts. This is not a measured reduction in total production egress. Backend source was checked against the tracked baseline before deployment; existing JWT verification must remain enabled.
