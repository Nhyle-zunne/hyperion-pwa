# GitHub bank delivery and automatic offline preparation

Goal: use the committed encrypted bank as the active source, remove manual downloads, preserve licensed offline study and saved user records.

The source is pinned and hash checked. The Cloudflare Worker serves bulk pages only after a fresh Supabase access decision. Existing parser declarations are generated unchanged into the Worker; semantic hashes cover all current questions. Account, license and progress services remain in Supabase. Automatic preparation reuses existing pack APIs and guards stale account results.

Delivery requires public browser configuration, so the build now rejects absent/privileged/mismatched Supabase keys and verifies that the built artifact includes its public configuration. Only the publishable/anon browser key is included; server credentials are not committed.

- [x] Copy and verify original encrypted bank in hyperion-reviewer.
- [x] Generate identical server codec; check every question's compatibility hash.
- [x] Add authorization broker and GitHub-backed Cloudflare page delivery.
- [x] Remove manual download controls and prepare existing encrypted packs automatically.
- [x] Version actual GitHub content and safely rebase unchanged legacy packs.
- [x] Run all delivery, authorization, offline migration, saved-data and production checks.
- [x] Verify active Storage snapshot still matches all GitHub hashes before rollout.
- [ ] Deploy backend first, then Worker/frontend; verify actual public source and UI.

Review fixes: normal quiz page calls now share Worker routing; source versions now identify GitHub content rather than rollback Storage metadata. Persistent cache stores ciphertext, while verified plaintext may be reused only in server process memory after fresh access checks.

Verification: release smoke checks, generated offline shell, production auth guards, all 69 encrypted hashes and 25,752 semantic question snapshots, five offline-version migration tests, nine license-offline tests, Deno access broker test, saved-data SQL/browser regressions and Wrangler dry run passed. Active Supabase encrypted bytes match all GitHub hashes. No user account or study-data mutation was performed.
