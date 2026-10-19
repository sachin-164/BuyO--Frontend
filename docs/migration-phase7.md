# Migration Phase 7 — PostgreSQL Database Tooling Compatibility

**Status:** implemented (Vercel + Supabase migration, phase 7 of the audit plan;
builds on [migration-phase6.md](migration-phase6.md))

## Goal

Audit and port the remaining MySQL-specific database tooling and migration
tests to support PostgreSQL safely — without weakening a single guard and
without breaking MySQL. **Local-only phase:** no Supabase contact, no real
`buyoDB`, no production migration, no deployment.

## 1. Audit — hard-coded MySQL assumptions found (and their disposition)

| Script / suite | MySQL assumptions found (from the actual code) | Disposition |
|---|---|---|
| `scripts/admin-role.js` | raw `mysql2` connection; backtick SQL (`` `Users` ``); `?` placeholders; `resolveMysqlSettings()` defaults in the library and `main()` | **Ported — both dialects** (guards byte-identical) |
| `scripts/db-backup.js` | `SHOW TABLES`, `SHOW CREATE TABLE`, backtick identifiers, format `buyo-mysql-backup/1`, `resolveMysqlSettings()` | **Ported — both dialects** (PG: pg_catalog-built dump, format `buyo-pg-backup/1`) |
| `scripts/db-restore.js` | `information_schema.SCHEMATA` existence check, `CREATE DATABASE` backticks, `SET FOREIGN_KEY_CHECKS`, mysql2 `VALUES ?` batch insert, format check `buyo-mysql-backup/1`, `resolveMysqlSettings()` | **Ported — both dialects** (PG: `pg_database` check, constraint-validated load, `$n` batch insert) |
| `scripts/db-sync.js` | guard settings resolved with `resolveMysqlSettings()` (the actual `sequelize.sync()` was already dialect-aware via `DB_DIALECT`) | **Fixed — both dialects** (`resolveSettings()`; guards identical) |
| `scripts/migrate.js` | *(already dual-dialect since Phase 6)* | no change |
| `scripts/test-user.js` | raw `mysql2`, interactive prompts, marker-based account management against the local dev database | **Intentionally MySQL-only** (see §3) |
| `test/migrations.test.js` | fully MySQL: `information_schema`, backtick DDL, per-target explicit settings | **Kept intact and green**; PG coverage added by the two PG suites (§4) |
| `scripts/lib/localDbGuard.js` | refusal text named `MYSQL_DB` unconditionally | **Message made dialect-aware** (`PG_DB` on PG); refusal logic untouched, MySQL text byte-identical |

Not assumed but re-verified against `pg_catalog` on the scratch harness before
the backup format was written: serial columns are `DEFAULT nextval(...)`
(not identity), enum types are referenced by column definitions,
`pg_get_constraintdef` output is directly re-runnable as
`ALTER TABLE … ADD CONSTRAINT`, and constraint-backed indexes must be excluded
from the raw-index list or a restore would emit them twice.

## 2. Tool matrix (what supports what)

| Tool | MySQL | PostgreSQL | Notes |
|---|---|---|---|
| `db:migrate` | ✅ `NNN_*.sql` | ✅ `NNN_*.pgsql` | dual since Phase 6; disjoint file namespaces |
| `admin:role` | ✅ | ✅ | same guards, same audit line; PG target from `PG_*` env only |
| `db:backup` | ✅ `buyo-mysql-backup/1` | ✅ `buyo-pg-backup/1` | read-only; formats are **not** interchangeable |
| `db:restore` | ✅ | ✅ | accepts only the active dialect's format; scratch target required |
| `db:sync` | ✅ | ✅ | plain sync only; `--alter` refused on both; allowlist defaults unchanged |
| `test:user` | ✅ | ❌ blocked | **intentionally MySQL-only** (§3) |
| `test/migrations.test.js` | ✅ | n/a | PG equivalents live in `pgMigrations.test.js` + `pgTooling.test.js` |
| remote / hosted targets | ❌ refused | ❌ refused | no allowlist was broadened; only `db:backup --allow-remote` (read path, both dialects) exists as before |

