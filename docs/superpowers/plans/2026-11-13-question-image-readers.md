# Complete question-image reader support

**Goal:** Make existing private question diagrams usable consistently in both apps without changing image access, question identity or bank-update release controls.

**Design:** Reuse HYPERION_MEDIA and the existing private image service. Add the existing gallery to all PWA question/detail screens, showing explanation images only in answer/review contexts. Fix gallery state and zoom cleanup when identity, account or entitlement changes; add explicit retry and accessible enlargement. Recheck account/license after cached reads and bounded network reads. Preserve offline verified on-demand reuse rather than promise all images are downloaded with a track. Reject legacy CSV uploads that would silently drop existing image references. Android independently applies the same state/retry/cache fixes with existing private files and Compose UI.

**Constraints:** No production question/photo changes, new dependencies, free-access expansion, bank IDs/answers edits, automatic Android bank-update enablement, Play version/signing/release or Supabase schema/service changes. Existing licensing and independent release controls remain authoritative.

- [x] Write failing synthetic browser regressions for missing PWA reader diagrams, retry, stale account/ref/zoom state, offline reuse and mid-request entitlement loss.
- [x] Integrate gallery in mock, flashcards, history, expanded bookmarks/mistakes and search details; preserve answer concealment and prevent diagram clicks flipping flashcards.
- [x] Fix PWA image cache/request bounds and gallery state/retry/accessibility; prevent accidental attachment removal in bank publishing.
- [x] Fix Android gallery/cache lifecycle and retry with isolated tests and unsigned CI evidence.
- [x] Review diffs; run security/build, media/publisher tests and relevant browser/Android CI; prepare PRs and document exact offline/update limits.

**Review focus:** Same question ID with revised refs; account switch/revocation while zoomed or downloading; explanation visibility during exams/flashcards; lost images after CSV uploads; retry/corrupt cache and offline errors. Tests use synthetic media and block real external services. Native automatic question-bank refresh remains opt-in; an app update is still required for new reader code.

## Verification evidence

- Synthetic browser regressions: 13/13 pass, including real PNG decoding, Retry, modal/Escape/focus, owner/ref/access changes, cached digest cancellation/revocation, bounded streams, encrypted bookmark/mistake rehydration, and all added readers with image-only explanations.
- Publisher tests reproduced image-only edits incorrectly reporting zero changes; correction counts and before/after media metadata now pass alongside accidental-removal, malformed metadata, atomic publication and idempotent retry regressions.
- Production build, release-safety security checks, progress revision storage/retention/checkpoints, saved-data recovery, scored-results, Quick Scan and 79 pinned-refresh session browser regressions pass.
- Android PR #22 at b9f00e9: CI43298571606 unit tests/lint and CI43298571216 compilation/unit tests pass. No signing, version change or Play release performed.
- Root reviewed diffs and test evidence. A second PWA reviewer checked gallery identity/private cache paths but exhausted its session allowance before completing the full review; remaining review was performed inline.
- No production banks, images, backend configuration or releases changed. Offline verification covers previously viewed diagrams only, not complete track image packs. Physical Android device acceptance remains a release check.

## Follow-up: attachment upload feedback

The admin upload clears the native file input immediately so the same file can be retried; the resulting browser text incorrectly suggests a successful attachment was not selected. Replace that exposed native picker with a labeled Choose image/Add another image button and persistent attachment count beside the draft list. Make the admin description optional, defaulting to a placement/question label while preserving the shared nonempty alt contract. Keep question text separate and preserve the explicit apply/queue/validate/publish sequence. Browser regression covers blank/custom descriptions, reselecting the same file, removal and existing queue flow against a synthetic upload service.

Follow-up verification: the old UI failed the optional-description browser regression. The new editor passes upload with a blank/default description, custom description, same-file reselection after removal, visible failed-upload retry, and attachment metadata retained through apply/queue/validation. The browser creates its synthetic PNG using canvas so image decoding and WebP conversion exercise the real upload path. Upload errors previously hid when a bank was loaded; the alert now remains rendered.
