# Migration Phase 2 — Catalog Functional Suite on PostgreSQL

**Status:** implemented (Vercel + Supabase migration, phase 2 of the audit plan;
builds on [migration-phase1.md](migration-phase1.md))

## Goal

Run the real `test/catalog.test.js` functional suite (categories CRUD, product
CRUD, search/filter/sort/pagination, admin enforcement, validation) against the
local embedded-PostgreSQL scratch database — verifying actual schema creation
and queries on PostgreSQL, not just connectivity.

## What changed

| File | Change |
| --- | --- |
| `backend/controllers/productController.js` | Case-insensitive `q=` search: PG uses `Op.iLike`, MySQL keeps `Op.like` (byte-identical SQL) — same API contract on both dialects. |
| `backend/controllers/categoryController.js` | Duplicate-name pre-check (`findCategoryByName`): PG uses `LOWER(name)` comparison; MySQL keeps the plain `{ name }` query (its ci collation already matches). Preserves the "dupe cat" == "Dupe Cat" → 409 contract. |
| `backend/test/helpers.js` | `createAdminUser` grants the role via the User model on PG (the audited CLI script `scripts/admin-role.js` is raw-mysql2 and stays MySQL-only until the tooling phase). MySQL path unchanged. |
| `backend/test/pgSuite.js` | **New** launcher: starts embedded PG (data dir in OS temp, outside repo/OneDrive), runs the given suite in a child `node --test` with `DB_DIALECT=postgres` + `PG_*` env, stops the server, cleans up, exits with the suite's code. |
| `backend/package.json` | New script `test:pg:catalog`. |
| `docs/migration-phase2.md` | This file. |

Not migrated (out of scope, unchanged): checkout/order transactions, stock
handling, authentication flows, raw-SQL tooling (`db-backup`, `db-restore`,
`migrate`, `admin-role`, `test-user`, `migrations.test.js`).

## How to run

```bash
npm test               # full MySQL suite + dialect unit tests (scratch MySQL)
npm run test:pg        # PG connectivity/schema smoke (5 tests)
npm run test:pg:catalog # catalog functional suite on embedded PG (18 tests)
```

## Verified behavior on PostgreSQL (this phase)

- Full schema creation via `sequelize.sync()` (all models, ENUMs, JSON,
  DECIMAL, FK `ON DELETE SET NULL`).
- Category/product insert, update, delete; slug generation and uniqueness.
- Legacy free-text `category` auto-link / unlink / relink.
- Case-insensitive `q=` search on name and description (ILIKE).
- Case-insensitive duplicate category name → 409 (`LOWER()` pre-check).
- Filtering by category slug/id/legacy name, price range, stock.
- Sorting by price, stable non-overlapping pagination (id tiebreaker).
- Admin-only enforcement (401/403) and validation 400s.

## Boundaries honored

- Loopback embedded PostgreSQL only; scratch DB `buyoDB_ph2_test` (drop +
  recreate per run via the shared guarded harness).
- `DATABASE_URL` never read; no Supabase connection possible from these paths.
- Real `buyoDB` and the local MySQL server untouched; MySQL path byte-identical
  in the edited controllers (dialect branches preserve the MySQL query).
- PG data dir in OS temp, removed after every run.

## Known gaps (later phases)

- DB-level unique index on `Categories.name` is case-sensitive on PG — the
  controller pre-check enforces the 409 contract, but a concurrent race could
  insert case-variants. MySQL's ci collation enforces at the DB level. Fix:
  functional unique index on `LOWER(name)` in the PG migration phase.
- Order/checkout, stock, auth suites not yet run on PG (next phases).
- Raw-SQL tooling is MySQL-only until the tooling-migration phase.
