# BuyO — Deployment Plan (Phases 8–9): Vercel + Supabase

Status: **PREPARATION ONLY — nothing has been deployed, no Vercel/Supabase
project has been touched, no remote database has been contacted.** Every step
that touches a hosted resource is marked with `*APPROVAL*` and requires your
explicit go-ahead in a later, separately-approved phase.

What this phase actually did (all verified locally, see §9):

- audited the repo against a serverless + hosted-Postgres target (§4),
- moved `pg` to production dependencies and proved a clean prod install (§3),
- gave the frontend a safe, tested API-URL resolution (§5),
- added a **candidate** Vercel serverless entry (`api/index.js`) + `vercel.json`
  with real HTTP round-trip tests (§6) — not linked to any Vercel project,
- inventoried every environment variable and the credential-rotation
  checklist (`docs/environment-variables.md`),
- designed the Supabase Storage path without creating anything (`docs/storage-supabase.md`),
- replaced this stale Railway-era document with the real target plan.

Phase 9 (production-readiness code) added, all verified locally:

- PostgreSQL TLS (`PG_SSL`: automatic for non-loopback hosts, certificate
  verification always on, no opt-out) + a small validated serverless pool,
- no database work at module import / serverless cold start (import probe removed),
- `GET /api/health` (liveness) and `GET /api/health/ready` (bounded DB check),
- the tested remote-migration approval contract (`docs/migration-remote.md`) —
  still disabled by default; every script remains loopback-only.

Phase 10 (remote-gate integration) added, all verified locally:

- the approval gate is now ENFORCED: `db:migrate`, `admin:role`, `db-restore`
  and `db:backup` (which additionally keeps `--allow-remote`) refuse any
  non-loopback target BEFORE a connection unless all eight approval
  conditions hold; `db:sync` has no remote path at all (`docs/migration-remote.md` §1),
- TLS threaded through all four CLI `pg` clients (verification always on,
  loopback byte-identical),
- a sandbox-first runbook (`docs/migration-remote.md` §5) — no hosted service
  was contacted and no remote resource exists.

---

## 1. Target architecture

```
[Static frontend]   plain HTML/CSS/JS at repo root — no build step (Vercel static)
        |  CONFIG.API_URL resolved by js/config.js:
        |    production host -> same-origin "/api"  (override: window.BUYO_API_URL)
        v
[Serverless API]    api/app.js -> backend/app.js createApp() (Vercel function; /api/* rewritten to it via vercel.json)
        |                        |  product images: LOCAL DISK today -> Supabase
        v                        v    Storage at cutover (docs/storage-supabase.md)
[Supabase PostgreSQL]   reached via DB_DIALECT=postgres + PG_* settings
                        (app TLS + small pool ready since Phase 9; CLI
                        scripts stay loopback-only — docs/migration-remote.md)
```

- The live production website today is the Vercel deployment of the **`main`**
  branch (old architecture). It does **not** contain `js/config.js`, `api/`,
  or `vercel.json` (verified with `git ls-tree 220bdf0`) — nothing done on
  `master` can affect it until an approved deployment from `master`.
- Frontend and API share one origin in the target design (simplest CORS story:
  none needed); a split-origin deployment stays possible via
  `window.BUYO_API_URL` + `FRONTEND_URL`/`CORS_ALLOWED_ORIGINS`.
- `backend/package-lock.json` is committed → reproducible installs (`npm ci`).

## 2. Environment variables

Names only — values never enter git, logs, or this document. The full
inventory (purpose, required status, where each is configured) and the
credential-rotation checklist live in **`docs/environment-variables.md`**.

Minimum the API needs in production: `NODE_ENV`, `JWT_SECRET` (≥32 chars,
rotated — see checklist), `DB_DIALECT=postgres`, `PG_HOST`/`PG_PORT`/`PG_DB`/
`PG_USER`/`PG_PASS`, `TRUST_PROXY=1` (Vercel terminates TLS at a proxy),
`FRONTEND_URL`, `BACKEND_URL`, `CORS_ALLOWED_ORIGINS` (only if split-origin),
`EMAIL_USER`/`EMAIL_PASS` (or `MAIL_TRANSPORT=json` dry-run first),
plus `SUPABASE_URL` + `SUPABASE_SERVICE_ROLE_KEY` once Storage lands.

Phase 9 additions (all optional — defaults are production-sane): `PG_SSL`
(unset = automatic: TLS with verification for non-loopback hosts, plaintext
for loopback; `true`/`false` force a mode; no verification opt-out exists),
`DB_POOL_MAX`/`DB_POOL_MIN`/`DB_POOL_IDLE_MS`/`DB_POOL_ACQUIRE_MS` (small
serverless pool, PG path only), `HEALTH_DB_TIMEOUT_MS` (readiness probe
bound, default 2000). Full list: `docs/environment-variables.md`.

