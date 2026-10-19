# BuyO — Environment Variable Inventory & Credential Rotation (Phase 8)

**Names and purposes only — this document never contains secret values.**
Values belong in `backend/.env` locally (git-ignored) and in the platform's
secret manager in production (Vercel Environment Variables). Verified rule:
`git ls-files .env backend/.env backend/.env.*` must print nothing.

Related: `docs/deployment.md` (where each is set at deploy), `backend/.env.example`
(template with placeholders).

## 1. API — read by the application (backend/)

| Name | Purpose | Required in production | Notes |
|---|---|---|---|
| `NODE_ENV` | `production` enables production behavior (CORS local-origin exclusion, config warnings, guard refusals) | **Yes** | Tests force `test` |
| `PORT` | Listen port for the long-running server (`server.js`) | No | Local dev default 5000; Vercel ignores it (serverless owns the lifecycle) |
| `JWT_SECRET` | Signs/verifies all bearer tokens (access, verify, reset) | **Yes** — ≥32 random chars | **Rotate before production** — see §4. Startup warns if short |
| `DB_DIALECT` | `mysql` (default, unset) or `postgres` | Yes for cutover: `postgres` | Anything else refuses to start |
| `PG_HOST` `PG_PORT` `PG_DB` `PG_USER` `PG_PASS` | PostgreSQL connection (`DB_DIALECT=postgres` only) | **Yes** at cutover | Read instead of `MYSQL_*`; `DATABASE_URL` is deliberately never read |
| `MYSQL_HOST` `MYSQL_PORT` `MYSQL_DB` `MYSQL_USER` `MYSQL_PASS` | MySQL connection (default dialect) | Until cutover completes | Railway-style fallbacks auto-accepted: `MYSQLHOST` `MYSQLPORT` `MYSQLDATABASE` `MYSQLUSER` `MYSQLPASSWORD`; also `DB_HOST`-style generic fallbacks |
| `MYSQL_SSL` | Enable TLS for hosted MySQL | Hosted MySQL only | Verification is ON by default |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | Disable TLS verification (self-signed local certs) | **Never in production** | Opt-in local exception only |
| `TRUST_PROXY` | Reverse-proxy hop trust so rate limits see real client IPs | **Yes on Vercel** (`1`) | Trust-all (`true`) is refused at startup |
| `FRONTEND_URL` | Storefront origin for reset links + CORS allowlist | **Yes** | No trailing slash |
| `BACKEND_URL` | API origin for verification links | **Yes** | No trailing slash |
| `CORS_ALLOWED_ORIGINS` | Extra comma-separated origins | Only if split-origin | Local dev origins are auto-allowed except in production |
| `EMAIL_USER` `EMAIL_PASS` | SMTP account + 16-char App Password | Yes (or see next row) | Dedicated mailbox, never a login password |
| `MAIL_TRANSPORT` | `json` = capture-only dry run; `fail` = forced failure | **No** (test-only) | `json` is the recommended no-credentials first verification |
| `RESET_TOKEN_TTL` | Password-reset token lifetime | No | Default `30m` |
| `RATE_LIMIT_GLOBAL_WINDOW_MS` `RATE_LIMIT_GLOBAL_MAX` `RATE_LIMIT_AUTH_WINDOW_MS` `RATE_LIMIT_AUTH_MAX` | Rate-limit tuning | No | Defaults 15 min / 300 and 15 min / 15 |
| `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` | Supabase Storage (planned, `docs/storage-supabase.md`) | At the Storage cutover | **No code reads them today**; service-role key is server-side only |

## 2. Local tooling only (scripts/) — never set on a platform

