# Shared Android and website question banks

The active source is `Nhyle-zunne/hyperion-reviewer/app/src/main/assets/questions`. Website uploads change these same encrypted files directly in GitHub. No question-bank files are uploaded to Supabase Storage. Supabase continues to provide administrator authentication, licenses, saved progress and small derived metadata caches.

Android's physical GMDSS folder is `pro/`. The website keeps its historical logical `gmdss/` mapping so question IDs, bookmarks, mistakes and session references remain stable. Existing installed Android versions retain their bundled bank until an app update; new builds bundle the shared assets.

## Publish from the website

1. Sign in as an administrator and open **Account → Question Bank**.
2. Select up to 10 raw `.csv` or compatible `.csv.enc` files. Verify each mapped destination.
3. Choose **Validate batch**. Review question counts, appended rows, and corrections, including changed choices and answers.
4. Choose **Publish verified batch to GitHub**. The files and checked manifest enter an immutable bank commit; a release pointer is committed and `main` advances once without forcing it. Concurrent updates fail safely. Previous encrypted versions remain in GitHub history.
5. Open the resulting GitHub commit link. Online readers refresh the small release pointer on a bounded interval. Offline packs refresh automatically after a complete replacement is verified; version checks are cached for five minutes. Existing sessions keep their saved snapshots.

Raw CSV limit: 700 KB per file. Encrypted limit: 1 MiB per file. Combined encrypted files: 8 MiB per batch. The 10-file limit keeps each operation within Worker subrequest limits; larger updates can be divided into several reviewed batches.

The publisher blocks shorter valid-question lists and known questions moving positions. It cannot distinguish every arbitrary rewrite from a legitimate correction, because IDs derive from positions. Review corrections carefully and append new questions at the end. It also checks all existing bank blob identities, including unselected files, so an unrelated unpublished GitHub edit cannot silently enter a release.

## Credentials and authorization

Configure **GITHUB_BANK_WRITE_TOKEN** as a production Cloudflare Worker secret: a fine-grained token limited to `hyperion-reviewer`, with Contents read/write. No token belongs in Vite variables, browser storage, source files or chat. Every admin operation obtains a fresh server-verified administrator decision before parsing uploads or calling GitHub. Missing/expired credentials disable publishing without removing saved data.

Student delivery does not depend on the publishing token. While the repository is public, readers fetch public encrypted assets. If it becomes private, first configure a separate server-only **GITHUB_BANK_READ_TOKEN** in both the Worker and Supabase `question-bank` function.

## Private-repository build checks

The private bank also needs authenticated access during website build checks. Add the read-only token to the **hyperion-pwa repository → Settings → Secrets and variables → Actions** as **BANK_READ_TOKEN**. GitHub reserves repository secret names beginning with GITHUB_; the workflow maps BANK_READ_TOKEN to the test process variable GITHUB_BANK_READ_TOKEN only for the bank regression step. Cloudflare and Supabase runtime secret names remain GITHUB_BANK_READ_TOKEN. Never use a VITE_ prefix or put token values in source/configuration files.

Private repositories consume the account's included GitHub Actions allowance. Runtime question delivery and build-test access use separate configured secret locations; neither requires making the repositories public.

## Release metadata and integrity

`hyperion-manifest.json` and `hyperion-release.json` live beside the shared asset folders. The release pointer identifies an immutable bank commit and the manifest's SHA-256; the manifest identifies all 69 encrypted files by path, byte count and SHA-256. Source bytes are verified before decryption. Only a genuine initial missing pointer selects the embedded initial snapshot; a warm upstream outage retains the last verified release and a cold outage fails safely.

Metadata, fresh counts and pages are pinned to one release. Mismatched versions abort a replacement rather than committing a partial or mixed offline pack. Publishing never deletes or resets bookmarks, mistakes, session logs, completed audits or local packs. Paid access is verified on every request independently of content caches.

Manual edits to bank files outside the publisher remain unpublished and block publication until reconciled. Do not use the legacy Supabase uploader or Storage migration scripts for live bank updates. Supabase's retained old objects are rollback copies, not the active source.