Frontend: `js/config.js` resolves `CONFIG.API_URL` automatically (§5) — no
variable needed for the same-origin design.

## 3. Production dependency readiness (done)

- `pg` `^8.23.1` moved from `devDependencies` to `dependencies` (same tested
  version); `mysql2` stays until cutover + rollback plan no longer need it;
  `embedded-postgres` and its platform binary stay dev-only.
- Lockfile regenerated with the repo's package manager (npm); diff is exactly
  the `pg` tree losing its `dev` flags.
- Vercel enforces the same strategy: `vercel.json` pins `installCommand` to
  `npm ci --omit=dev`. This keeps the builder's linux/x64 install from ever
  touching the win32-only `@embedded-postgres/windows-x64` package.
- The win32 pin itself is an `optionalDependency` of `backend` (not a hard
  dependency). A non-optional package with `"os": ["win32"]` hard-fails every
  other platform with `EBADPLATFORM` — which is what killed the Vercel builds
  whenever a dev-inclusive `npm install` actually ran (dashboard overrides and
  redeploys did not honor the pinned installCommand). As an optional
  dependency npm skips it with a warning on non-win32 platforms, so `npm
  install` and `npm ci` succeed on Linux regardless of flags, while Windows
  local dev still installs it for the PG test suites.
- Verified with a clean production install: temp dir + `npm ci --omit=dev`
  (exit 0) + `require('pg')` loads (8.23.1) + `embedded-postgres` absent on
  non-win32 installs. Re-run any time:

  ```bash
  cd backend && npm ci --omit=dev && node -e "require('pg'); console.log('pg OK')"
  ```

## 4. Serverless readiness findings (candidate entry exists; blockers remain)

| Area | Status | Detail |
|---|---|---|
| App factory | ✅ ready | `createApp()` (backend/app.js) is listen-free; `server.js` stays the long-running entry for local dev |
| Candidate entry | ✅ deployed (verified live) | `api/app.js` exports the handler; `vercel.json` rewrites `/api/:path*` → `/api/app` (Vercel rewrites deliver the ORIGINAL url to the function and append the unbound capture as `?path=…` — stripped by `restoreApiPrefix`/`stripRewriteParam`). Zero-config sub-path matching was ruled out live: `api/index.js` matched only the exact path, `api/[...path].js` only one segment. `restoreApiPrefix()` normalizes full/stripped/function-name URL deliveries — unit + real-HTTP round-trip tested (`backend/test/deployReadiness.test.js`); boot is read-only-FS tolerant (guarded uploads-dir mkdir) and the dialect drivers (`mysql2`, `pg`) are statically required in `backend/config/db.js` so nft bundles them (sequelize loads them via dynamic require — absent from the bundle, every cold start died; both verified live) |
| Auth statelessness | ✅ ready | Bearer JWT, no cookies/sessions; DB-backed role check per request |
| Idempotency/stock | ✅ ready | DB row locks — multi-instance safe by design |
| Body limits | ✅ ready | JSON 100 kB; 413/400 error paths tested |
| Startup | ✅ ready (Phase 9) | No DB work at module import — the old fire-and-forget probe was removed; `server.js` authenticates explicitly at startup; fail-fast if `JWT_SECRET` missing (desired in prod) |
| Health endpoints | ✅ prepared (Phase 9) | `GET /api/health` = liveness, no DB access; `GET /api/health/ready` = bounded `SELECT 1` (default 2 s via `HEALTH_DB_TIMEOUT_MS`), safe 503 with no internals; both behind the global limiter |
| Rate limiting | ⚠️ limitation | In-memory (per warm instance). Global limits are only reliable with a shared store (Redis/Upstash) — cutover decision, documented, unchanged |
| Image uploads | ❌ blocker B1 | multer writes to `backend/uploads/` — **ephemeral on Vercel** (every deploy/restart loses files). Fix: Supabase Storage (`docs/storage-supabase.md`) |
| Upload size | ❌ blocker B2 | multer allows 5 MB; Vercel request payload cap is ~4.5 MB — the admin upload endpoint cannot accept 5 MB files through a Vercel function. Fix arrives with B1 (smaller cap or client-direct upload) |
| PG TLS | ✅ prepared (Phase 9, app path) | `PG_SSL`: automatic TLS for non-loopback hosts, **verification always on — no opt-out knob exists**; loopback stays plaintext so embedded test clusters need no changes. CLI scripts remain loopback-only; their TLS wiring belongs to the cutover phase (`docs/migration-remote.md`) |
| Connection pooling | ✅ prepared (Phase 9) | Small serverless pool on the PG path: `DB_POOL_MAX` default 2 (1–10), min 0, idle 10 s, acquire 30 s — strictly validated, refuses to boot on typos. MySQL keeps Sequelize's defaults byte-for-byte. At cutover use the Supabase **pooler** (transaction mode) |
| Health endpoint | ⚠️ gap | No `/api/health` route exists (server.js only logs). Optional small addition in the deploy phase for smoke tests |
| Persistent state | ✅ none in-process | Nothing depends on in-memory state across requests except the rate limiter; no writable-path assumptions outside `uploads/` |