| Name | Purpose | Default |
|---|---|---|
| `DB_SYNC_ALLOWED_DATABASES` | `db:sync` target allowlist | `buyoDB`, `buyoDB_ph1_verify` |
| `DB_MIGRATE_ALLOWED_DATABASES` | `db:migrate` targets | `buyoDB` |
| `DB_ADMIN_ALLOWED_DATABASES` | `admin:role` targets | `buyoDB` |
| `DB_RESTORE_ALLOWED_DATABASES` | extra `db:restore` targets | scratch names `buyoDB_*` work by default |
| `DB_TEST_USER_ALLOWED_DATABASES` | `test:user` targets | `buyoDB` |
| `TEST_USER_EMAIL` `TEST_USER_PASSWORD` | `test:user` CLI inputs | — |

All guarded scripts additionally refuse: non-loopback hosts, `NODE_ENV=production`,
and a missing `--confirm-local`. This matrix is unchanged by Phase 8.

## 3. Test-only knobs (backend/test/)

`PG_TESTS`, `PG_SMOKE_PORT` (5433), `PG_SUITE_PORT` (5434), `PG_HOST`/`PG_PORT`/
`PG_DB`/`PG_USER`/`PG_PASS` re-pointed at the scratch cluster, plus the
harness's own overrides (`NODE_ENV=test`, high rate limits, scratch DB names).
None of these belong in production.

## 4. Frontend configuration (not environment variables)

`js/config.js` resolves `CONFIG.API_URL`: `window.BUYO_API_URL` override →
local hosts keep `http://localhost:5000/api` → any other host uses
same-origin `/api` (never localhost). To inject an override on a static host,
place `<script>window.BUYO_API_URL = "…";</script>` before `js/config.js`, or
have the platform inject it. Details: `docs/deployment.md` §5.

## 5. Credential rotation checklist (before production)

**Hard rule: rotating never prints, logs or commits a value — generate new
ones on your machine / in the provider's dashboard and enter them only into
the local `.env` and the platform secret manager.**

1. **`JWT_SECRET` — MUST rotate.** A `JWT_SECRET` was committed in the repo's
   early history (old commit `962a229`, reachable on GitHub from the original
   `main` history). Anyone who ever fetched that history knows it. Removing a
   secret from *current* files does **not** remove it from git history; the
   mitigation is rotation, not archaeology.
   - [ ] Generate ≥32 random chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - [ ] Update Vercel + local `.env`; deploy/restart.
   - [ ] Effect: every issued token becomes invalid — all users log in once
         again (acceptable now; the P11 change already forces one re-login).
   - [ ] Never reuse the old value anywhere.
2. **Legacy `MONGO_URI` — rotate/close if the service still exists.** Same
   old commit leaked a MongoDB connection string. If any Mongo instance is
   still provisioned with those credentials, rotate the password or delete
   the instance. The Node app has not used Mongo since the Sequelize rewrite.
3. **Legacy `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in the local
   `backend/.env`** — inert (no code reads them), but they are live-shaped
   secrets in a file on disk:
   - [ ] Decide: delete them from `.env` (recommended until the Storage phase)
         or — if they were ever real — rotate them in the Supabase dashboard.
4. **SMTP app password** — if a real one was ever created for tests, rotate it
   or confirm it never existed (the suite only uses the JSON dry-run transport).
5. **History rewrite is deliberately NOT part of any plan.** Rewriting git
   history would require force-pushing and touching the protected `main`
   branch — explicitly out of scope and blocked by policy. Rotation (items 1–2)
   fully neutralizes the leaked values.
6. **Verification (no values printed):**
   - [ ] `git ls-files .env backend/.env backend/.env.*` → empty
   - [ ] `git log --all --oneline -- backend/.env` → only "add .env.example"-style
         paths if anything; the real `.env` was never tracked
   - [ ] New `JWT_SECRET` differs from the old one (compare lengths only,
         never print either)
   - [ ] App logs contain no secret material after deploy (grep the function
         logs for `SECRET`, `PASS`, `KEY` — expect only variable *names*)

## 6. What Phase 8 did NOT do

- Did not rotate anything, did not print any value, did not connect to any
  remote service, did not change Vercel or Supabase settings.
- Did not delete the inert `SUPABASE_*`/`DATABASE_URL` entries from anyone's
  local `.env` — that is the user's machine; the recommendation is item 5.3.