**Operations requiring explicit approval (unchanged):** any remote/hosted
database contact (including `--allow-remote`), production deployment, and all
Supabase connection work — none of which this phase performs or enables.

## 3. Intentionally restricted: `test:user`

`scripts/test-user.js` was audited and deliberately left MySQL-only: it is an
interactive, marker-based account tool tied to the local MySQL dev workflow
(`buyoDB`), not part of this phase's required scope, and its guards are
unchanged. Its limitation is now documented in
[test-account.md](test-account.md). If a PostgreSQL local-dev workflow ever
needs it, that is a separate, explicitly approved phase.

## 4. Implementation notes

- **PG settings rule (consistent with Phase 6):** the PG paths of
  `admin-role`, `db:backup` and `db:restore` resolve their target from `PG_*`
  env vars only and **refuse** an explicit `settings` argument instead of
  silently ignoring it. `DATABASE_URL` is never read; the paths are
  loopback-only with no SSL options.
- **Guards are shared, not duplicated:** every CLI still runs
  `scripts/lib/localDbGuard.js` (`--confirm-local`, `NODE_ENV!=production`,
  loopback, per-script allowlist) with unchanged defaults — refusals happen
  before any connection on both dialects.
- **PG backup = in-process pg_catalog dump** (the "clearly tested equivalent"
  permitted by the phase plan): `format_type` column DDL, verbatim defaults,
  serial sequences (with ownership), `pg_get_constraintdef` for
  PK/unique/check, foreign keys separately, `pg_get_indexdef` for
  non-constraint indexes only, enum labels per type, `SELECT *` rows with the
  same `Date`/`Buffer` normalization as MySQL. No external binaries and no
  credentials passed to child processes.
- **PG restore order:** enum types → sequences → tables → rows (per-table
  count verification) → PK/unique/check constraints → FKs → indexes →
  `setval` past the restored ids. Constraints/FKs are validated by PostgreSQL
  when added, so corrupted data fails loudly. The `setval` step covers what
  MySQL `AUTO_INCREMENT` gets for free: without it the first `DEFAULT` id
  insert after a restore would collide (pinned by a test).
- **`db:sync`** now resolves settings dialect-aware; it remains plain sync
  (no drops, no force, `--alter` refused with a pointer to `db:migrate`), and
  the allowlist defaults (`buyoDB`, `buyoDB_ph1_verify`) were **not** widened —
  a PG scratch name still needs an explicit `DB_SYNC_ALLOWED_DATABASES` entry.

## 5. Backup & restore prerequisites, failure behavior, recovery

- **Prerequisites:** local loopback database (MySQL via `MYSQL_*`, PostgreSQL
  via `PG_*`); `NODE_ENV != production`; for restore a **fresh**
  `buyoDB_*` scratch target (or explicit `DB_RESTORE_ALLOWED_DATABASES`).
  The PG path needs no external utilities (`pg_dump`/`pg_restore` are not
  used — hosted `pg_dump`-based backups are a cutover-phase decision).
- **Writes:** dumps go only into `backend/backups/` (git-ignored) and contain
  schema + data + counts — never env values, usernames, passwords or URLs
  (asserted by test: no plaintext fixture passwords, no cluster password).
- **Refusals (tested on both dialects):** wrong/foreign backup format,
  restoring over the backup's source database, existing target, non-scratch
  target, missing `--confirm-local`, non-loopback host, `NODE_ENV=production`.
- **Failure behavior:** a failed restore can leave a *partial target*
  (the restore is not one transaction — `CREATE DATABASE` cannot be).
  Recovery is explicit: **drop the partial `buyoDB_*` target, then re-run** —
  the tool refuses existing targets precisely so a partial state can never be
  silently overwritten. A row-count mismatch or a constraint violation aborts
  with the table name and expected/actual counts.

