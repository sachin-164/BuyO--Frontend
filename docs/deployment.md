# BuyO — Release & Deployment Plan (Phase 12)

Status: **PLAN ONLY — nothing has been pushed, created, migrated or deployed.**
This document describes how to release the existing architecture (static frontend +
Node/Express API + MySQL/Sequelize + local product-image uploads) without changing
application behaviour. Every step that touches a hosted resource requires explicit
approval first.

Cost figures are indicative (knowledge cutoff early 2026) — **verify current pricing
on the provider's page before committing**.

---

## 1. Architecture to deploy (unchanged)

```
[Static frontend]  plain HTML/CSS/JS, no build step (20 pages, js/, css/, assets/)
        |  fetches CONFIG.API_URL (js/config.js — single place to change)
        v
[Node/Express API]  backend/  (npm start -> server.js; helmet, CORS, rate limits)
        |                        |  writes/reads  backend/uploads/ (product images)
        v                        v
[Managed MySQL]            [Persistent disk mounted at backend/uploads]
```

- Frontend and API may live on separate hosts (CORS already supports this via
  `FRONTEND_URL` + `CORS_ALLOWED_ORIGINS`) or on one origin (simplest).
- `backend/package-lock.json` is committed → reproducible installs (`npm ci`).

## 2. Hosting options compared (indicative pricing — verify!)

