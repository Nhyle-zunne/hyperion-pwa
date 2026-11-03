# License and Count Request Reduction Plan

Goal: Fewer Supabase requests without weakening access or saved-data safeguards.
Spec: ../specs/2026-11-04-license-and-counts-design.md
Execute inline with test-first changes.

1. Add failing license-store tests: signed admin/ordinary roles, one invocation
   per concurrent same-account refresh, account change and sign-out safety.
2. Remove general admin-payment-review check and coalesce signed lease requests.
   Run both existing offline-license suites in separate Bun processes.
3. Add Worker count tests: real bank fixture exact counts, free sample equivalence,
   coalescing/caching, release mismatch/failure and absence of Supabase calls.
4. Implement release-scoped counts route; route production count actions there.
   Keep question delivery authorization and revision pinning unchanged.
5. Query one narrow recent Supabase window for legacy Storage downloads; retain
   rollback objects and document measured evidence and uncertainty.
6. Review combined diff, run release/build/saved-data tests and CI; deploy after
   checks. No database migration or question-bank publication.
