# Migration Phase 3 — Orders, Checkout and Admin Orders on PostgreSQL

**Status:** implemented (Vercel + Supabase migration, phase 3 of the audit plan;
builds on [migration-phase1.md](migration-phase1.md) and
[migration-phase2.md](migration-phase2.md))

## Goal

Make the orders/checkout/admin-order code run correctly on PostgreSQL while
keeping MySQL behavior byte-identical, and prove it by running the full
`test/orders.test.js` suite (addresses, COD checkout, idempotency, concurrency,
status transitions, restock) against the local embedded-PostgreSQL scratch DB.

## What changed

| File | Change |
| --- | --- |
| `backend/utils/sqlLiterals.js` | **New**: `stockDelta(op, qty, env)` — the guarded `column = column ± qty` arithmetic, quoted per dialect (MySQL `` `stock` ``, PG `"stock"`), re-validating `op ∈ {+,-}` and integer `qty ≥ 1` so no user value can reach the literal. MySQL output is byte-identical to the old inline SQL. |
| `backend/controllers/orderController.js` | 1) Stock decrement now uses `stockDelta("-", qty)` instead of a backtick literal (backticks are a syntax error on PG). 2) Order-number collision retry: on PG every `Order.create` attempt runs inside a SAVEPOINT — MySQL/InnoDB tolerates a failed INSERT inside an open transaction, PostgreSQL aborts the whole transaction on any failed statement (`current transaction is aborted`), which would have poisoned the checkout and turned a rare collision into a 500. MySQL keeps the original inline create. |
| `backend/controllers/adminOrderController.js` | Restock update uses `stockDelta("+", qty)` (was a backtick literal). |
| `backend/test/orders.test.js` | 1) New test: unauthenticated checkout → 401 (previously uncovered, runs on both dialects). 2) New PG-only test: the savepoint mechanism — a unique violation on `uq_orders_number` inside a savepoint must leave the outer transaction usable and commit the retried order (skipped on MySQL). 3) The admin fail-closed test toggles `Users.role` through the model on PG (the audited CLI helper `applyRoleChange` is raw-mysql2 and stays MySQL-only); MySQL keeps the CLI call. |
| `backend/test/dialect.test.js` | DB-free unit tests for `stockDelta`: MySQL backticks, PG double quotes, rejection of unsafe operators/quantities. |
| `backend/package.json` | New script `test:pg:orders`. |
| `docs/migration-phase3.md` | This file. |

Not migrated (out of scope, unchanged): authentication flows, raw-SQL tooling
(`db-backup`, `db-restore`, `migrate`, `admin-role` CLI, `test-user`,
`migrations.test.js`), rate-limiter/session stores.

## How to run

```bash
npm test                # full MySQL suite + dialect unit tests (scratch MySQL)
npm run test:pg         # PG connectivity/schema smoke (5 tests)
npm run test:pg:catalog # catalog functional suite on embedded PG (18 tests)
npm run test:pg:orders  # orders/checkout suite on embedded PG (22 tests)
```

## Verified behavior on PostgreSQL (this phase)

Requirement → test mapping (all under `test/orders.test.js` on PG):

1. Authenticated checkout succeeds with valid test data — *checkout recomputes prices from the live DB and snapshots totals/tax/address*.
2. Unauthenticated checkout is rejected — *checkout requires authentication (401 without a token)* (new).
3. Invalid addresses and order payloads are rejected — *address validation rejects bad pincode/phone and missing fields*, *checkout validates address/idempotency key and rejects an empty cart*.
4. Insufficient stock prevents order creation — *insufficient stock at checkout is reported as a conflict and changes nothing*.
5. Stock is decremented after a successful order — *idempotent replay: same key returns the same order, stock decremented once*.
6. Transaction failure rolls back all related writes — *a lost stock race rolls back the entire losing checkout (no partial decrement)*.
7. Repeated idempotency keys never duplicate orders or double-decrement — *idempotent replay* + *concurrent duplicate checkout creates exactly one order*.
8. Users cannot access another user's orders or addresses — *orders are owner-restricted* + the three address scoping tests.
9. Admin order listing and details work — *admin list exposes every buyer's orders…*, *admin order endpoints fail closed…*.
10. Valid and invalid status transitions — *valid status transitions append history; invalid ones are refused* (incl. skipped-step 409 / bogus status 400).
11. Cancellation and restocking per business rules — *cancellation restocks exactly once and blocks re-cancellation* + *concurrent cancellations restock exactly once*.
12. Existing MySQL tests continue to pass — `npm test` (127 pass, 1 dialect-gated skip).

Plus the new PG-only savepoint test (mechanism behind the collision-retry fix)
and the `stockDelta` dialect unit tests.

## Boundaries honored

- Loopback embedded PostgreSQL only; scratch DB `buyoDB_ph2_test` (drop +
  recreate per run via the shared guarded harness).
- `DATABASE_URL` never read; no Supabase connection; real `buyoDB` and the
  local MySQL server untouched.
- MySQL SQL byte-identical where edited (backtick literal rendering, inline
  create path, CLI role grant); PG-only changes are explicit dialect branches.
- PG data dir in OS temp (outside repo/OneDrive), removed after every run —
  verified no stray `postgres.exe`, no 5433/5434 listeners after the runs.

## Known gaps (later phases)

- The order-number collision retry itself is not forceable end-to-end through
  the API (random 6-char suffix; ~1-in-2e9 odds). Its mechanism — savepoint
  rollback, PG error detection (`uq_orders_number` / `orderNumber` in
  fields+message), outer-transaction survival — is covered by the PG-only test;
  the controller wiring is code-reviewed against it.
- Auth/session suites, raw-SQL tooling and `migrations.test.js` remain
  MySQL-only until their phases.
- The documented `Categories.name` PG gap (functional `LOWER(name)` unique
  index) is still deferred to the schema-migration phase.
- SMTP, live payments and production behavior were NOT tested (JSON mail
  dry-run only, COD only).
