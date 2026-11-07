# Independent database backups

Do **not** downgrade based on the presence of this workflow. First configure it, run it, download a ciphertext artifact, and obtain a successful **production-data portable restore check**. Synthetic CI is evidence about the tooling, not proof that the production database can be recovered. As of implementation, this environment has no database connection credential and cannot read GitHub Actions secrets (403); a production backup and restore have not been performed here.

## Schedule, privacy and retention

`Private database backup and restore check` runs daily at 19:23 UTC (03:23 Manila), or manually from Actions on `main`. GitHub schedules can be delayed; they are not a guaranteed 24-hour RPO. Overlapping runs queue. It fails visibly if credentials, export, encryption, upload or restoration fail; do not interpret a skipped job as success. Enable GitHub Actions failure notifications for your account and check the latest successful run before any downgrade. GitHub can disable scheduled workflows; monitor the schedule and artifact timestamps.

Only age-encrypted `database.tar.age` is uploaded, to this **private** repository's Actions artifacts, for **7 days**. Artifact download requires repository access. The workflow refuses forks/public repositories. A ciphertext archive is retained before the restore check, so failed recovery checks do not discard the exported recovery point. Plaintext, keys and private subprocess errors stay in temporary runner files and are removed; no customer data is included in workflow summaries. GitHub-hosted runners are destroyed after jobs. Do not run this workflow on shared/self-hosted runners.

Private Actions minutes and artifact storage have account quotas and can incur charges if billing allows it. These backups are independent of Supabase, but share your GitHub account's availability and access. Download a verified encrypted copy at least every few days to private offline storage or a separately controlled private drive; Actions artifacts expire. No automatic deletion of existing production records or prior backups is performed by these scripts. GitHub expiration removes only these new artifacts under its retention policy.

## Secure configuration (required once)