**Honest limit:** local HTTP round trips prove the handler logic, not Vercel's
rewrite/path behavior. The path semantics must be confirmed with a preview
deployment in the deploy phase (`*APPROVAL*`), with fallback options listed in §8.

## 5. Frontend API URL configuration (done, tested)

`js/config.js` now resolves `CONFIG.API_URL` in this order (pinned by
`backend/test/frontendConfig.test.js`):

1. `window.BUYO_API_URL` (non-empty string) — always wins. To point a deployed
   frontend at a dedicated API host, add before the config.js script tag (or
   inject via the platform):
   `<script>window.BUYO_API_URL = "https://api.example.com/api";</script>`
2. Local page (`localhost` / `127.0.0.1` / `[::1]` / `file://`) →
   `http://localhost:5000/api` — byte-identical to the old hard-coded value.
3. Any other host → same-origin `/api`. **A production page can never silently
   fall back to localhost**, and the live site is unaffected because `main`
   does not contain this file.

All existing API paths and the `js/api.js` client contract are unchanged.
**This phase did not change any URL used by the current live website.**

## 6. Migration & backup prerequisites (Supabase)

- Schema: apply the guarded PG migrations (`backend/migrations/*.pgsql`) to the
  Supabase database from your machine through a tunnel/`psql`-style channel in
  the approved cutover phase — never unattended. The runner refuses non-loopback
  hosts, `NODE_ENV=production` and missing allowlists today. The future remote
  approval contract (token + `--confirm-remote` + exact host:port/database
  allowlists + a `DATABASE_URL` tripwire) is designed and test-pinned in
  **`docs/migration-remote.md`** — wiring it in needs real project details.
- Backups: Phase 7 gave us a tested PG logical backup/restore pair
  (`npm run db:backup` / `db:restore`, format `buyo-pg-backup/1`) that works
  against any loopback PG. For Supabase: enable PITR/automated backups first
  (primary recovery), then run our logical backup periodically through the
  tunnel as the portable secondary. Runbook: `docs/backup-restore.md`.
- Images: `db:backup` covers paths, not files — the Storage migration script
  (planned in `docs/storage-supabase.md`) must run before paths are rewritten.

## 7. Storage (Supabase) — adapter implemented, no bucket created (Phase 12)

Full design, validation matrix, bucket policy, URL scheme, failure handling
and blockers: **`docs/storage-supabase.md`**; Phase 12 implementation record:
**`docs/storage-phase12.md`**. As of Phase 12 the storage adapter, the
direct-to-storage upload endpoints (`POST /api/uploads/authorize` + server-side
verification before any product write) and the guarded migration utility
(`npm run migrate:storage`) are implemented and tested against a MOCKED SDK —
still no bucket, no upload, no remote contact. Remaining before cutover:
create the bucket, configure `STORAGE_DRIVER=supabase` + credentials on the
platform, and run the first real (sandbox) upload.

## 8. Deployment sequence (nothing below has been executed)

1. ~~Cutover-preparation phase~~ **done as Phase 9**: PG TLS (`PG_SSL`,
   verification always on), small serverless pool, `/api/health` +
   `/api/health/ready`, no DB work at cold start, remote-migration contract
   (`docs/migration-remote.md`). Remaining before Supabase: wire the remote
   gate + thread TLS through the CLI scripts (cutover phase — needs the real
   target identity).
2. **Supabase project** create + database provision. *\*APPROVAL\** — first
   contact with Supabase; credentials then enter the platform secret manager only.
3. Apply migrations to Supabase; seed nothing fake; provision the first admin
   through the guarded path (`docs/admin-provisioning.md` pattern, adapted to
   the sanctioned remote channel).
4. **Storage**: create bucket + service-role key per `docs/storage-supabase.md`;
   implement + test the adapter; migrate existing `backend/uploads/` files;
   backfill image URLs. *\*APPROVAL\**
5. **Vercel project**: link repo (root = repo root), set §2 env vars, deploy a
   **preview**, verify: static pages load, `/api/*` reaches the function with
   correct paths (the `restoreApiPrefix` assumptions), auth + CORS + upload
   flow, `TRUST_PROXY=1` rate-limit behavior. *\*APPROVAL\**
