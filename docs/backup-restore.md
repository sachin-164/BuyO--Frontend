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

## 2. Restore-verification procedure (documented — do NOT run against production)

To gain confidence that a backup is restorable:

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

A dedicated `db-restore.js` helper is intentionally **out of scope for Phase 1**; it will be
added when backups move to the hosted environment (release phase).

## 3. Schema setup — `npm run db:sync -- --confirm-local`

Explicit local schema setup (replaces boot-time `sequelize.sync()`):

- Refuses to run unless ALL of: `--confirm-local` flag passed, `NODE_ENV` not production,
  loopback host (`localhost`/`127.0.0.1`/`::1`), database listed in `DB_SYNC_ALLOWED_DATABASES`
  (defaults to local dev database names only).
- Plain sync only (creates missing tables). `--alter` is opt-in for local column changes.
- There is no `force`/drop path in this script — it cannot destroy tables.
- Production schema changes will be handled by versioned migrations in a later phase.
