# Hyperion question-bank delivery

The active encrypted source is `Nhyle-zunne/hyperion-reviewer/question-banks`, pinned to GitHub commit `91677156579dfea6f092097f324bec96c7c13e5b`. Every source object is verified against `supabase/functions/_shared/github-bank-manifest.json` before decryption.

Bulk question pages are served by the Cloudflare Worker at `/api/question-bank/questions`. Each request checks current track access through Supabase before returning paid questions. Supabase retains accounts, licenses, study synchronization, and small metadata/search APIs; those APIs read the same GitHub source. Persistent edge caching stores encrypted source objects; a server process may reuse decrypted bank text in memory after each request's access check.

There is no manual question-bank download button. An activated track is prepared automatically for offline use while the user is online and signed in. Existing encrypted packs remain available until a complete replacement is verified and saved atomically. Signed license and expiry checks still apply offline.

## Existing study data

This migration preserves filenames, CSV row order, competence/part mappings, question IDs, choices and correct-answer indices. Bookmarks, mistakes, sessions, account ownership and their storage keys are not migrated or cleared. Compatibility tests cover all 69 files and 25,752 question records.

Offline manifests now use `github-content-sha256-v1` versions. Existing packs are compared with current GitHub content before their version metadata is rebased; changed packs are replaced only after successful preparation. A source change never deletes a user's study records.

## Publishing future changes

1. Update the encrypted source in `hyperion-reviewer/question-banks` using compatible encryption. Preserve existing paths, question IDs and row ordering. Append new questions carefully; do not reorder or remove old valid rows during a storage-only migration.
2. Record the new encrypted byte counts and SHA-256 hashes in the bank manifest. Update the pinned revision/publication time and manifest in the PWA's `_shared` source module.
3. Deliberately update compatibility fixtures for intended content changes; inspect any question-ID or answer-index changes. Run the generated-codec check, GitHub delivery tests, offline-version migration tests, saved-data browser regression and release checks.
4. Deploy the Supabase `question-bank` function first, then the verified Cloudflare Worker/frontend. Confirm `/api/question-bank/source`, free question responses, paid denial without a license, and the public deployed build.

The old Supabase upload form is read-only after this source migration. Do not use `scripts/update-question-bank.mjs` to publish new live content: it updates the retained Storage copy, not the GitHub source. Existing Supabase objects remain as rollback copies; do not delete them or the existing metadata tables during rollout.

If the GitHub repository becomes private, configure a read-only `GITHUB_BANK_READ_TOKEN` in both the Worker and the Supabase function before changing visibility. The token stays server-side and must never enter Vite's public configuration or the repository. Anonymous GitHub reads work only while the selected repository revision is publicly accessible.
