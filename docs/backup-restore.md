# BuyO — MySQL Backup & Restore Verification

Phase 1 adds two explicit local tooling scripts that replace implicit, boot-time
schema syncing. Both are MySQL-only and never touch a remote host by default.

## 1. Backups — `npm run db:backup`

- Read-only: issues only `SHOW TABLES`, `SHOW CREATE TABLE` and `SELECT *` statements.
- Output: `backend/backups/buyo-backup-<YYYYMMDD-HHmmss>.json`
  - `format`, `createdAt`, `database` metadata
  - per table: `rowCount`, `createSql` (exact DDL incl. indexes and foreign keys), `rows` (all data)
- Never contains credentials: no env values, usernames, passwords or connection strings.
- Writes **only** into `backend/backups/`, which is git-ignored. The script refuses to write elsewhere.
- Safety guard: refuses a non-loopback host unless `--allow-remote` is passed explicitly
  (intended for the future hosted database). Default is local-only.

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
  `DB_RESTORE_ALLOWED_DATABASES`), targets that already exist, and restoring
  over the database the backup was taken from.
- FK checks are disabled only while loading (standard dump/restore technique);
  counts are verified afterwards, then the script tells you to drop the scratch DB.

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
