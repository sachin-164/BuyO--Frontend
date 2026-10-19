# BuyO — Remote (Supabase) Migration Contract (Phase 9)

Status: **DESIGN + TESTED CONTRACT ONLY — no remote migration is possible or
enabled today.** `scripts/migrate.js` (and every other guarded DB script)
still refuses any non-loopback host before a connection is attempted. This
document defines exactly what the first explicitly-approved Supabase
migration will require; the contract itself is pinned by
`backend/test/remoteMigrationGate.test.js` and implemented in
`backend/scripts/lib/remoteTargetGate.js` (deliberately not yet consumed by
the runner).

## 1. Why the path is blocked today

A safe remote migration needs real project details that do not exist yet:

1. The actual target identity (host:port, database name) — Supabase exposes
   different endpoints (pooler vs direct) and we will not guess which one is
   used, nor bake any hostname into code.
2. TLS threading through the tooling: the app path (Sequelize) got TLS in
   Phase 9 (`PG_SSL`, verification always on), but the four CLI scripts'
   raw `pg` connections (`migrate.js`, `admin-role.js`, `db-backup.js`,
   `db-restore.js`) still build loopback-only clients. Wiring
   `settings.ssl` through them is a small, audited change for the cutover
   phase — until then the scripts cannot even speak TLS to a hosted server.
3. A sandbox-first runbook: the first remote run must target a scratch
   database on the real project (row-count-verified, disposable), never the
   production database directly.

Until all three exist, the local guard is the only gate — and it refuses.

## 2. The approval contract (`evaluateRemoteTarget`)

A remote target evaluates to `allowed: true` ONLY when **all** conditions
hold simultaneously (each maps to a tested refusal):

| # | Condition | Env / flag | Refused when |
|---|---|---|---|
| 1 | Per-phase approval token set exactly | `PG_REMOTE_MIGRATION_APPROVED=phase-cutover-approval` | unset, empty or any other value (default state) |
| 2 | Explicit flag | `--confirm-remote` | missing |
| 3 | Not production | `NODE_ENV` ≠ `production` | `production` |
| 4 | Valid target shape | `PG_HOST`, `PG_PORT` (1–65535), `PG_DB` | any missing/invalid |
| 5 | Not loopback | — | loopback host (must use `--confirm-local` flow) |
| 6 | Exact host:port pre-approved | `PG_REMOTE_ALLOWED_HOSTS="host:port,..."` | host, port or entry missing |
| 7 | Exact database pre-approved | `PG_REMOTE_ALLOWED_DATABASES="db,..."` | database missing from list |
| 8 | No ambient URL | `DATABASE_URL` **absent** | any value present (tripwire) |

- Condition 1 makes remote migration **disabled by default**: without the
  token (which the operator sets only after an explicit cutover approval),
  nothing else even matters.
- Condition 8 enforces "no implicit `DATABASE_URL`, no URL bypass": the
  target may only come from explicit `PG_*` names, so an arbitrary URL can
  never be smuggled past the allowlists.

## 3. Target identity validation without printing credentials

The validated identity is **host + port + database** only. The gate never
reads, compares, logs or echoes usernames or passwords (a test pins this:
fixture credentials never appear in any refusal reason). Hostnames and
database names appear in refusal messages because they are operator
configuration, not secrets. Refusals name the *variable* that must change
(`PG_REMOTE_ALLOWED_HOSTS`, …), never a secret value.

## 4. What wiring it in will look like (cutover phase, needs approval)

Not implemented now — recorded so the future diff is predictable:

1. `scripts/migrate.js` CLI: when the resolved host is non-loopback, replace
   the current unconditional loopback refusal with `evaluateRemoteTarget(...)`
   (all eight conditions); `allowed:false` → refuse with reasons exactly like
   today. Loopback keeps the unchanged `--confirm-local` path.
2. Thread `settings.ssl` (Phase 9, verification-on) through the four scripts'
   `pg` Client constructors so a TLS connection is possible at all.
3. First runbook: backup first (`docs/backup-restore.md`), then apply to a
   **scratch** database on the real project, verify with `--status` and the
   `-- verify:` directives, then — separately approved — the production
   database. Never unattended; never from CI.
4. The approval token is set per approved operation and removed afterwards;
   it is configuration, not a secret (but still never committed).

## 5. What is pinned by tests today

- The full gate contract (11 refusal/allowance cases):
  `backend/test/remoteMigrationGate.test.js`.
- The runner stays loopback-only:
  `backend/test/pgMigrations.test.js` (PG) and
  `backend/test/migrations.test.js` (MySQL) both assert non-loopback refusal.
- The refusal output now points here (`docs/migration-remote.md`) whenever a
  non-loopback host is detected — informational only, safeguards unchanged.
