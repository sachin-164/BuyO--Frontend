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
| `PG_HOST` `PG_PORT` `PG_DB` `PG_USER` `PG_PASS` | PostgreSQL connection (`DB_DIALECT=postgres` only) | **Yes** at cutover | Read instead of `MYSQL_*`; they always win over `DATABASE_URL`, which (approved Supabase phase) only fills fields they leave unset — never read on the MySQL path, and it never flips the dialect on its own |
| `PG_SSL` | TLS for PostgreSQL. Unset = automatic (TLS for non-loopback hosts, plaintext loopback); `true`/`false` force a mode | Unset is fine (auto); explicit `true` also fine | **Verification is always on — no opt-out exists.** Invalid values refuse to start. Connect by hostname so certificate names match (Phase 9) |
| `DB_POOL_MAX` `DB_POOL_MIN` `DB_POOL_IDLE_MS` `DB_POOL_ACQUIRE_MS` | Small serverless Sequelize pool (PG path only; MySQL keeps defaults) | No | Defaults 2 / 0 / 10000 / 30000; strictly validated, invalid values refuse to start (Phase 9) |
| `HEALTH_DB_TIMEOUT_MS` | Timeout for the `/api/health/ready` database probe | No | Default 2000, range 100–30000 (Phase 9) |
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
| `STORAGE_DRIVER` | `local` (default off-hosted; existing `/uploads` disk) or `supabase` (direct-to-storage uploads) | **Yes at the Storage cutover** | Hosted envs (`VERCEL` or `NODE_ENV=production`) refuse to run without it — no silent ephemeral-disk fallback (Phase 12) |
| `SUPABASE_URL` `SUPABASE_SERVICE_ROLE_KEY` | Supabase project URL + service-role key for Storage | With `STORAGE_DRIVER=supabase` | Read **only** when the supabase driver is selected; service-role key is server-side only, never in frontend code or responses (Phase 12) |
| `SUPABASE_STORAGE_BUCKET` | Storage bucket name | No | Default `product-images` |
| `MAX_IMAGE_BYTES` | Image size cap (multer limit + upload authorization) | No | Default 5 MB, clamp 1 KB–25 MB (Phase 12) |
| `UPLOAD_AUTH_TTL_MS` | Lifetime of a single-use upload authorization | No | Default 10 min, clamp 1 s–1 h (Phase 12) |

## 2. Local tooling only (scripts/) — never set on a platform

| Name | Purpose | Default |
|---|---|---|
| `DB_SYNC_ALLOWED_DATABASES` | `db:sync` target allowlist | `buyoDB`, `buyoDB_ph1_verify` |
| `DB_MIGRATE_ALLOWED_DATABASES` | `db:migrate` targets | `buyoDB` |
| `DB_ADMIN_ALLOWED_DATABASES` | `admin:role` targets | `buyoDB` |
| `DB_RESTORE_ALLOWED_DATABASES` | extra `db:restore` targets | scratch names `buyoDB_*` work by default |
| `DB_TEST_USER_ALLOWED_DATABASES` | `test:user` targets | `buyoDB` |
| `PG_REMOTE_MIGRATION_APPROVED` | Remote approval token (must equal `phase-cutover-approval`); enforced by the CLI tools since Phase 10 | **unset = remote execution disabled** (runbook: `docs/migration-remote.md`) |
| `PG_REMOTE_ALLOWED_HOSTS` `PG_REMOTE_ALLOWED_DATABASES` | Exact `host:port` / database allowlists for the remote gate (`db:migrate`, `admin:role`, `db:backup`+`--allow-remote`, `db-restore`) | empty = nothing approved |
| `STORAGE_MIGRATION_APPROVED` | Storage-migration approval token (must equal `phase-cutover-approval`); required by `migrate:storage --apply` in addition to `--confirm-remote` + `--bucket` | **unset = apply disabled** (`docs/storage-supabase.md` §6) |
| `STORAGE_MIGRATE_ALLOWED_DATABASES` | `migrate:storage` source-database allowlist | `buyoDB_ph12_storage` |
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

1. **`JWT_SECRET` — MUST rotate before production.** A `JWT_SECRET` was
   committed in the repo's early history (old commit `962a229`, reachable on
   GitHub from the original `main` history). Anyone who ever fetched that
   history knows it. Removing a secret from *current* files does **not** remove
   it from git history; the mitigation is rotation, not archaeology.
   - [ ] Generate ≥32 random chars (`node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`).
   - [ ] In Vercel: Project → Settings → Environment Variables → `JWT_SECRET`
         → Edit/Create. Scope it to **Production only** (do not expose it to
         Preview/Development unless those environments are trusted to mint
         production-compatible tokens). Enable **Sensitive** when the plan
         supports it (write-only after save; cannot be revealed again).
   - [ ] Update local `backend/.env` with a different development secret (never
         reuse the production value locally).
   - [ ] Redeploy production (environment changes only apply to a new
         deployment).
   - [ ] **Session impact:** every issued access/verify/reset token becomes
         invalid immediately after the new deployment. Signed-in users are
         logged out once and must sign in again; outstanding verification and
         password-reset links must be re-requested. Communicate this before the
         release window.
   - [ ] Never reuse the old value anywhere. Compare lengths/fingerprints only;
         never print either value.
2. **Legacy `MONGO_URI` — rotate/close if the service still exists.** Same
   old commit leaked a MongoDB connection string. If any Mongo instance is
   still provisioned with those credentials, rotate the password or delete
   the instance. The Node app has not used Mongo since the Sequelize rewrite.
