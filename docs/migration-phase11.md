# BuyO Migration Phase 11 — Supabase Database Readiness and MySQL→PostgreSQL Migration Planning

Type: audit + design + local rehearsal. **No Supabase connection, no remote
resource, no production data movement, no deployment.** Local `buyoDB`
inspected read-only; all tests ran against disposable local fixtures only.

Base commit: `578e77fd73aa066c77e46ef5a5fbbb9dfc9f20e7` (Phase 10).

## 1. What changed (files)

| File | Change |
|---|---|
| `backend/scripts/migrate-data.js` | **new** — MySQL→PG row migration utility (`npm run migrate:data`): consistent-snapshot source read, target-metadata discovery, validation-first, one-transaction import + sequence reset, post-commit verification, credential-free summary; guards reuse `localDbGuard` + `remoteTargetGate` before any connection |
| `backend/test/dataMigration.test.js` | **new** — 9-test rehearsal suite (fixtures `buyoDB_ph11_src` / `_src_dup` → target `buyoDB_ph11_import` on the embedded PG harness) |
| `backend/test/pgSchemaFor.js` | **new** — child helper: models sync + numbered `.pgsql` on a given scratch DB |
| `backend/test/pgModelRw.js` | **new** — child helper: model read + write probe proving `id = MAX(id)+1` |
| `backend/package.json` | scripts: `migrate:data`, `test:pg:data` |
| `docs/migration-data.md` | **new** — source audit, full mapping/conversion design, duplicate policy, rehearsal evidence, limitations |
| `docs/migration-remote.md` | new **§6 Supabase target prerequisites** (dashboard confirmations required before first connection), tests section renumbered §7, §5.4's "not-yet-designed" gap replaced by the Phase 11 tool reference, Phase 11 test pin added |

Unchanged: the approval token/allowlists/`DATABASE_URL` tripwire, MySQL
defaults, `db:sync` local-only, every existing script's behavior.

## 2. Key design decisions

1. **Data only, schema never** — target schema always comes from models
   sync + numbered `.pgsql` (the tool refuses if a target table is missing).
2. **Same guards, one route** — `DB_DIALECT=postgres` required; source
   loopback-only (hard refusal); non-loopback target → full existing gate;
   loopback target → `--confirm-local` + `DB_DATA_MIGRATE_ALLOWED_DATABASES`
   (default `["buyoDB_ph11_import"]`); `DATABASE_URL` never read. Guards run
   before any connection, identically for CLI and library entry.
3. **Validation-first, refuse-never-fix** — drift, NOT NULL, exact uniques,
   case-insensitive `lower(email)`/`lower(name)` (mirrors 007), FK parents,
   enum labels — any violation prints check + count + **row ids only** and
   exits 1 with zero writes. Duplicates are never merged or skipped.
4. **One transaction** — inserts + `setval` (transactional in PG) commit
   atomically; failure ⇒ empty target ⇒ safe rerun; non-empty target ⇒
   explicit previously-imported refusal.
5. **Deterministic** — fixed FK-dependency table order, `ORDER BY id`,
   ids preserved verbatim (source table names matched case-insensitively —
   Windows MySQL folds to lowercase — target names from `getTableName()`,
   e.g. PG `"Users"`/`"CartItems"`).
6. **Verification** — counts, exact id-set equality, 9 FK orphan joins,
   `last_value == MAX(id)`; the test suite re-verifies source↔target
   independently of the tool.

## 3. Source audit findings (read-only `buyoDB`; no values printed)

- 10 tables: 9 business + `schema_migrations` (4 applied MySQL migrations —
  not portable, excluded). Row counts: `users` **2**, all other business
  tables **0**.
- 9 FKs (2× SET NULL, 7× CASCADE), uniques on `users.email` (two redundant
  indexes), `categories.name/slug`, `products.slug`, `orders.orderNumber`,
  `orders(userId,idempotencyKey)`; **no unique on cart/wishlist** (dup lines
  possible in MySQL — the 005/006 risk); enums (role, statuses, cod), JSON
  (`taxBreakdown`, `shippingAddress`, `imageMeta`), `FLOAT` price columns vs
  `DECIMAL` money columns, `datetime` precision 0, `tinyint(1)` booleans.
- Duplicate aggregates all **0**; image references **0**, `backend/uploads`
  files **0**.
- Findings: `db:backup` has no single-transaction snapshot (quiesce writes
  at cutover — the row tool *does* read in one consistent snapshot); a real
  `buyoDB` dump was deliberately not produced (account data in a file —
  operator step at cutover); local `buyoDB` is a dev DB — **not** assumed
  equal to live-site data.

## 4. Exact test results (this commit)

| Command | Result |
|---|---|
| `npm test` | **171 tests — 170 pass, 0 fail, 1 skip** (known Phase 3 PG-only savepoint) |
| `npm run test:pg` | 5 / 5 pass |
| `npm run test:pg:catalog` | 18 / 18 pass |
| `npm run test:pg:orders` | 22 / 22 pass |
| `npm run test:pg:auth` | 16 / 16 pass |
| `npm run test:pg:cart` | 15 / 15 pass |
| `npm run test:pg:security` | 20 / 20 pass |
| `npm run test:pg:migrations` | 14 / 14 pass |
| `npm run test:pg:tooling` | 8 / 8 pass |
| `npm run test:pg:data` (new) | **9 / 9 pass** |

Rehearsal evidence highlights (new suite): fresh scratch receives all tables
+ 4 migration indexes + exactly 9 FKs + expected PG types (type map recorded
as a test diagnostic); 7 guard-refusal cases each exit 1 **without any
connection attempt**; violation run reports `lower(email)` ids 1,2,
`unique (UserId, productId)` ids 1,2, FK-missing id 3 — with zero emails or
hashes in output and all target tables still empty; import preserves sorted
ids exactly per table, 9 FK joins match, `'1999.00'` decimals and enum/JSON/
boolean values verified from the test process, sequence `last_value ==
MAX(id)`, models then insert at `MAX(id)+1`; rerun refused with counts
unchanged; hosted migration runner refusal re-proven.

Three first-run bugs were found and fixed by the suite itself (pg_index has
no `indexname`; `array_agg` returns `{...}` text via node-postgres — grouping
moved to JS; a destructured `{ target }` vs `{ name }` mismatch). No test was
weakened or skipped.

Post-run hygiene: no `postgres.exe`/ports 5433-5434, temp data dir removed,
no `buyoDB_ph11%` scratch databases left, user's MySQL (PID 5564) untouched.

## 5. Untested / remaining risks

- Nothing migrated from the real `buyoDB`; no hosted target ever contacted;
  Supabase prerequisites (new §6 of `migration-remote.md`) are documented
  but **unconfirmed** — they need the dashboard in the approved phase.
- Zone/fraction assumptions for `datetime` → `timestamptz` documented in
  `migration-data.md` §7; `FLOAT`→`double precision` widening noted.
- `db:backup` snapshot gap remains (documented; quiesce at cutover).
- MySQL→PG row move of real data still requires: real-source dry-run,
  duplicate remediation decisions in MySQL (business call), and an approved
  cutover phase.

## 6. Requires explicit approval before first Supabase contact

Project/region identity, pooler-vs-direct decisions, emptiness check,
backup/PITR options, privileges, extensions (`docs/migration-remote.md` §6),
plus the §2 approval-token flow (`PG_REMOTE_MIGRATION_APPROVED=
phase-cutover-approval` + `--confirm-remote` + non-production + shape +
allowlists + `DATABASE_URL` absent) for any non-loopback run of any remote-
capable tool — including `migrate:data`.
