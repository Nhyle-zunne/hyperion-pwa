# GitHub bank publisher implementation

1. Build and test immutable GitHub release resolution with a validated manifest and pinned-source loading; retain the initial snapshot.
2. Add a tested server-side validation/publishing service using GitHub Git objects and non-forced ref advancement. No Supabase file write.
3. Add administrator authorization broker and Cloudflare routes; test denial, credential isolation and limits.
4. Reconnect the admin queue to Validate / Publish with revision-bound batches and useful status/error messages.
5. Integrate one release per request in both delivery runtimes and update offline preparation to avoid mixed releases.
6. Run codec, delivery, source/publication, owner/offline/browser and build checks. Deploy backend first, then Worker/frontend. Verify public delivery and administrator publisher readiness once the secret is configured.

Progress ledger:
- Source resolution tests RED→GREEN: immutable manifest integrity, bootstrap and warm/cold outage behavior.
- Publisher validation tests: append/correction and shorter-list/reorder rejection passed.
- Transaction tests: validation-only preview, AES encrypted Git blobs, two commits with one non-forced ref advancement, race preservation, lost-response retry, admin denial and token isolation passed.
- User has configured GITHUB_BANK_WRITE_TOKEN in Cloudflare. Verify secret metadata/read delivery after deployment; never print or copy its value.
- Implementation continues in the authorized main checkout (standing user instruction to commit directly to main). No production bank contents were changed by tests.

- Shared source metadata published on reviewer/main: f6097f8 (immutable manifest), f217032 (release pointer). Duplicate root still retained until live cutover.
- Final review found and fixed: verify ALL existing bank Git blob identities, including unselected files, before publication (corruption test RED→GREEN).
- Final review found and fixed: fresh release-pinned counts for offline preparation and full ranges; stale-count truncation test RED→GREEN; mismatched page release never commits; all-range append case passes.
- UI browser preview/answer correction/publish retry/missing-secret tests passed. Full saved-data/offline/account-isolation/audit browser regression passed.
- Rollout ruling: legacy Worker broker calls without the shared-source protocol are temporarily denied during cutover, so old source bytes cannot be tagged with new metadata. Existing sessions and valid offline packs remain intact.
