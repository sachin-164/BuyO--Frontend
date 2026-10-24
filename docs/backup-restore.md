# BuyO — Backup & Restore Verification

Phase 1 added two explicit local tooling scripts that replace implicit,
boot-time schema syncing. Both are **dual-dialect since Migration Phase 7**
(MySQL default, PostgreSQL via `DB_DIALECT=postgres`), and neither touches a
remote host by default.

**Dialect support (see also `migration-phase7.md`):**

| | MySQL (default) | PostgreSQL |
|---|---|---|
| Backup format | `buyo-mysql-backup/1` (`SHOW CREATE TABLE` DDL) | `buyo-pg-backup/1` (pg_catalog-built DDL) |
| Restore accepts | `buyo-mysql-backup/1` only | `buyo-pg-backup/1` only |
| Settings | `MYSQL_*` env | `PG_*` env (never `DATABASE_URL`) |
| Extra prerequisites | none | local loopback PG; fresh `buyoDB_*` target |
| Remote hosts | refused unless `--allow-remote` (backup read path) | same rule, same flag |

The formats are **not** interchangeable: restoring a MySQL dump on the PG path
(or vice versa) is refused before any connection. On a failed restore the
target may be left partial — drop the partial `buyoDB_*` target and re-run
(the tool refuses existing targets by design).

## 1. Backups — `npm run db:backup`

- Read-only: MySQL issues only `SHOW TABLES`, `SHOW CREATE TABLE` and
  `SELECT *`; PostgreSQL reads `pg_catalog` metadata and runs `SELECT *`.
- Output: `backend/backups/buyo-backup-<YYYYMMDD-HHmmss>.json`
  - `format`, `createdAt`, `database` metadata
  - per table: `rowCount`, DDL, `rows` (all data). MySQL `createSql` is the
    exact `SHOW CREATE TABLE` output; the PG dump splits DDL into `createSql`
    (columns/defaults), `sequences`, `constraintSqls` (PK/unique/check),
    `fkSqls` and `indexSqls` (raw indexes), plus top-level `enumTypes`.
- Never contains credentials: no env values, usernames, passwords or connection
  strings (tested: plaintext fixture passwords and the harness cluster
  password are absent from the file — only bcrypt hashes are stored).
- Writes **only** into `backend/backups/`, which is git-ignored. The script refuses to write elsewhere.
- Safety guard: refuses a non-loopback host unless `--allow-remote` is passed explicitly
  (intended for the future hosted database). Default is local-only.

### 1.1 Backup security — do not leave plaintext dumps in a sync folder

A dump is a **personal-data and credential artifact**: it contains user emails,
names, addresses, order history and bcrypt password hashes. `backend/backups/`
being git-ignored does not make it private. A checkout inside OneDrive,
Dropbox, iCloud Drive, Google Drive or SharePoint is automatically uploaded to
a consumer service and replicated to every signed-in device, outside the
repository's access controls. `db:backup` prints a warning when it detects such
a path; do not ignore it.

Required handling for a real backup:

1. Take the backup and verify a restore (see §2/§4) before moving it.
2. Encrypt it before it leaves the machine when the destination is not already
   encrypted at rest. Use a maintained tool (e.g. `age`, `gpg`, or 7-Zip
   AES-256) with a key/passphrase stored in a password manager — never next to
   the dump.
3. Store the encrypted copy in access-restricted storage: an encrypted
   disk/volume under owner control, or a private bucket with server-side
   encryption, versioning and a narrow IAM policy. Only the owner/operator set
   should be able to read it.
4. Delete the plaintext local copy **and** purge the cloud-sync provider's
   trash/version history. Deleting a file locally does not revoke copies already
   uploaded to the sync service.
5. Record retention/expiry and re-test a restore from the encrypted copy. Never
   attach a dump to a ticket/chat, commit it, or place it on a public static
   host.

