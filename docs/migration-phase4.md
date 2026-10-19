# Migration Phase 4 — Authentication, Cart and Wishlist on PostgreSQL

**Status:** implemented (Vercel + Supabase migration, phase 4 of the audit plan;
builds on [migration-phase1.md](migration-phase1.md),
[migration-phase2.md](migration-phase2.md) and
[migration-phase3.md](migration-phase3.md))

## Goal

Run the existing `test/auth.test.js` (signup, email verification, login, JWT,
password reset) and `test/cartWishlist.test.js` (cart CRUD/dedup/stock/tax
preview, wishlist idempotency/toggle/isolation) suites against the local
embedded-PostgreSQL scratch DB, and close the dialect-sensitive coverage gaps
found during inspection.

## What changed

| File | Change |
| --- | --- |
| `backend/test/auth.test.js` | New test: **email case normalisation** — a differently-cased duplicate signup must 400 and a differently-cased login must 200. Validation lowercases every email, which is what makes uniqueness/login identical on MySQL (ci collation) and PostgreSQL (case-sensitive unique index). |
| `backend/test/cartWishlist.test.js` | New test: **concurrent duplicate cart adds** — two racing adds serialize on the user-row lock into exactly one line with the summed qty (the dedup mechanism has no unique index; this proves the row-lock discipline on PG). |
| `backend/package.json` | New scripts `test:pg:auth` and `test:pg:cart`. |
| `docs/migration-phase4.md` | This file. |

**No controller/model/middleware code changes were required** — after Phases
1–3, the auth/cart/wishlist path contains only dialect-neutral code (Sequelize
model ops, `SELECT ... FOR UPDATE` user-row locks, JWT, bcrypt, `Number()`
decimal conversions), which the PG runs verified end-to-end.

Not migrated (out of scope, unchanged): `security.test.js`,
`migrations.test.js`, raw-SQL tooling, rate-limiter store.

## How to run

```bash
npm test                # full MySQL suite + dialect unit tests (scratch MySQL)
npm run test:pg         # PG connectivity/schema smoke (5 tests)
npm run test:pg:catalog # catalog suite on embedded PG (18 tests)
npm run test:pg:orders  # orders/checkout suite on embedded PG (22 tests)
npm run test:pg:auth    # auth suite on embedded PG (16 tests)
npm run test:pg:cart    # cart+wishlist suite on embedded PG (15 tests)
```

## Verified behavior on PostgreSQL (this phase)

Requirement → test mapping (`test/auth.test.js` on PG: 16/16):

- Signup validation and duplicate email — *rejects invalid payloads*, *rejects
  a duplicate email*, plus the new email-case normalisation test.
- Password hashing/verification — *login returns a working access token*,
  *reset full flow* (only a valid bcrypt comparison succeeds; hash never
  returned by `/me`).
- Login success/invalid credentials — *identical generic 401*, *unverified 403
  vs wrong-password 401*.
- JWT creation/verification, expired/invalid tokens — *verify invalid/expired*,
  *`/me` missing/malformed/wrong-purpose/expired*, *reset expired/tampered*.
- Email verification + reset security — *valid token verifies*,
  *reuse → already_verified*, *rollback on mail failure*, *identical
  forgot-password responses*, *single-use reset + stale-session invalidation*,
  *weak password rejected*.
- Role/ENUM — signup writes `role='customer'` (PG enum), `/me` exposes
  `isAdmin: false`; admin RBAC on PG is covered by `test/orders.test.js`
  (*admin endpoints fail closed*, Phase 3).

`test/cartWishlist.test.js` on PG: 15/15 — auth 401s, add/validate/dedup (+
new concurrent-add test), stock limits, per-user isolation (404s), live
pricing/tax previews, wishlist idempotency/toggle/isolation/live data.

## Boundaries honored

- Loopback embedded PostgreSQL only; scratch DB `buyoDB_ph2_test` (drop +
  recreate per run); `DATABASE_URL` never read; no Supabase connection.
- Real `buyoDB` and local MySQL untouched; no schema changes; no validation
  weakened.
- Verified after runs: no stray `postgres.exe`, no 5433/5434 listeners,
  PG temp dirs removed.

## Missing functionality (identified, NOT invented)

- **Guest-to-user cart merge endpoint** does not exist (cart header points to
  the future design in `docs/guest-cart-merge.md`; the client replays adds
  after login). No server merge to test.
- **Resend-verification endpoint** still absent (signup mail failure rolls the
  account back instead — covered by test).

## Outstanding schema requirements (schema phase)

- Composite unique index on `CartItems (UserId, productId)` and
  `WishlistItems (UserId, productId)` — dedup currently enforced
  transactionally by design (Phase 5 deferred schema changes).
- Functional unique index on `LOWER(Users.email)` for DB-level parity with
  MySQL's ci collation — app paths normalise to lowercase already (covered by
  the new test), so this is defence-in-depth only.
- The documented `Categories.name` `LOWER(name)` unique index (Phase 2 gap).

## Known risks / not verified

- `security.test.js` (broader RBAC/HTTP hardening) and `migrations.test.js`
  run on MySQL only; on PG the admin fail-closed path is covered via
  `orders.test.js`.
- Legacy duplicate cart rows self-heal path (merge on next add) has no test on
  either dialect (not dialect-specific).
- SMTP/live payments/production behavior not tested (JSON mail dry-run, COD).
