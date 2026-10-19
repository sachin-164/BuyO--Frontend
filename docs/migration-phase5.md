# Migration Phase 5 — Security Suite on PostgreSQL

**Status:** implemented (Vercel + Supabase migration, phase 5 of the audit plan;
builds on [migration-phase1.md](migration-phase1.md) …
[migration-phase4.md](migration-phase4.md))

## Goal

Port `test/security.test.js` (headers, CORS allowlist, admin authorization,
upload hardening, validation, safe errors, rate-limit mechanism, config
hardening unit tests) to the isolated embedded-PostgreSQL harness without
weakening a single assertion.

## What changed

| File | Change |
| --- | --- |
| `backend/test/security.test.js` | One dialect branch in *DB-backed admin role grants/revokes API access*: on PG the test changes the same `Users.role` column through the model and returns the equivalent `{ changed, before }` result (same pattern as orders Phase 3). MySQL keeps the byte-identical `applyRoleChange` CLI call. **All assertions unchanged on both dialects.** |
| `backend/package.json` | New script `test:pg:security`. |
| `docs/migration-phase5.md` | This file. |

**No application code changes.** The initial as-is PG run proved 19/20 tests
dialect-neutral; the single failure was MySQL-only tooling, not an app defect.

## Defect found (tooling scope, not application)

Running the suite unmodified on PG failed:

```
Error: No user found with email "user.1792387552964.3@buyotest.local"
  at applyRoleChange (scripts/admin-role.js:54)
```

`applyRoleChange` is raw-mysql2: on a PG run it hit the scratch *MySQL* DB,
where the PG-created fixture user does not exist (Phase 3's orders suite hit
the same class — there it silently updated the wrong DB instead of throwing).
The audited CLI stays MySQL-only by the Phase 2 decision (tooling not
migrated); the test now branches exactly like `helpers.createAdminUser` and
`orders.test.js` already do. Role writes target only the disposable
`buyoDB_ph2_test` (MySQL branch) or the PG scratch DB (model branch).

## How to run

```bash
npm test                 # full MySQL suite (scratch MySQL)
npm run test:pg          # PG smoke (5)
npm run test:pg:catalog  # catalog (18)
npm run test:pg:orders   # orders/checkout (22)
npm run test:pg:auth     # auth (16)
npm run test:pg:cart     # cart+wishlist (15)
npm run test:pg:security # security (20)
```

## Coverage — what the suite actually verifies (on PG, 20/20)

- Authn/authz failures: 401 anonymous / 403 non-admin on `POST /api/products`.
- Admin-only + fail-closed: DB role grant→201, revoke→403 immediately
  (fresh read per request); signup body `role`/`isAdmin` ignored (always
  `customer`); `no ADMIN_EMAILS` reliance.
- Input validation/unsafe rejection: product/login payload 400s, malformed
  JSON 400, oversized body 413, unknown route JSON 404.
- Upload hardening: server-generated `<timestamp>-<16hex>.png` names, path
  traversal ignored, disguised non-image rejected 400 with no file left behind,
  non-image mimetypes dropped, product still created.
- Headers/CORS/rate limiting: helmet headers, `x-powered-by` off, allowlisted
  origin echo + preflight, evil origin blocked, standalone limiter
  200/200/200/429.
- Error handling: safe 400/404 JSON, no internals leaked in the tested paths.
- Config hardening (unit): TRUST_PROXY trust-all refused, production CORS
  excludes localhost, TLS verification defaults ON.

### Missing coverage (reported, not invented)

- Expired/malformed JWT tests live in `auth.test.js` (covered on PG there),
  not in this suite.
- Ownership/scoping (404 isolation) lives in cart/orders suites (covered on PG).
- No test exercises a real 500 to assert stack traces never reach clients;
  no end-to-end 429 on the real auth routes (mechanism test only, limits raised
  by the harness); no CSRF-specific suite (API is bearer-token, cookie-less).

## Boundaries honored

- Embedded PG only, loopback; scratch DB `buyoDB_ph2_test` drop+recreate;
  `DATABASE_URL` never read; no Supabase; real `buyoDB` untouched; local MySQL
  (PID 5564) untouched.
- Post-run checks (all runs): no `postgres.exe`, no 5433/5434 listeners,
  temp dirs removed; clean working tree before commit.

## Known risks / not verified

- SMTP/live payments/production behavior not tested (JSON mail dry-run, COD).
- Raw-SQL tooling and `migrations.test.js` remain MySQL-only (tooling phase).
- Outstanding schema requirements unchanged (Phase 4 doc): composite unique
  indexes on Cart/Wishlist, `LOWER(Users.email)`, `LOWER(Categories.name)`.