| Option | Frontend | API | Uploads | MySQL | Est. monthly |
|---|---|---|---|---|---|
| **A. Railway (recommended for least ops)** | Static service or same service | Web service | Volume mount | Built-in MySQL add-on | ~$5–20 total (usage-based; $5 credit covers a small start) |
| **B. Render + external MySQL** | Static site (free/cheap) | Web service starter | Render Disk (persistent) | **Render has no managed MySQL** — use Aiven / DigitalOcean / AWS RDS | ~$7 + disk + DB (~$15+) |
| **C. Fly.io + external MySQL** | Fly app or static | Fly VM | Fly Volume | External only (Fly's managed DB is Postgres) | ~$5–15 + DB |
| **D. Single VPS (Hetzner/DO)** | nginx on same box | Node via systemd | Local disk | Self-hosted mysqld | ~$5–12 predictable; most ops work |
| Frontend-only hosts | Netlify / Vercel / GitHub Pages (free tiers) serve the frontend as-is | — | — | — | $0 |

Notes:
- **Option A** fits this stack best today: MySQL is first-class, volumes exist for
  `backend/uploads`, HTTPS and domains are handled, and the repo deploys as two services.
- **Option D** is cheapest/predictable and keeps the SSH-tunnel procedures in §5–§8
  natural, but you own OS/DB patching and backups.
- The in-memory rate limiter assumes **one API instance**. Multi-instance needs a
  shared store (Redis) — deferred, not required for launch.
- Idempotency, stock and cart correctness are DB-level (row locks) and are
  multi-instance safe; only rate limiting is per-instance.

## 3. Environment variables (names only — never commit values)

Set in the platform's secret manager (or `.env` on a VPS). Never in git.

| Name | Where | Purpose / notes |
|---|---|---|
| `NODE_ENV` | API | `production` in prod |
| `PORT` | API | Platform usually injects its own; app honours it |
| `JWT_SECRET` | API | ≥32 chars random hex. Rotating it logs everyone out |
| `MYSQL_HOST` `MYSQL_PORT` `MYSQL_DB` `MYSQL_USER` `MYSQL_PASS` | API + scripts | Primary DB settings (Railway-style fallbacks `MYSQLHOST` etc. are auto-accepted) |
| `MYSQL_SSL` | API + scripts | `true` for hosted DBs |
| `MYSQL_SSL_REJECT_UNAUTHORIZED` | API + scripts | Leave **unset** in production (verification stays ON) |
| `TRUST_PROXY` | API | Set `1` on Railway/Render/Fly (they terminate TLS at a proxy). Leave unset on a VPS serving directly |
| `FRONTEND_URL` | API | Production storefront origin (no trailing slash) — verification/reset email links |
| `BACKEND_URL` | API | Production API origin — verification redirect target |
| `CORS_ALLOWED_ORIGINS` | API | Extra origins only if frontend != `FRONTEND_URL` origin |
| `EMAIL_USER` `EMAIL_PASS` | API | SMTP account + App Password (see §6) |
| `RATE_LIMIT_*` `RESET_TOKEN_TTL` | API | Optional overrides; defaults are fine |
| `DB_MIGRATE_ALLOWED_DATABASES` etc. | Local tooling only | Used by the guarded local scripts (§5, §8) — not set on the platform |

Ignored / no-op (do not set): `ADMIN_EMAILS` (removed in P11), `MAIL_TRANSPORT=json|fail`
(test-only behaviours), `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY` / `DATABASE_URL`
(see §9).

Frontend: `js/config.js` → `CONFIG.API_URL` must point at the production API
(`https://api.<your-domain>/api`). One line, one file.

## 4. First deployment sequence (high level — needs your approval at each *)

1. Create the platform project + MySQL instance. *
2. Set the §3 variables; upload `backend/uploads/` as an empty persistent dir/volume. *
3. Apply migrations **from your machine through an SSH tunnel** (§5) — no remote
   migration ever runs unattended. *
4. Deploy backend (`npm ci && npm start`). Deploy frontend (static upload or repo
   service); `CONFIG.API_URL` points at it. *
5. Provision the first verified admin (§5), then run the §10 smoke test.

## 5. Guarded remote operations — the SSH-tunnel pattern

Every DB-touching script (`db:migrate`, `db:backup`, `db:restore`, `admin:role`)
refuses non-loopback hosts, `NODE_ENV=production` and missing `--confirm-local`.
That is deliberate. The sanctioned way to operate on a hosted DB **without weakening
the guards** is to make it look local:

```bash
# 1) Tunnel the hosted DB to localhost (example; adjust to your provider)
ssh -N -L 3306:<db-host>:3306 user@bastion      # or provider CLI equivalent

# 2) Run the guarded script from your machine, pointed at localhost
MYSQL_HOST=127.0.0.1 MYSQL_PORT=3306 MYSQL_DB=<prod-db> MYSQL_USER=... MYSQL_PASS=... \
  NODE_ENV= \   # must NOT be "production" in the tooling shell
  npm run db:migrate -- --confirm-local
```

- DB name must be listed in the matching allowlist env var.
- Result: schema changes are explicit, local, reviewed commands — identical to dev.
- **Admin provisioning:** `npm run admin:role -- --email you@example.com --role admin --confirm-local`
  through the same tunnel, then log in once, verify the account, and confirm the
  admin badge. Details + revocation: `docs/admin-provisioning.md`.

## 6. SMTP without exposing credentials

1. **Dry-run first (no credentials at all):** `MAIL_TRANSPORT=json` captures every
   message into an in-memory outbox instead of sending. Start the API locally with
   your production-like settings + `MAIL_TRANSPORT=json`, trigger signup/forgot-
   password, and inspect the captured links (they will use your real
   `FRONTEND_URL`/`BACKEND_URL`). Never printed to logs by the app; only visible to
   the process owner.
2. **First real send:** use a dedicated Gmail account with a **16-char App
   Password** (`EMAIL_USER`/`EMAIL_PASS`) — never your login password. Send one
   verification + one reset email to yourself.
3. Later: a transactional provider (Resend/SendGrid/Mailgun) requires a small
   `utils/mailer.js` change (service → host/port/auth). Deferred; tracked in §11.
4. Never commit `.env`; on platforms use the secret manager. `backend/.env` is
   git-ignored and the secret scan is part of the release checklist (§10).

## 7. Persistent uploads (`backend/uploads/`)

- Local disk today, served by the API at `/uploads/*` (rate-limited, allowlisted
  file types, magic-byte verified).
- **On Railway/Render/Fly: attach a persistent volume/disk at `backend/uploads`.**
  Without it, every redeploy **loses all product images** (DB rows keep the paths →
  broken images). This is a launch blocker if you have real uploads.
- Object storage (S3/R2/Cloudinary) is the scalable end-state but needs a code
  change (upload target + URL prefix) — deferred with §11.
- Include the volume in your backup story: `db:backup` covers paths, not files.
  A periodic `tar` of the uploads dir into the same offsite location as DB backups
  is the cheap baseline.

## 8. Backups & restore drills (production)

1. **Provider snapshots:** enable the managed DB's automated backups/PITR where
   offered. This is the primary recovery path.
2. **Logical backup (our format):** schedule `npm run db:backup` weekly from a
   trusted machine through the §5 tunnel (it refuses remote hosts unless
   `--allow-remote` — prefer the tunnel). Copy the JSON out of `backend/backups/`
   to offsite storage together with the uploads `tar`.
3. **Restore drill (quarterly):** through the tunnel, restore the newest backup
   into a **scratch** database (`buyoDB_restore_check` — the script refuses to
   overwrite anything existing and verifies every row count), spot-check a few
   rows, then drop it. Full manual: `docs/backup-restore.md`.
4. Retention suggestion: 4 weekly + 1 monthly logical backups, 30 days provider PITR.

## 9. Unused Supabase / database variable names — review only

The local `backend/.env` contains three names that **no code reads** (verified by
grep across the backend: zero references; config loading only reads `MYSQL_*` /
Railway-style fallbacks):

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `DATABASE_URL`

They are inert with this architecture. **Not deleted, not rotated by the assistant.**
Recommended (your call): remove them from `.env` to shrink the secret surface, and if
those keys were ever real, rotate them in the Supabase dashboard.

## 10. Production smoke-test checklist (run after any deploy)

- [ ] `GET /api/health`-equivalent: API boots, logs `✅ MySQL Connected`, no config warnings
- [ ] Home + Products pages load real catalog data over HTTPS (no console errors)
- [ ] Signup → verification email arrives → link verifies → login works
- [ ] Add to cart → checkout (COD) → order appears in **customer** history with totals+GST
- [ ] Admin login → dashboard counts correct (distinct order count!) → order transitions work
- [ ] Product image upload → served back at `/uploads/...` → survives a redeploy (volume test)
- [ ] Password reset email → token works once → old session invalidated → old token rejected
- [ ] Anonymous/admin/customer authorization matrix: 401/403/404 as designed (no leaks)
- [ ] `curl` an admin route with a customer token → 403; tampered JWT → 401
- [ ] Rate limiting responds (auth: 429 after the configured burst)
- [ ] Backup taken through tunnel; restore-into-scratch drill passes row counts
- [ ] `.env` absent from git (`git ls-files backend/.env` → empty); secret scan clean

## 11. Known blockers & deferred items

**Blockers before a real-money launch:**
1. Real SMTP account + App Password (§6) — signup currently cannot verify users without it.
2. Persistent uploads volume (§7) if product images matter at launch.
3. First admin provisioned through the tunnel (§5).
4. Domain + HTTPS + `FRONTEND_URL`/`BACKEND_URL`/`CORS_ALLOWED_ORIGINS` set correctly.
5. `CONFIG.API_URL` updated to the production API and the frontend re-uploaded.

**Deferred (documented, intentionally not in this release):**
- Transactional email provider integration (mailer.js change).
- Object storage for uploads.
- Redis-backed rate limiting for multi-instance.
- Resend-verification endpoint; cart/wishlist composite unique index; bcrypt cost
  bump; nodemon as a devDependency (`npm run dev` needs it installed locally —
  production `npm start` does not).
- `uuid` npm-audit moderates (unreachable path in Sequelize usage; the suggested
  "fix" is a breaking downgrade).
