# Migration Phase 9 — PostgreSQL Production-Readiness Code

Status: **code preparation + local testing only.** No Supabase contact, no
hosted database access, no Vercel deployment, no production env changes, no
data migration, no API-URL change. Base commit: `dd57ce4` (Phase 8).

## 1. What changed

| File | Change |
|---|---|
| `backend/config/dbConnectionOptions.js` | `resolvePgSslSetting()` (auto rule: TLS for non-loopback, plaintext loopback; `PG_SSL` true/false force; garbage throws), `resolvePoolOptions()` + shared strict `intFromEnvSetting()`; `resolvePostgresSettings()` now returns `ssl`; `getSequelizeOptions()` PG branch adds verified TLS (`rejectUnauthorized: true` hardcoded) + the small pool. MySQL path untouched |
| `backend/config/db.js` | Import-time `authenticate()` probe **removed** — Sequelize connects lazily; serverless cold starts do zero DB work |
| `backend/server.js` | Startup log is dialect-aware (`PostgreSQL`/`MySQL` + resolved database name) |
| `backend/routes/healthRoutes.js` (new) | `GET /api/health` liveness (no DB) + `GET /api/health/ready` bounded `SELECT 1` (default 2 s, `HEALTH_DB_TIMEOUT_MS`), safe opaque 503 |
| `backend/app.js` | Mounts `/api/health` under the global limiter |
| `backend/scripts/lib/remoteTargetGate.js` (new) | Future remote-migration approval contract — **not consumed by any runner** |
| `backend/scripts/lib/localDbGuard.js` | Non-loopback refusals now point to `docs/migration-remote.md` (extra lines only; safeguards unchanged) |
| `backend/test/dialect.test.js` | PG settings `deepEqual` gains `ssl: false` (loopback default) |
| `backend/test/pgRuntime.test.js` (new, 8) | TLS auto/forced/invalid, verification posture, pool defaults/overrides/invalid, MySQL preserved, no-import-connection subprocess proof, `intFromEnvSetting` |
| `backend/test/health.test.js` (new, 1) | Public endpoints, healthy readiness, outage → safe 503 with no leaked internals, liveness survives DB loss |
| `backend/test/remoteMigrationGate.test.js` (new, 10) | Refusal by default, each missing/invalid condition, allowlist exact-match, loopback exclusion, `DATABASE_URL` tripwire, credential-silence |
| `backend/package.json` | Three new suites in `npm test` (157 tests total) |
| `backend/.env.example`, `docs/environment-variables.md`, `docs/deployment.md` | New knobs + updated blocker status (B3 resolved for app path) |
| `docs/migration-remote.md` (new) | The remote-migration contract + exact prerequisites for wiring |
| `docs/storage-supabase.md` | Why lowering the multer cap alone cannot fix Vercel upload limits; direct-to-storage proposal |

## 2. Decisions

- **TLS default:** automatic — non-loopback ⇒ TLS with verification; loopback ⇒
  plaintext (embedded test clusters unchanged). `PG_SSL=false` exists as an
  explicit mode for plaintext tunnels; there is deliberately **no**
  `rejectUnauthorized:false` switch anywhere on the PG path.
- **Pool:** PG path only (`DB_POOL_MAX` default 2) — MySQL keeps Sequelize's
  defaults so the existing suites and dev behavior are byte-identical.
- **No import-time connections:** the `config/db.js` probe was observability
  only; `server.js` keeps explicit startup authentication with real error
  handling.
- **Health split:** liveness = `GET /api/health` (no DB), readiness =
  `GET /api/health/ready` (bounded, opaque 503). No migrations/sync ever.
- **Remote migration:** stays fully blocked. The gate contract (approval
  token + `--confirm-remote` + exact host:port/database allowlists +
  production refusal + `DATABASE_URL` tripwire) is implemented and test-pinned
  but wired into nothing; prerequisites in `docs/migration-remote.md`.

## 3. Test evidence (this commit)

- `npm test` 157 → 156 pass / 0 fail / 1 skip (skip = Phase 3 PG-only savepoint).
- PG matrix all green: smoke 5, catalog 18, orders 22, auth 16, cart 15,
  security 20, migrations 14, tooling 8.
- One environment flake during the run: the 6th–8th PG suites hit a stray
  `postgres.exe` (Windows embedded-PG shared-memory release race, PID 17080);
  killed the stray by PID (user's MySQL PID 5564 untouched), removed the
  stale temp data dir, re-ran the three suites → all green. Not a code defect.

## 4. Out of scope / not done here

- No remote migration possible or enabled; CLI scripts still loopback-only and
  still without TLS wiring (cutover phase, needs real target identity).
- No Supabase connection, bucket, credentials, deploy, or Vercel/Supabase
  setting changes; `main` untouched.
- Upload behavior unchanged (5 MB local multer intact) — Vercel limit analysis
  documented in `docs/storage-supabase.md` §3.
