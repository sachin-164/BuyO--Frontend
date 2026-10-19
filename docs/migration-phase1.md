# Migration Phase 1 — Dual-Dialect Groundwork (MySQL default, PostgreSQL opt-in)

**Status:** implemented (Vercel + Supabase migration, phase 1 of the audit plan)

## Goal

Make the backend dialect-aware **without changing any current behavior**, so a
later (separately-approved) phase can run the same code against PostgreSQL /
Supabase. MySQL remains the default and the production setting throughout this
phase.

## What changed

| File | Change |
| --- | --- |
| `backend/config/dbConnectionOptions.js` | Added `resolveDialect()` (unset/`mysql` → mysql, `postgres`/`postgresql` → postgres, anything else **throws**), `resolvePostgresSettings()` (`PG_*` names, port default 5432), `resolveSettings()`; `getSequelizeOptions()` branches on dialect. MySQL path unchanged. |
| `backend/config/db.js` | Resolves dialect; connection label is `MySQL` or `PostgreSQL`. MySQL log messages unchanged. |
| `backend/test/helpers.js` | `recreateTestDatabase()` handles both dialects with the same safety rules (name forced to `buyoDB_ph2_test`, `_test` suffix enforced, drop+recreate per run). MySQL path unchanged. |
| `backend/test/dialect.test.js` | **New** DB-free unit tests for the resolvers (default = mysql, opt-in = postgres, invalid throws, MySQL mapping unchanged, `DATABASE_URL` never read). |
| `backend/test/pgSmoke.test.js` | **New** opt-in smoke test: starts embedded PostgreSQL, syncs the full schema, Category round-trip, stops and cleans up. |
| `backend/test/pg-smoke.env` | Env file for `npm run test:pg` (sets `PG_TESTS=1`; no secrets). |
| `backend/package.json` | devDependencies `pg`, `embedded-postgres`, `@embedded-postgres/windows-x64`; `test/dialect.test.js` added to `npm test`; new `test:pg` script. |
| `backend/.env.example` | Names-only additions: `DB_DIALECT`, `PG_HOST/PORT/DB/USER/PASS`, explicit "DATABASE_URL not read" note. |

## How to run

```bash
# Existing MySQL suite + new dialect unit tests (scratch MySQL only)
npm test

# PostgreSQL smoke test (starts a local embedded server; data dir in OS temp)
npm run test:pg
```

## Environment matrix

| Variable | Unset means | Notes |
| --- | --- | --- |
| `DB_DIALECT` | **mysql** (current behavior) | `postgres` = local PG harness only |
| `PG_HOST` / `PG_PORT` / `PG_DB` / `PG_USER` / `PG_PASS` | — | Read only when `DB_DIALECT=postgres`; loopback only |
| `DATABASE_URL` | — | **Never read** by the backend in this phase (Supabase is a later, separately-approved phase) |
| `MYSQL_*` | unchanged | MySQL path is byte-for-byte the pre-phase behavior when `DB_DIALECT` is unset |

## Boundaries honored in this phase

- No connection to Supabase or any remote database was made or is possible via
  these code paths (PG settings resolve from `PG_*` names only; no SSL/remote
  knobs exist yet on the PG path).
- `DATABASE_URL` is deliberately not parsed anywhere.
- The PG smoke harness uses the same scratch-name safety rule as MySQL
  (`buyoDB_ph2_test`), loopback only, embedded server, data dir in the OS temp
  directory (outside the repo and OneDrive), removed after the run.
- Raw `mysql2` consumers (`db-backup`, `db-restore`, `migrate`, `admin-role`,
  `test-user`, `migrations.test.js`) are untouched and still MySQL-only.
- The full 6-suite functional test run is still MySQL-only; PostgreSQL parity
  for those suites is a later phase.

## Known gaps (later phases, not started here)

- Full test-suite parity on PostgreSQL.
- Remote/Supabase connection settings (SSL, `DATABASE_URL`), the Phase 8
  guard's remote-allowlist extension, dialect-aware migrations, and the
  MySQL-specific `sequelize.literal` search SQL in the order controllers.
- Hosted deploy of the API (Vercel or otherwise).