**Current state:** the Phase 1/10 drill dumps were created under
`backend/backups/` inside a OneDrive-synced checkout. The drill has been
verified; the plaintext file is removed as part of this release hardening and
must not be recreated there for production use.

## 2. Restore verification — automated since Phase 3

Restoring and verifying a backup is now a one-command, guarded operation
(see §4). The manual steps below remain documented for reference: they are
exactly what `db:restore` performs (DDL → rows with `Date`/`Buffer` revival →
row-count verification → drop the scratch DB).

1. Create a scratch database **locally**, e.g. `buyoDB_restore_verify`. Never restore over an
   existing database.
2. Apply the DDL: for each entry in `tables`, run its `createSql`.
3. Insert the data: for each table, insert its `rows`, mapping wrapped values back:
   `{ "__type": "Date", "iso": ... }` → `new Date(iso)` and
   `{ "__type": "Buffer", "base64": ... }` → `Buffer.from(base64, "base64")`.
4. Verify:
   - row counts match the `rowCount` metadata for every table;
   - foreign keys exist: `SHOW CREATE TABLE CartItems` / `WishlistItems` show
     `FOREIGN KEY (UserId) REFERENCES Users (id) ON DELETE CASCADE`;
   - `Users.email` has a unique index;
   - a smoke join works: `SELECT u.email, c.name, c.qty FROM Users u JOIN CartItems c ON c.UserId = u.id`;
   - the application boots against the scratch DB and `GET /api/products` returns 200.
5. Drop the scratch database afterwards.

The dedicated `db:restore` helper (below) now automates all of §2.

## 3. Schema setup — `npm run db:sync -- --confirm-local`

Explicit local schema setup (replaces boot-time `sequelize.sync()`):

- Refuses to run unless ALL of: `--confirm-local` flag passed, `NODE_ENV` not production,
  loopback host (`localhost`/`127.0.0.1`/`::1`), database listed in `DB_SYNC_ALLOWED_DATABASES`
  (defaults to local dev database names only).
- Plain sync only (creates missing tables). It **cannot** alter existing tables:
  `--alter` is refused with a pointer to `npm run db:migrate` (Phase 3+).
- There is no `force`/drop path in this script — it cannot destroy tables.
- Schema evolution runs through the numbered migrations (`backend/migrations/`).

## 4. Restore tool — `npm run db:restore` (Phase 3)

```bash
npm run db:restore -- --target buyoDB_scratch_check --confirm-local
npm run db:restore -- --file backups/buyo-backup-<stamp>.json --target buyoDB_scratch_check --confirm-local
```

- Restores a backup into a **new, disposable** database and verifies every
  table's row count against the backup metadata (mismatch = failure).
- Refuses: non-loopback hosts, `NODE_ENV=production`, missing `--confirm-local`,
  targets that are not `buyoDB_*` scratch databases (or explicitly listed in
  `DB_RESTORE_ALLOWED_DATABASES`), targets that already exist, restoring
  over the database the backup was taken from, and backups whose `format`
  does not match the active dialect.
- MySQL: FK checks are disabled only while loading (standard dump/restore
  technique); counts are verified afterwards. PostgreSQL: rows load first,
  then PK/unique/check constraints and FKs are added (PostgreSQL validates
  them on add), indexes are rebuilt, and sequences are advanced past the
  restored ids. Both paths then tell you to drop the scratch DB.

### Phase 3 drill result (2026-10-18)

1. `npm run db:backup` → `backups/buyo-backup-20261018-105711.json`
   (4 tables: users:1, products:0, cartitems:0, wishlistitems:0).
2. `npm run db:restore -- --file ... --target buyoDB_ph3_restore_test --confirm-local`
   → all 4 tables restored, row counts match the backup.
3. Spot check: the restored `users` row was byte-identical in content to the
   source (same email/name/isVerified) and the restored schema was pre-v1
   (no `role` column) as expected.
4. Scratch database dropped. The restore path is now drill-verified, not just
   documented (also covered by `test/migrations.test.js` on every `npm test`).
