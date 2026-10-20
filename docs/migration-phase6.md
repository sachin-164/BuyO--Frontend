# Migration Phase 6 — PostgreSQL Uniqueness Constraints + Guarded Migrations

**Status:** implemented (Vercel + Supabase migration, phase 6 of the audit plan;
builds on [migration-phase1.md](migration-phase1.md) …
[migration-phase5.md](migration-phase5.md))

## Goal

Close the three constraint gaps that only existed on PostgreSQL, through
versioned, repeatable, guarded migrations — local-only, scratch-tested, with
MySQL behavior untouched and no Supabase contact.

## 1. Schema audit (verified, not assumed)

Physical names were read from `pg_catalog`/`information_schema` on the
embedded-PostgreSQL scratch harness (temporary audit suite, deleted after use):

| Table (physical) | Columns used | Existing uniqueness on PG | Gap |
| --- | --- | --- | --- |
| `"CartItems"` | `"UserId"` integer NOT NULL (FK → `"Users".id`), `"productId"` integer NULL | PK only | no composite unique |
| `"WishlistItems"` | `"UserId"`, `"productId"` (same shapes) | PK only | no composite unique |
| `"Users"` | `email` varchar NOT NULL | `Users_email_key` (case-**sensitive**) | no `LOWER(email)` guarantee |
| `"Categories"` | `name` varchar NOT NULL | `Categories_name_key` (case-**sensitive**) | no `LOWER(name)` guarantee |

On MySQL the same rules already hold via case-insensitive `utf8mb4_*_ci`
collation (email/name) and the app's transactional dedup (cart/wishlist) — so
these are PostgreSQL-only migrations. `productId` is nullable by design
(legacy/local-cart rows): PostgreSQL treats NULLs as DISTINCT in unique
indexes, so multiple NULL-product rows remain allowed — asserted by a test.

## 2. Runner change (smallest necessary change, no bypassed safeguards)

Blocker found in the audit: the existing runner is mysql2-bound end to end
(raw mysql2 connection, backtick/information_schema SQL, MySQL DDL for
`schema_migrations`, MySQL-only `.sql` files). It cannot execute PostgreSQL
as-is. The smallest change that keeps EVERY safeguard:

**`scripts/migrate.js` gained a dialect branch** (`resolveDialect()`), not a
new script:

- Same CLI guards, unmodified: `--confirm-local`, `NODE_ENV!=production`,
  loopback host, `DB_MIGRATE_ALLOWED_DATABASES` allowlist (defaults unchanged —
  nothing was broadened). Refusals still happen before any connection.
- Same bookkeeping: `schema_migrations(id, checksum, appliedAt, executionMs)`,
  SHA-256 checksum tamper protection ("applied file changed" → refused),
  orphan warning, ordered discovery, `--status`.
- Same file directory and numbering; **disjoint namespaces by suffix**:
  MySQL reads `NNN_*.sql` only (the applied `.sql` files stay frozen by
  checksum protection), PostgreSQL reads `NNN_*.pgsql` only. A dialect never
  sees the other's files. The `.pgsql` namespace applies in filename order:
  `000_pg_base_schema.pgsql` (base-schema bootstrap — creates the nine
  application tables and five enum types exactly as `sequelize.sync()` would,
  a complete no-op on a sync-built database, a full bootstrap on an empty
  target, five `verify:` directives prove the result; pinned by
  `test/pgBaseSchema.test.js` via `npm run test:pg:base`), then `005`–`007`
  (the Phase 6 index files below).
- PG settings come from `PG_*` env vars only (`DATABASE_URL` never read),
  loopback, no SSL — passing explicit `settings` to the PG branch is refused
  rather than silently ignored.
- **Transactional DDL**: each file runs in one `BEGIN … COMMIT`; any failure,
  interruption or crash rolls the whole file back and records nothing — the
  re-run-after-fix path is the recovery story (PostgreSQL has transactional
  DDL; no `sync({ alter })` anywhere; `db:sync --alter` still refused).

**`.pgsql` directives** (documented in the runner header and here):

- `-- precheck: <label>` — the statement must return **zero rows**, else the
  migration aborts and rolls back, printing the returned rows as the
  diagnostic. Precheck SELECTs must only reference columns safe to print.
- `-- verify: <label>` — the statement must return exactly one row with
  boolean `ok = true`, else abort+rollback. This is why a migration can never
  claim success unless its constraint provably exists (checked via
  `pg_index`/`pg_get_indexdef`: name, `indisunique`, `indisvalid`, expected
  column list or `LOWER(...)` expression).
- Statement policy: MySQL `.sql` files — no `;` inside string literals
  (comment lines are stripped first, then the rest splits on `;`).
  PostgreSQL `.pgsql` files — statements split on `;` OUTSIDE dollar-quoted
  bodies only, so `DO` blocks can carry the semicolons plpgsql requires
  (`000_pg_base_schema.pgsql` uses exception-guarded `CREATE TYPE` this way);
  keep `;` out of comment prose and out of plain string literals in `.pgsql`
  files, and keep `$` out of comment prose entirely. Directive comment lines
  must start their own statement chunk.

## 3. Exact index definitions

```sql
-- 005_pg_cart_items_user_product_unique.pgsql
CREATE UNIQUE INDEX IF NOT EXISTS uq_cartitems_user_product
  ON "CartItems" ("UserId", "productId");

-- 006_pg_wishlist_items_user_product_unique.pgsql
CREATE UNIQUE INDEX IF NOT EXISTS uq_wishlistitems_user_product
  ON "WishlistItems" ("UserId", "productId");

-- 007_pg_ci_unique_email_and_category.pgsql
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower
  ON "Users" (LOWER(email));
CREATE UNIQUE INDEX IF NOT EXISTS uq_categories_name_lower
  ON "Categories" (LOWER(name));
```