6. Frontend URL decision: keep same-origin `/api` (default) or set
   `window.BUYO_API_URL`. Commit the final choice; never guess.
7. Promote to production (domain, DNS). *\*APPROVAL\** — runs the §10 smoke test.
8. Rollback (see below) if anything fails.

## 9. Local verification commands (all green at this commit)

```bash
cd backend
npm test                # 341 tests: 340 pass, 1 skip (PG-only savepoint), MySQL + config/serverless/health/TLS/gate suites
npm run test:pg         # 5/5   (embedded-PG smoke)
npm run test:pg:catalog # 18/18    npm run test:pg:orders   # 22/22
npm run test:pg:auth    # 16/16    npm run test:pg:cart     # 15/15
npm run test:pg:security  # 23/23  npm run test:pg:migrations # 14/14
npm run test:pg:tooling   # 8/8    npm run test:pg:base       # 4/4
npm run test:pg:data      # 9/9    npm run test:pg:storage    # 20/20
npm run test:pg:variants  # 9/9
npm ci --omit=dev && node -e "require('pg'); console.log('pg OK')"   # prod install check (§3)
git ls-files .env backend/.env backend/.env.* | findstr .            # must print nothing
cd ../frontend
npm test                # 228/228
npm run build           # tsc --noEmit + vite build (frontend/dist)
```

Production build check: the frontend build is `npm run build` (TypeScript check
+ Vite output in `frontend/dist`); the API's "build" is `npm ci --omit=dev`
(§3). On Vercel, the function build happens at deploy time — verified in the
preview step (§8.5), never claimed before it runs.

## 10. Production smoke-test checklist (post-deploy; none of it has been run)

- [ ] Function boots, no config warnings; `GET /api/health` → `{success:true,status:"ok"}` (liveness, no DB); `GET /api/health/ready` → 200 only with the DB reachable (503 otherwise); `GET /api/definitely-missing` returns the JSON 404 (proves `/api` routing)
- [ ] Home/Products load real catalog data over HTTPS; no console errors; no localhost requests in the browser network panel
- [ ] Signup → verification email arrives (correct `FRONTEND_URL`/`BACKEND_URL`) → verify → login works
- [ ] Add to cart → COD checkout → order in customer history with totals+GST
- [ ] Admin login → dashboard counts → order transitions; image upload → URL served → survives a redeploy (Storage, not disk)
- [ ] Password reset → single-use token → old session invalidated
- [ ] Authz matrix: 401/403/404 as designed; tampered JWT → 401; CORS rejects unknown origins
- [ ] Rate limiting: auth 429 after the configured burst; `TRUST_PROXY=1` keeps per-client buckets
- [ ] Supabase PITR enabled; our logical backup taken; restore-into-scratch drill passes row counts
- [ ] `git ls-files` shows no `.env`; secret scan clean; rotation checklist items for cutover applied

## 11. Rollback procedure

- **Vercel**: instant rollback to the previous deployment from the project
  dashboard (no git surgery, no force-push). The `main`-branch legacy site
  stays untouched and deployable as a last resort.
- **Database**: no destructive migration is ever applied unattended; rollback =
  restore the pre-change logical backup into the database via
  `docs/backup-restore.md`, or Supabase PITR to the pre-cutover timestamp.
- **Config**: env-var changes are recorded in the deploy PR; reverting the
  values + promoting the previous deployment restores behavior.
- **Do not** rotate `JWT_SECRET` as a rollback step mid-incident (it logs every
  user out); rotate only at planned cutovers.

## 12. Known blockers before production (carry into the cutover phase)

1. B1: product-image storage — local disk is ephemeral on Vercel (Storage adapter phase).
2. B2: upload path vs Vercel request limits — lowering multer's 5 MB cap alone fixes nothing (ephemeral disk remains, multipart overhead still counts toward the ~4.5 MB request cap, cold-start timeouts apply). The storage phase moves uploads direct-to-storage via signed URLs; see `docs/storage-supabase.md` §3.
3. ~~B3: PG TLS missing~~ **resolved in Phase 9 for the app path** (`PG_SSL`, verification always on). Remaining: thread TLS through the four CLI scripts' `pg` clients (cutover phase).
4. Remote migration remains **blocked by design**: the approval contract is designed + test-pinned (`docs/migration-remote.md`), but wiring it in requires the real target identity and the cutover phase's explicit approval. Until then every script stays loopback-only.
5. Real SMTP credentials (JSON dry-run only so far) — or a transactional provider change.
6. Credential rotation per `docs/environment-variables.md` (leaked legacy `JWT_SECRET`/`MONGO_URI` from old commit `962a229`).
7. In-memory rate limiter → shared store if multi-instance (documented limitation, acceptable for a single-function start).
8. Frontend URL choice (§8.6) must be committed before promoting production.
