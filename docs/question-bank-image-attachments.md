# Hyperion question-bank image attachments

This release adds an optional `HYPERION_MEDIA` column to **existing encrypted CSV question banks**. This is metadata only; no image bytes or public URLs belong in a CSV.

Example metadata in one CSV cell (CSV quotes/escaping required):

```json
[{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mime":"image/webp","placement":"question","alt":"Radar plotting chart"}]
```

- Maximum four references per question, supported placements `question` and `explanation`.
- File bytes are uploaded by an administrator to the **private** Supabase Storage bucket `question-bank-media`, content-addressed by SHA-256 and capped at 512 KiB; images are converted to WebP before upload where supported.
- Access to the media API is not granted by the hash itself. Every online download requires a verified user and a **current active paid track entitlement**, or verified admin status. There are no public Storage objects or signed permanent URLs.
- The PWA uses locally SHA-verified IndexedDB blobs, scoped by owner and track. Android uses its private, SHA-verified files directory. No progress-synchronization snapshots contain images.
- To attach an image: open **Admin > Question Bank**, select the bank and question, upload, select placement/description, **Apply edit to draft**, **Add to publish queue**, **Validate & Publish**. Existing question IDs/retired rows are unchanged.
- To replace an attachment, remove its reference and add another. The old immutable file need not be overwritten; cleanup of unreferenced private objects needs separate controlled administration.
- **Do not add images to free sample questions that depend on a diagram**: the current media API intentionally requires a paid license and won't reveal premium image bytes to free users.
- Android's bundled encrypted CSVs do not update just because the web admin publishes a bank. Publish a new signed Android release with updated banks, or separately enable/verify the existing authenticated smart-bank update feature (currently disabled by default) before expecting Android auto-sync.
- The Android app must be released after both repositories' code passes CI. No question photos are bundled in source control by this feature; an admin has to upload actual images.

## Deployment invariants

1. Migration creates `question-bank-media` private bucket, no anon or authenticated storage policies.
2. Deploy `question-media` Edge Function with `verify_jwt=false` **only because it manually validates each Authorization JWT** through Supabase Auth and enforces current entitlement server-side. Do not change its admin/license checks.
3. The existing production `question-bank` function may have a different question parser from the repository. Patch only optional image metadata extraction into the live deployed parser; do not blindly overwrite its question count or retirement logic.
4. Deploy PWA after media backend is live. Review signed-in paid user and unlicensed user behavior before adding diagrams to any production bank.
5. Existing snapshots and history retain compatible optional image metadata and never store image bytes.