Each file also carries its precheck(s) before the DDL and verify(s) after.

## 4. Duplicate handling (no silent data changes)

Before each index, a precheck runs with the **exact semantics the index will
enforce** (cart/wishlist: `GROUP BY "UserId","productId"` over
`"productId" IS NOT NULL`; email/category: `LOWER(...)` collisions).

- If duplicates exist → the migration fails with a clear diagnostic listing
  **only safe columns**: cart/wishlist → `UserId`, `productId`, counts;
  users → **ids only, never email values**; categories → id + name (catalog
  data, not user data). Nothing is deleted, merged or rewritten; no index is
  created for that file; `schema_migrations` is not updated (transaction).
- **Remediation process (separate, explicit, manual — documented here, never
  automatic):** 1) read the reported ids, 2) decide per group which row to keep
  (or fix the application input that produced the duplicate), 3) delete/merge
  the extras yourself with a reviewed statement, 4) re-run
  `npm run db:migrate -- --confirm-local`. The migration then applies normally.
  The test suite exercises this flow end to end (seed dups → fail → manual
  delete → rerun succeeds).

## 5. Tests

New command: **`npm run test:pg:migrations`** → `test/pgSuite.js
test/pgMigrations.test.js` (embedded PG, scratch `buyoDB_ph2_test`,
drop+recreate per run). 12 tests, all synthetic data:

| Required behavior | Test |
| --- | --- |
| 1. fresh schema receives all indexes (sync alone does not) | *fresh schema: migration creates all four unique indexes* (also asserts unique+valid+exact column lists + bookkeeping) |
| 2. case-insensitive email uniqueness | *enforced by uq_users_email_lower* (case-differing insert passes `Users_email_key`, fails the new index) |
| 3. case-insensitive category uniqueness | *enforced by uq_categories_name_lower* |
| 4. duplicate cart items rejected | *duplicate cart lines are rejected* (+ other-user and NULL-product rows allowed) |
| 5. duplicate wishlist items rejected | *duplicate wishlist rows are rejected* |
| 6. unrelated records intact | before/after row snapshots deep-equal on every failed run + explicit baseline assertions in the recovery test |
| 7. rerun safe | *rerun is safe* (programmatic) + CLI `--status`/re-apply no-op in the recovery test |
| 8. duplicates → clear failure, no silent changes | three tests: cart precheck, email precheck (asserts **no email text** in the error), category precheck |
| 9. failed migration recoverable | the 8→9→10→11 sequence: per-file rollback proven, then documented remediation + rerun applies 007 |
| 10. existing tests still pass | full matrix below |

Added (reported separately): CLI guard refusals proven **on the PG path**
(missing `--confirm-local`, `NODE_ENV=production`), guarded CLI `--status` +
apply end-to-end on PG, and *application keeps working with the constraints
present* (API cart double-add → one line, qty 2).

## 6. Exact results (this phase)

| Command | Tests | Pass | Fail | Skipped |
| --- | --- | --- | --- | --- |
| `npm test` (scratch MySQL) | 130 | 129 | 0 | 1 — Phase 3's PG-only savepoint test (dialect-gated; green in `test:pg:orders`) |
| `npm run test:pg` | 5 | 5 | 0 | 0 |
| `npm run test:pg:catalog` | 18 | 18 | 0 | 0 |
| `npm run test:pg:orders` | 22 | 22 | 0 | 0 |
| `npm run test:pg:auth` | 16 | 16 | 0 | 0 |
| `npm run test:pg:cart` | 15 | 15 | 0 | 0 |
| `npm run test:pg:security` | 20 | 20 | 0 | 0 |
| `npm run test:pg:migrations` (new) | 12 | 12 | 0 | 0 |

`npm test` includes `migrations.test.js` — the full MySQL migration/guard/
checksum/backup suite ran unchanged against the reworked runner.

Post-run checks: no `postgres.exe`, no listeners on 5433/5434, OS-temp PG
dirs removed, local MySQL (PID 5564) untouched, clean working tree.

## 7. Limitations / not done (honest list)

- **Locking:** `CREATE INDEX` (not `CONCURRENTLY`) runs inside the
  transaction and takes a brief share lock on the table — correct and safe for
  local/scratch and small databases. On a large production DB later, prefer
  `CREATE INDEX CONCURRENTLY` (cannot run in a transaction; failure leaves an
  INVALID index to drop) — decide in the cutover phase, not now.
- **`pg` is a devDependency** (Phase 1 choice): fine for local tooling and
  tests; at Supabase cutover it must move to `dependencies` (Sequelize PG also
  needs it at runtime).
- Programmatic `runMigrations()` is unguarded (same trust model as the MySQL
  path); the CLI is the guarded entry point.
- Applied `.pgsql` files are frozen by checksum like `.sql` ones — create a
  new numbered migration instead of editing.
- Not covered by this phase: raw-SQL tooling port (`admin-role`,
  backup/restore, `db:sync` on PG), remote/Supabase connections (still
  forbidden), `docs/deployment.md` rewrite (stale P12 Railway plan).
- Outstanding security items unchanged: rotate leaked `MONGO_URI`/`JWT_SECRET`
  from old public commit `962a229`; rate-limit store still in-memory.