Open [repository Actions secrets](https://github.com/Nhyle-zunne/hyperion-pwa/settings/secrets/actions). Add:

| Secret | Value |
| --- | --- |
| `BACKUP_DATABASE_URL` | Production **session pooler** URL from Supabase Connect, port 5432, database `postgres`, username `postgres.evnjoezffghtrzqacwcj`, existing URL-encoded database password, and `?sslmode=verify-full`. A direct `db.evnjoezffghtrzqacwcj.supabase.co:5432` URL with username `postgres` also works on IPv6-capable runners. Transaction pooler port 6543 is refused. |
| `BACKUP_AGE_RECIPIENT` | age public key starting `age1`, generated on your own trusted computer. |
| `BACKUP_AGE_IDENTITY` | Matching private key starting `AGE-SECRET-KEY-`, used only to decrypt for the isolated restore test. |

Generate keys with `age-keygen -o hyperion-backup.key`; derive the recipient with `age-keygen -y hyperion-backup.key`. Save the private key in your password manager **and** an offline recovery location before adding the CI secret. Do not commit it, put it in a public variable, or send it in chat. Losing the key makes backups unrecoverable. CI holds a decrypt key to test recovery; anyone who can change trusted workflow code may exfiltrate CI secrets. Restrict repository write access and protect `main` accordingly. A key change requires preserving old keys for older artifacts.

Use the existing database password from your password manager; **do not reset production credentials casually**. The service-role API key and Supabase personal access token are not database passwords. The export connection performs read-only queries through a controlled PostgreSQL 17 client, with certificate verification enforced even though CLI 2.122.0 drops URL TLS parameters when constructing its own container, and the full archive explicitly enforces a read-only session. Never use an unverified TLS workaround if certificate validation fails.

Run [the workflow](https://github.com/Nhyle-zunne/hyperion-pwa/actions/workflows/private-database-backup.yml) manually on `main`. Require all steps to pass, including the restored-row check. Download the encrypted artifact, retain its workflow URL/date/commit, and verify you can decrypt it from your separate offline key copy on a trusted machine. Ensure the next scheduled run also succeeds. Until then, independent scheduled backups are **not established**.

## Contents and consistency

The encrypted tar contains:

- `database.dump`: unfiltered PostgreSQL 17 custom-format database export. This is one consistent PostgreSQL snapshot across schemas, including custom database objects, Auth, Storage metadata, migration history and extension-owned configuration where PostgreSQL permits export. It is not a physical cluster backup.
- `roles.sql`, `schema.sql`: Supabase CLI 2.122.0 portable role/schema exports, retaining application RLS, grants, triggers and functions. The CLI filters managed schemas and reserved roles to support restoring onto another Supabase instance.
- `data.sql`: a single consistent COPY export of `public`, `auth` and `storage`, excluding Auth/Storage platform migration and vector bookkeeping tables. It deliberately excludes schedules, pending HTTP queues and Vault data from the portable drill. All application tables currently live in `public`; update this list if adding application schemas.
- `manifest.json`: timestamps, source project/commit, file SHA-256 checksums and order-independent hashes/row counts for every portable COPY table. This stays encrypted too.

The full archive and portable exports are taken sequentially, so their snapshot times differ. Do not combine rows from the two exports. Avoid schema migrations during export; any schema/data incompatibility must fail the restore check. Large exports can time out after 20 minutes or hit GitHub storage quotas; a failed run is not a backup success.

A dump does **not** include Storage object bytes, Edge Function secrets, OAuth/SMTP settings, JWT keys, platform configuration, or the project's external Vault/column-encryption root key. `database.dump` may contain encrypted Vault values but is not sufficient to decrypt them on a new project. Preserve those keys/settings securely outside this repository, and reconfigure integrations and schedules separately. Question-bank files already live in private `hyperion-reviewer`; preserve that repository separately. If Storage is used for uploaded receipts/files, back up the actual private objects separately before downgrading. Do not treat Storage metadata as file recovery.

## Restore drill and incident recovery

Prerequisites: Docker, Node 24, `age`, and Supabase CLI **2.122.0**. Use a clean trusted machine with no valuable local Supabase stack on default ports. The drill does **not** accept a remote restore URL. It creates a uniquely named `hyperion-backup-drill-*` stack locally, decrypts and checksum-verifies the downloaded archive, stops API/Auth/Storage services and disconnects the restore database from all Docker networks, then restores roles/schema/portable data transactionally with triggers suppressed, and re-exports the restored rows. It compares exact per-table COPY contents independent of row order and sequence values. Any missing table, changed field, error or Auth/Storage version mismatch fails the drill. It then destroys **only its disposable local stack**, including its volumes.

```sh
# Set BACKUP_AGE_IDENTITY securely in the environment without printing it.
node scripts/independent-database-backup.mjs restore-drill /private/path/database.tar.age
```

This proves the portable business/Auth/Storage rows can be restored. It does **not** prove the entire unfiltered database archive can be replayed onto managed Supabase, that external encryption keys work, or that Storage files exist. CLI/platform schema versions may differ: never delete failing records or ignore restore errors to obtain a green run. Resolve the compatibility problem in an isolated destination and repeat the check.

For a real incident, restore to a **new isolated project**, never overwrite the source. Follow [Supabase's backup/restore guide](https://supabase.com/docs/guides/platform/migrating-within-supabase/backup-restore). Enable matching extensions, reconcile managed Auth/Storage versions, preserve custom policies/triggers on managed schemas from the full archive, and restore migration history separately from that archive. The `database.dump` TOC (`pg_restore --list`) is the recovery reference for configuration omitted by the portable CLI. Full archive restoration is operator-led because managed roles/extensions differ between destinations; do not apply raw `pg_restore --clean` to production.

Before accepting recovery, verify table contents/counts, sequence values, RLS and role grants, user sign-in, saved session/bookmark/mistake history, order status and entitlement expiry. Reconfigure external secrets without printing them. Keep production payment/webhook/cleanup/reconciliation jobs disabled on the recovery project; use synthetic providers only. Do not redirect live users until recovery is independently verified.

## Local regression

```sh
node scripts/tests/independent-backup-test.mjs
node scripts/tests/independent-backup-roundtrip.mjs
```

The round-trip creates only synthetic local data. It covers export, ciphertext privacy, wrong-key rejection, immutable recovery output, and actual local Supabase restoration. The PR workflow runs it without production secrets. Routine verification uses no Supabase diagnostic-log queries.