## 6. Test evidence (exact counts)

| Command | Result |
|---|---|
| `npm test` | **130 tests — 129 pass, 0 fail, 1 skip** (the skip is Phase 3's dialect-gated PG-only savepoint test; identical to the Phase 6 baseline) |
| `npm run test:pg` | **5/5 pass** |
| `npm run test:pg:catalog` | **18/18 pass** |
| `npm run test:pg:orders` | **22/22 pass** |
| `npm run test:pg:auth` | **16/16 pass** |
| `npm run test:pg:cart` | **15/15 pass** |
| `npm run test:pg:security` | **20/20 pass** |
| `npm run test:pg:migrations` | **14/14 pass** (was 12 — added checksum-tamper, verify-refusal/recovery, CLI-allowlist tests) |
| `npm run test:pg:tooling` *(new)* | **8/8 pass** |

**Coverage mapping** (`migrations.test.js` → PG): guard refusals (flag,
production, loopback, allowlist) → pgMigrations test 1 + pgTooling tests 1/4;
migration ordering (005→006→007) and rerun idempotency → pgMigrations
ordered `applied` assertions; checksum mismatch → new pgMigrations test;
failure rollback + duplicate detection (3 scenarios) → existing pgMigrations
tests; verification → new pgMigrations verify-refusal test; restore
round-trip + JSON columns + restore refusals + admin provisioning
grant/noop/revoke/not-found/invalid-role → pgTooling (library **and** CLI);
`db:sync` guards → both suites.

**Real round-trip verification (not just documented):** pgTooling test 7
backs up the migrated, seeded scratch database, restores it into a *fresh*
`buyoDB_ph7_restore`, and asserts — every table's row count matches; user rows
(including bcrypt hashes) and the Orders row (including both JSON columns) are
byte-identical; PK, unique email constraint, `LOWER(email)` functional index,
composite cart index and the CartItems→Users FK exist in the restored
database; enum labels round-trip; a `DEFAULT` id insert succeeds (sequence
advanced); `schema_migrations` round-trips; restoring over the existing
target is refused; the target is dropped afterwards.

## 7. Safety checks performed

- Disposal only: `buyoDB_ph2_test` (drop/recreate per run) and
  `buyoDB_ph7_restore` (created and dropped by the suite); `backups/ph7-test`
  removed in `after()`.
- `DATABASE_URL` never read; no Supabase/remote connection anywhere; loopback
  guards unchanged; allowlists not broadened; `--alter` still refused.
- Post-run check: no `postgres.exe`, no listeners on 5433/5434, temp data dir
  removed, local MySQL (port 3306, PID 5564) untouched, clean working tree.
- Diff reviewed file-by-file; secret scan run before commit (no credentials,
  keys, certs or env values in the diff).

## 8. Known limitations / remaining risks

- `db:backup`'s PG path throws on generated columns (`GENERATED ALWAYS AS`)
  — none exist in this schema; a future model using one must extend
  `describeTablePg` first.
- Hosted/production PostgreSQL backups are **not** in scope here; a
  `pg_dump`-based procedure remains a cutover-phase decision.
- `test:user` stays MySQL-only (documented, deliberate).
- `helpers.createAdminUser` still grants the role via the model on PG (the
  CLI path is pinned directly by `test:pg:tooling` instead).
- Unchanged deferrals from earlier phases: bcrypt cost bump, Redis
  rate-limiter store, real-SMTP testing, object storage, nodemon,
  `CREATE INDEX CONCURRENTLY` and moving `pg` to `dependencies` (cutover).

## 9. Next phase (recommendation)

With all tooling dual-dialect, the remaining audit plan is **cutover
preparation** (separately approved): API URL switch point (`js/config.js`),
deploy environment wiring, `pg` → `dependencies`, backup/restore runbooks for
the hosted database — still **without** connecting to Supabase until that
connection is explicitly allowed.