3. **Legacy `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` in the local
   `backend/.env`** — inert (no code reads them) until the Storage driver is selected — as of Phase 12 the backend DOES read them when `STORAGE_DRIVER=supabase` (and only then; the default remains local disk) — so they are still live-shaped
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

### 5.1 Production Supabase database password rotation (owner-approved change)

**Do not run this during an unapproved release.** It immediately invalidates the
old password and causes a short connection-failure window until Vercel redeploys
with the new value. Take a verified backup first (`docs/backup-restore.md`).

1. **Rotate in Supabase:** Dashboard → project → Project Settings → Database →
   **Reset database password** (the label may be “Reset database password” or
   “Database password → Reset”). Generate a strong password in a password
   manager; do not paste it into chat, a ticket, shell history or this repo.
2. **Update Vercel (production runtime):** Project → Settings → Environment
   Variables → `DATABASE_URL` → Edit. Paste the new connection string (or only
   the password inside the existing pooled/session string, depending on how the
   variable is stored). Scope it to **Production**; add **Preview** only if that
   environment is intentionally allowed to reach production data. Save.
   - Keep the existing pooler host/port/database/user and any required query
     parameters (`sslmode`, `pgbouncer`, `connection_limit`) — change only the
     credential part.
   - If production uses individual `PG_PASS` instead of `DATABASE_URL`, update
     `PG_PASS`; `PG_*` **wins** over `DATABASE_URL` when both are set.
3. **Update local `backend/.env`:** set `PG_PASS` (and `DATABASE_URL` if it is
   the field in use) to the new value. Restart any local backend/Vite process.
   Never commit the file.
4. **Redeploy production** (Vercel → Deployments → Redeploy, or push the
   approved commit). Environment changes are not applied to an existing
   deployment. Wait for the new deployment to become Ready.
5. **Verify the new password:**
   - `GET /api/health/ready` returns 200 with a database check.
   - Signup/login and one catalog read succeed against the alias.
   - Connect once with `psql` using the Supabase **Session pooler** host shown
     under Dashboard → Connect; enter the new password at the prompt and run
     `select 1;`.
6. **Verify the old password is dead:** in a separate shell, run the same
   `psql` command against the same host/user and enter the **old** password at
   the prompt. Expect `password authentication failed`. Do not put either
   password in the command line, a script, or shell history; use the prompt.
7. Record only the rotation timestamp and the verification result — never the
   password or connection string.

### 5.2 `TRUST_PROXY=1` on Vercel — verifying per-client rate limiting

Without `TRUST_PROXY`, Express ignores `X-Forwarded-For` and every request can
look like it came from one proxy address; global/auth limiters then share a
bucket and can 429 unrelated users. `TRUST_PROXY=1` trusts exactly one hop
(Vercel's edge). `TRUST_PROXY=true` is refused by startup — never use it.

1. Set `TRUST_PROXY=1` in Vercel → Environment Variables (Production), then
   redeploy. Do **not** set it locally unless a local reverse proxy is actually
   in front of Express.
2. Confirm the previous validation warning
   (`ERR_ERL_UNEXPECTED_X_FORWARDED_FOR`) is absent from runtime logs after the
   first requests.
3. Verify client separation with two real client networks, not a spoofed header:
   e.g. a laptop on Wi-Fi and a phone on cellular. Send the auth limiter's
   budget (default 15 failed logins / 15 min) from client A, then one failed
   login from client B. Only client A should receive `429`; client B must still
   get a normal `401`. Repeat in the reverse order if needed.
4. Do not send hand-crafted `X-Forwarded-For` values from a browser to “test”
   this — the edge owns that header, and trusting arbitrary client-supplied
   values is exactly the vulnerability this setting avoids. If your plan adds
   another proxy hop, adjust the hop count deliberately and re-run step 3.

### 5.3 Backup handling — no plaintext PII in a cloud-sync folder

`db:backup` dumps contain emails, addresses, order history and bcrypt password
hashes. `backend/backups/` is git-ignored, but a repo checkout inside OneDrive,
Dropbox, iCloud Drive, Google Drive or SharePoint is **not** access-controlled
like a secret store: the sync client copies the dump to a third party and often
to every signed-in device. `db:backup` now prints a warning when it detects such
a path. Treat that warning as a failure.

- Keep the canonical copy in encrypted, access-restricted storage (an encrypted
  disk/volume or a private bucket with server-side encryption, versioning and a
  narrow IAM policy). Encrypt before it leaves the machine if the destination is
  not itself encrypted at rest (e.g. `age`/`gpg`/7-Zip AES-256).
- Delete the plaintext local copy after the encrypted copy is verified; empty
  the sync provider's trash/version history too (deleting a file does not
  revoke copies already synced).
- Restrict who can read backups to the minimum owner/operator set, record
  retention and test a restore from the encrypted copy at least once before
  relying on it.
- Never attach a dump to a ticket/chat, never commit it, and never place it on a
  public static host. The earlier `backend/backups/buyo-backup-*.json` drill file
  must not remain in the OneDrive-synced working tree.

## 6. What Phase 8 did NOT do

- Did not rotate anything, did not print any value, did not connect to any
  remote service, did not change Vercel or Supabase settings.
- Did not delete the inert `SUPABASE_*`/`DATABASE_URL` entries from anyone's
  local `.env` — that is the user's machine; the recommendation is §5 item 3.
