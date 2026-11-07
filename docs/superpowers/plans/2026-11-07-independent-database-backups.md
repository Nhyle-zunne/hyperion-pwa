# Independent database backups implementation plan

> Use executing-plans for inline implementation and requesting-code-review before delivery.

**Goal:** Daily encrypted off-Supabase backups, with isolated recovery checks before a Free downgrade.
**Architecture:** A private GitHub Actions workflow exports a complete PostgreSQL custom archive plus Supabase CLI portable roles/schema/business data, encrypts all files with age, retains only ciphertext for 7 days, and restores the encrypted portable copy into a disposable local Supabase instance. Never restore against a supplied remote URL. Secrets are configured through GitHub, never chat.
**Spec:** User's request to establish scheduled private database backups and test restoration before relying on Free.
**Constraints:** No production writes/deletion, no production log scans, no plaintext artifacts or errors containing customer rows. Preserve RLS, roles, auth users, order/payment records and saved progress. Storage bytes and encryption root keys require separate recovery procedures. Artifacts expire and consume private Actions quota; retain an offline encrypted copy too.

## Tasks
- [x] Test URL restrictions, COPY record integrity checks, missing credentials and encrypted restore with synthetic real PostgreSQL data.
- [x] Implement exports, authenticated encryption, fixed local restore target, exact COPY content verification, cleanup and sanitized errors.
- [x] Add daily/manual workflow with private-repository gate, encrypted-only artifact, no overlapping runs, fail-closed missing configuration, and recovery runbook.
- [ ] Run synthetic round-trip, security checks and review; publish the ready configuration. A real production backup/restore remains blocked until securely configured credentials are available.

## Review focus
- Public repository or fork must not run production backup.
- Wrong encryption identity/corruption must fail, without exposing data.
- Restore must never target production or execute production schedules.
- Database/role/schema mismatches must fail rather than produce a green drill.
- Missing credentials must fail visibly, never silently skip a scheduled backup.

## Verification record

Baseline synthetic encrypted Supabase restoration and migration replay passed in run 42364207203; local security/build and URL/integrity tests passed. Final extraction removes the second remote data read and derives portable data from the full archive; regression CI must pass before merge. Production credentials and CA/key secrets remain unavailable, so no production backup or restore is claimed.
