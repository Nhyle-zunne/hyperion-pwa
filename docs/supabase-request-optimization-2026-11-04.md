# License and count request optimization

Implemented the first code changes recommended in the supplied audit.

## Changes

General license refresh now uses one signed offline lease request, instead of
that request plus a payment-admin check. Its cryptographically verified role is
the administrator source. Simultaneous requests for the same account share the
in-flight lease; newer account lookups supersede old work, and sign-out cancels
pending grants. Local expiry and valid same-owner offline fallback remain intact.
Explicit administrator screens and privileged server operations still check admin
access separately.

Production GitHub-backed count/catalog requests now use the Cloudflare Worker,
without Supabase identity, entitlement or asset-count calls. Only aggregate
competence/part counts are public. Counts use the existing parser and sample
rules against one verified GitHub release. They are cached by parser version,
release and track in bounded memory and Cloudflare's cache. Browser metadata has
a one-minute lifetime; revision mismatches fail rather than mixing releases.
Question text and paid access continue through fresh protected checks.

No question-bank files/IDs, saved records, database migrations, authentication
configuration or purchase flows were changed.

## Legacy traffic investigation

A bounded production log query covered November 3, 2026 23:55:41 through
November 4 00:25:41 Philippine time (15:55:41–16:25:41 UTC on November 3).
An explicit Storage-path aggregate returned **0 requests and 0 header-reported
response bytes**. This includes all /storage/v1/ paths, not only the former bank
bucket. The same window contained 642 entitlements requests, 515 Auth user
requests and 387 Google Play entitlement requests. These are observations before
this release, not post-optimization savings.

This window provides no evidence of continuing legacy Storage downloads. It does
not explain every historical billing byte or prove older clients never download.
Earlier cycle usage remains recorded; header bytes are not exact billed egress.
Legacy objects were retained as rollback copies, and no endpoints were disabled.
Two narrow aggregate log queries were used; no personal payloads were inspected.

## Verification and review

- Eight license-refresh behavior tests, including both deferred-auth account-switch
  orders, verified administrator role, coalescing, sign-out and fallback.
- Nine existing offline/expiry tests; three transport-routing tests; three pinned
  download tests; five offline-version tests.
- All 69 encrypted fixture hashes and 25,752 parsed question identities unchanged;
  full counts checked for all five tracks, GMDSS free total 1,030.
- Cloudflare aggregate reuse across isolates, failed-computation retry, zero
  Supabase metadata requests, failed authorization and revocation despite caches.
- Production auth/build, release-safety, saved-data SQL and offline build checks.

Independent review found an overlapping account-lookup race; a failing regression
reproduced it before the fix. Separate explicit-invalidation and ordered auth
lookups now prevent an older account's response from replacing a newer account.

The reduction is per operation: one general license call replaces two, and public
counts make zero Supabase metadata calls. Total billing savings depend on actual
traffic after clients load this release; no fixed percentage or quota clearance
is promised.

## Cold-load limit correction

Live verification found an initial Deck Management counts failure; retries with
warm caches succeeded. A regression reproduced the cold path exceeding the
Cloudflare Free limit of 50 subrequests: each of the 18 bank files performed a
cache lookup, upstream fetch and cache write. Counts now reuse existing asset
cache hits but skip individual asset cache writes, persisting only the aggregate
result. Normal question delivery retains its original asset-cache behavior. The
cold largest-track regression and production build pass with this correction.
