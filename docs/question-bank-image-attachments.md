# Hyperion question-bank image attachments

This release adds an optional `HYPERION_MEDIA` column to **existing encrypted CSV question banks**. This is metadata only; no image bytes or public URLs belong in a CSV.

Example metadata in one CSV cell (CSV quotes/escaping required):

```json
[{"sha256":"aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa","mime":"image/webp","placement":"question","alt":"Radar plotting chart"}]
```

- Maximum four references per question, supported placements `question` and `explanation`.
- Admin uploads go through the existing authenticated Cloudflare question-bank admin endpoint, which stages **encrypted image assets** in `Nhyle-zunne/hyperion-reviewer` on a separate `hyperion-media-staging` branch. Images are content-addressed by SHA-256, capped at 512 KiB, and converted to WebP by the PWA where supported. Uploading an image does not use Supabase Storage.
- A hash is not an authorization token. Published free sample images are accessible only when referenced by the official Free Reviewer subset; paid images require the same server-side current paid track entitlement used for paid question delivery. There are no public plaintext image URLs or permanent signed URLs. Account and license authentication still uses Supabase, but media bytes never use Supabase Storage.
- The PWA uses locally SHA-verified IndexedDB blobs, scoped by owner and track. Android uses its private, SHA-verified files directory. No progress-synchronization snapshots contain images.
- To attach an image: open **Admin > Question Bank**, select the bank and question, upload to encrypted GitHub staging, select placement/description, **Add edited files to publish queue**, **Validate & Publish**. The validated bank publication atomically promotes the referenced encrypted images into Android's `app/src/main/assets/question-media/` on `main`. Existing question IDs/retired rows are unchanged.
- To replace an attachment, remove its reference and add another. The old immutable file need not be overwritten; cleanup of unreferenced private objects needs separate controlled administration.
- Free sample question images are supported: images must be present in the official published Free Reviewer subset and are checked against that published pool. Images referenced only by premium questions remain paid-only.
- Android's encrypted question banks and images are local APK assets. Publishing new image and bank files to GitHub does not update an already installed APK. A new signed Android release (or a separately verified authorized update mechanism that includes corresponding images) is necessary before installed users see the new data.
- Android ships the encrypted image files from its GitHub repository as local APK assets. No network image downloader is required. Rebuild/test and release the Android app after adding new questions or images.

## Deployment invariants

1. The image uploader must have the Cloudflare Worker's existing `GITHUB_BANK_WRITE_TOKEN` permission to write `hyperion-reviewer`. It creates or updates `hyperion-media-staging` without moving `main`; no Supabase media bucket is required for new uploads.
2. The existing Cloudflare `/api/question-bank/admin` administrator check remains mandatory for media uploads. The paid `/api/question-bank/media` endpoint retains its current paid-track authorization and published-bank membership checks.
3. Existing paid question-bank authentication continues via Supabase. The old `question-media` and `question-media-build` Edge Functions and Storage bucket are **legacy only**; the new PWA uploader and GitHub publisher do not call them. Do not delete old stored images until all historical unpublished references are migrated and deletion is separately authorized.
4. Deploy and verify the PWA Worker media staging path, then test authenticated upload, validation and atomic publishing, followed by signed-in paid, free and revoked user behavior.
5. Existing snapshots and history retain compatible optional image metadata and never store image bytes. Old images that were uploaded to Supabase but never published to encrypted GitHub must be re-uploaded through the admin UI before they can be included in a new publication.

## Reader coverage and cache behavior

The PWA displays prompt diagrams in practice, mock exams, Quick Scan, flashcards and expanded search, bookmark, mistake, history and results views. Explanation diagrams appear only after evaluation or in answer/review views; flipping a flashcard reveals its explanation diagram. Android also covers its competence mock, free practice, mistake vault and results readers. Media access still requires the existing current entitlement; adding a gallery does not grant free access.

Failed loads provide Retry. Enlargement clears when the question, references, account or access changes. The PWA enlargement uses a modal outside transformed cards, supports Escape and restores keyboard focus. Android supports pinch and explicit zoom controls. Both clients recheck ownership and access before returning cached/downloaded media.

The PWA fetches uncached images through Cloudflare/GitHub and stores SHA-verified blobs in owner-scoped IndexedDB. **Prepare Offline** preloads all referenced images for the selected free or licensed bank before marking the pack complete. There is no fixed image eviction cap, although browser storage clearing or quota pressure can remove locally stored data. An offline pack is not complete if required diagrams could not be saved. Saved bookmarks and mistakes retain image reference metadata, not image bytes; older saved records that already lost references cannot safely reconstruct them automatically.

When replacing an existing bank through CSV upload, retain the `HYPERION_MEDIA` column if that bank contains attachments. Uploads that omit it are rejected to prevent silent removal. To intentionally remove an attachment, keep the column and clear its cell. Malformed nonempty metadata is rejected. Image-only changes are included in the publish correction summary.

The attachment chooser confirms the number of images in the current draft, then offers a compact **Add another image** button. Image descriptions are optional in the admin form: a default label is stored when blank. A specific description is useful for screen readers and remains separate from editable question text. Upload errors stay visible after opening a bank. Uploading alone does not publish; add the edited files to the publish queue, validate and publish.

## Image-only questions

Leave Question text blank when a valid image is attached with **Below question** placement. The photo may contain the complete prompt and choices; A/B/C/D answer buttons are supported for these image-only scans. The normal answer key is still required. Explanation-only images cannot replace a missing prompt. The optional description receives a default accessibility label. Changing/removing the final question image requires restoring question text. Existing question positions, choices and saved IDs remain unchanged. Image-only saved identities include the protected prompt image hashes; text-question identities retain their previous format. Android requires an app release with the matching parser changes before receiving such edited banks.

The admin uploader shows preparation, actual byte-transfer percentage and GitHub staging verification in a progress bar. Completion appears only after the returned image hash and size verify. Each attachment displays a protected image preview with enlargement and Retry, including saved attachments when reopening a question. Switching questions clears the previous progress and cancels a pending upload; previews keep the same signed-in account and entitlement controls as the reader.

The editor uses compact text fields, paired choices on wider screens and a stacked layout on phones. Choice boxes start at one line and can be scrolled or resized; prompts and explanations expand with their content. **Add edited files to publish queue** saves the current valid form and stages the updated bank in one action. Further edits clear the older queued snapshot and validation preview; add it again when ready. Discard restores the last staged draft locally. Validate/review and Publish remain separate explicit actions. Image and queued-file Remove controls are red.

## Supabase usage boundary

The image **upload, storage, encryption bundle, and download** path uses GitHub and Cloudflare only. Supabase remains responsible for the existing account identity, administrator approval, and live paid-track entitlement checks already required to protect the question banks. Removing these checks would allow unlicensed users to request paid diagrams independently of the question UI. No stored customer data or existing Supabase bucket has been deleted by this migration.
