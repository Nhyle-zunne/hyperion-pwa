# Reduce license and metadata request amplification

The user asked to implement the audit's first recommendations: consolidate
license checks, serve public counts from Cloudflare, and investigate legacy
Supabase file traffic. Preserve authentication, licensing and saved records.

Use the already cryptographically verified offline lease as the sole general
license refresh source, including its signed admin role. Retain administrator
checks on administrator screens and every privileged server operation. Coalesce
concurrent refreshes only for the same account and generation; sign-out/account
changes invalidate pending responses. Existing expiry scheduling and same-owner
signed fallback remain mandatory.

Serve aggregate competence/part counts from the existing GitHub-backed Worker,
computed using its existing parser and exact free sample rules. Cache only these
public counts by immutable release and track, with bounded in-memory entries and
Cloudflare cache persistence. Latest requests capture one verified release; pinned
revision mismatches return409. Every question-text request still verifies fresh
Supabase access. Route production counts/catalog-counts to this Worker only for
the GitHub delivery configuration; keep older development/Supabase paths working.

Alternatives rejected: caching auth decisions weakens revocation; storing another
hand-maintained count file risks parser/release drift. No bank IDs or saved-data
schema change. Verify license races/expiry and exact count consistency, revision
updates, upstream failures, public-only payloads and no Supabase metadata calls.

Investigate a narrow recent log window with aggregated paths/bytes/statuses only;
report historical attribution limits, without deleting legacy bank objects.
