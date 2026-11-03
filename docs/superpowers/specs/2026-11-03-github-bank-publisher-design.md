# Website question-bank publisher

The authorized admin updater validates CSV/.csv.enc files and publishes encrypted bank content directly to Nhyle-zunne/hyperion-reviewer/app/src/main/assets/questions. It never uploads bank files to Supabase. Supabase verifies the signed-in administrator; accounts, licenses, bookmarks, mistakes, audits and offline storage remain unchanged.

The existing admin queue is reused with a validation preview and explicit Publish action. Accept only the existing 69 destination paths, compatible encryption and valid question records. Existing valid questions may be corrected in place and new ones appended. Reject truncation, shorter lists, known-row reordering, duplicate targets, malformed data and stale base revisions. Show changed/appended counts before publication. Encrypted input is validated in server memory; raw CSV is encrypted on the server. No plaintext or GitHub credential is sent to a repository.

## Approach

Use an administrator-only Cloudflare endpoint and a fine-grained Worker secret, GITHUB_BANK_WRITE_TOKEN (Contents read/write on the reviewer repository only). No Supabase Storage writer is re-enabled. Existing embedded bank snapshots remain the initial release and outage fallback. GitHub immutable history provides previous encrypted versions.

Use a GitHub release pointer instead of requiring a code deployment for every content change. Publication creates an unpublished bank commit with the new encrypted files and manifest, then a release commit containing a pointer to that immutable bank commit and the manifest's SHA-256. Advance main once with a non-forced compare-and-swap after validation; concurrent GitHub updates fail safely. GitHub readers consume a checked pointer, immutable checked manifest and checked source bytes. Both Cloudflare and Supabase resolve the same published release on a bounded refresh interval. Invalid metadata fails closed; transient failures retain a previously verified release. Per-request paid authorization remains uncached.

A request captures a single release so pages, metadata and derived caches do not mix versions. Browser pages can pin the release across pagination; offline preparation rejects/retries a source change rather than committing mixed pages. Only content versions change; user records and offline packs are never deleted by publication. Admin status distinguishes committed GitHub content from edge propagation and displays the release revision.

## Completion evidence

Tests cover admin/guest denial, token secrecy, path/size/encryption validation, append/correction compatibility, reorder/removal rejection, concurrent publication, no ref movement on failure, manifest integrity, immutable release loading, outage behavior and saved-data/offline compatibility. Deploy backend protocol support first, then frontend/Worker. A missing publisher secret shows setup guidance and disables publishing; never claim configured publishing without checking it.

User clarification: remove the duplicate top-level question-banks directory after verifying the shared Android source. Logical GMDSS paths remain gmdss/ for IDs and map to the Android pro/ folder. Android C7 contains six text/option corrections compared with the old PWA source, with all IDs/counts/answer indices preserved; adopt the requested Android source. Existing installed Android versions retain their bundled questions until an app update.

Review rulings: cap atomic publications at 10 files and 8 MiB total to respect Worker subrequest/memory limits. Show in-place corrections for review because arbitrary semantic replacements cannot be proven safe from position-based IDs alone. Publication request IDs and input digests support idempotent lost-response recovery. Pin metadata/pages to one release; reject mixed revisions rather than combining online pages with an older offline fallback.
