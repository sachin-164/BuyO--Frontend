# BuyO — Remote (Supabase) Migration: Gate, TLS and Sandbox-First Runbook (Phase 9 contract, Phase 10 integration)

Status: **the approval gate is INTEGRATED and TESTED; remote execution is
still disabled by default.** Nothing in this document has ever been run
against Supabase — no hosted database was contacted, no remote resource was
created. A remote run happens only when an operator supplies every approval
condition below, step by step, starting from the sandbox (§5).

- Contract implementation: `backend/scripts/lib/remoteTargetGate.js`
  (`evaluateRemoteTarget`, `enforceRemoteGateOrExit`, `assertRemoteGateApproved`)
- Contract tests: `backend/test/remoteMigrationGate.test.js` (11)
- CLI enforcement tests (refusal BEFORE any connection):
  `backend/test/remoteGateCli.test.js` (13)
- TLS threading: `backend/scripts/lib/pgClientOptions.js`, unit-pinned in
  `backend/test/pgRuntime.test.js`

## 1. What is protected, and how

Every PostgreSQL CLI tool that could open a database connection routes
non-loopback targets through the gate:

| Tool | Entry | Non-loopback behavior (Phase 10) | Local (loopback) behavior |
|---|---|---|---|
| `db:migrate` | `scripts/migrate.js` `main()` | `enforceRemoteGateOrExit` — refuses with reasons before any connection unless ALL 8 conditions hold | unchanged `--confirm-local` guard |
| `admin:role` | `scripts/admin-role.js` `main()` | same gate, same refusal | unchanged |
| `db:restore` | `scripts/db-restore.js` `main()` | same gate (plus the unchanged scratch-target rules) | unchanged (incl. `buyoDB_*` allowlist exception) |
| `db:backup` | `scripts/db-backup.js` `createBackup()` | `--allow-remote` **and** the full gate are BOTH required — `assertRemoteGateApproved` throws credential-free reasons before connecting | unchanged (loopback needs no `--allow-remote`) |
| `db:sync` | `scripts/db-sync.js` | **never remote, not even with the gate** — model sync is a local-dev convenience; hosted schema comes only from the numbered migrations | unchanged |
| `test:user` | `scripts/test-user.js` | MySQL-only, local-only by decision | unchanged |
| MySQL paths of all tools | — | untouched: `--allow-remote` semantics exactly as audited in Phase 7 | unchanged |

Refusal output is credential-free: reasons name the *variable* or *flag* that
must change, never usernames, passwords, connection strings or URL contents
(pinned by tests, including a `DATABASE_URL` whose contents are never echoed).

Target validation and TLS validation both happen **before** any database
operation: the gate runs first in each `main()`/`createBackup()`, and
`resolvePostgresSettings()` (which fails fast on an invalid `PG_SSL` value,
and whose hosted default is verified TLS) runs before any connection is
constructed. Certificate verification is always on for hosted targets —
there is no `rejectUnauthorized:false` knob anywhere on the PG path.

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
| 8 | No ambient URL | `DATABASE_URL` **absent or empty** | any non-empty value present (tripwire) |

- Condition 1 makes remote execution **disabled by default**: without the
  token (set only for an explicitly approved operation, removed afterwards),
  nothing else matters. The token is configuration, not a secret — but it is
  still never committed.
- Condition 8 enforces "no implicit `DATABASE_URL`, no URL bypass": the
  target may only come from explicit `PG_*` names, so an arbitrary URL can
  never be smuggled past the allowlists. A `DATABASE_URL` line left in
  `backend/.env` trips this wire on purpose — remove/rename it before an
  approved run.
- `--allow-remote` alone (Phase 7) no longer suffices for a PostgreSQL
  backup; the gate is additive, never a replacement for existing flags.

## 3. Target identity validation without printing credentials

The validated identity is **host + port + database** only. The gate never
reads, compares, logs or echoes usernames or passwords (a test pins this:
fixture credentials never appear in any refusal reason or output). Hostnames
and database names appear in refusal messages and in the migrate `Target:`
line because they are operator configuration, not secrets:

```
Target: buyo_sandbox @ db.<project-ref>.supabase.co:5432 [TLS verified]
```

That line prints exactly what will be connected to — compare it against the
Supabase dashboard before approving any further step.

## 4. Local tests vs operations requiring explicit approval

| Operation | Approval needed? | Contact with a hosted service? |
|---|---|---|
| Full local test matrix (`npm test`, `npm run test:pg:*`) | no — always allowed | no: embedded PostgreSQL + local MySQL only |
| `remoteGateCli` refusal tests | no | no: they prove refusal happens with zero connections (target is `127.0.0.2:1`, refused at TCP level only) |
| Local schema work via `db:sync` / `db:migrate --confirm-local` | no (existing local rules) | no |
| **First remote run — even against an empty sandbox** | **YES: explicit phase approval, plus all 8 gate conditions** | yes |
| Remote backup / restore / admin-role | **YES — same as above** | yes |
| Applying migrations to the production database | **SEPARATE, later approval** (its own phase) | yes |
| Provisioning the first real administrator on a hosted DB | **YES** (§5.6) | yes |

## 5. Sandbox-first runbook

Prerequisites listed in §5.1–5.2 must exist and be recorded before §5.3.
Steps below are written for a **sandbox** target; each states what may be run
locally first. Never run these from CI; never unattended.

### 5.0 Prepare the approval environment (per operation)

1. Set in `backend/.env` (never printed, never committed):
   - `DB_DIALECT=postgres`
   - `PG_HOST`, `PG_PORT`, `PG_DB`, `PG_USER`, `PG_PASS` from the dashboard
   - `PG_REMOTE_MIGRATION_APPROVED=phase-cutover-approval`
   - `PG_REMOTE_ALLOWED_HOSTS=<host>:<port>` (exact, copied from dashboard)
   - `PG_REMOTE_ALLOWED_DATABASES=<database>` (exact)
2. Ensure `DATABASE_URL` is absent/empty in `.env` (tripwire, condition 8).
3. Ensure `NODE_ENV` is not `production` (condition 3).
4. Add `--confirm-remote` on the command line (condition 2).
5. **Remove the approval token and allowlists from `.env` when the approved
   operation finishes** — they are per-operation configuration.

### 5.1 Identify and verify the intended Supabase project and connection method

1. In the Supabase dashboard (Settings → API), record: project name, project
   ref, and the DB connection options it offers (direct `:5432` vs pooler
   endpoints).
2. Decide and record — do not guess, do not hardcode in the repo:
   - **which endpoint the CLI tools will use** (schema operations such as
     migrations are best run over the direct connection),
   - **which endpoint the application (Sequelize) will use at runtime**
     (pooler, decided in the cutover phase).
3. Verify the hostname format shown by the dashboard is what you put into
   `PG_HOST` / `PG_REMOTE_ALLOWED_HOSTS`. No hostname is baked into code.
4. Credentials stay in `.env` only — never on a command line (shell history),
   never in a screenshot, never in a doc.
5. Also record from the dashboard: whether the plan allows creating extra
   databases per project (§5.2) and `CREATE`/`DROP DATABASE` permissions
   (§5.7 recovery) — if either is unavailable, adjust the plan (separate
   sandbox project) before proceeding; do not improvise around it.

### 5.2 Create an isolated sandbox (or confirm an approved empty target)

1. Preferred for the first run: a **separate disposable Supabase project**
   (sandbox), not the future production project.
2. Within a project, create a dedicated database, e.g. `buyo_sandbox_<date>`,
   via the dashboard SQL editor — no credentials in the terminal.
3. Confirm it is empty (SQL editor):
   `SELECT count(*) FROM information_schema.tables WHERE table_schema = 'public';`
   → must be `0`. Record the result.

### 5.3 Verify hostname, port and database name without disclosing credentials

1. Apply §5.0.
2. Run (read-only):
   ```
   npm run db:migrate -- --status --confirm-remote
   ```
3. Check the printed line `Target: <database> @ <host>:<port> [TLS verified]`
   against the dashboard values — mismatch → STOP, fix config, never widen
   the allowlists to "make it pass".
4. `--status` succeeding also proves: DNS + TCP + certificate validation all
   worked against the approved identity (a TLS failure aborts here).
5. If any gate condition is missing, the tool exits 1 with per-condition
   reasons and **no connection was attempted** — verify that first when
   debugging.

### 5.4 Back up and validate before any migration

1. Local first (always allowed): `npm run db:backup -- --confirm-local` —
   confirms the backup path is healthy on loopback.
2. Remote (approved) — the target's current state, even empty:
   ```
   npm run db:backup -- --allow-remote --confirm-remote
   ```
   Output: `backend/backups/buyo-pg-backup-*.json` (format
   `buyo-pg-backup/1`).
3. Validate the backup before migrating: file exists, `format` field is
   `buyo-pg-backup/1`, `database` field matches the sandbox, table list
   matches what the SQL editor reports. A backup that cannot be validated is
   not a backup — stop here.
4. Also take/keep a fresh **MySQL** backup of the real data — it remains the
   rollback anchor (§5.8).
5. Honest gap: these tools migrate **schema and tooling**, not rows. Moving
   production data from MySQL to PostgreSQL is a separate, not-yet-designed
   prerequisite of cutover — record it, do not improvise it here.

### 5.5 Apply and verify numbered migrations

1. `npm run db:migrate -- --status --confirm-remote` → record pending list.
2. `npm run db:migrate -- --confirm-remote` → each pending `NNN_*.pgsql` runs
   in its own transaction with its `-- precheck:` / `-- verify:` directives;
   applied files are checksum-frozen.
3. Re-run `--status` → every migration listed as applied, none pending, no
   orphaned bookkeeping rows.
4. Spot-check in the SQL editor: expected tables/indexes exist
   (`information_schema` counts vs `migrations/` file list).
5. Never edit an applied `.pgsql` file — checksum mismatch refuses on the
   next run by design.

### 5.6 Provision the first administrator safely

`admin:role` only changes the role of an **existing** user — it never creates
users or passwords.

1. Run the API locally (`NODE_ENV` ≠ production) with `PG_*` pointed at the
   sandbox; signup the intended admin account through the normal flow.
   Email verification: with `MAIL_TRANSPORT=json` the link appears in the
   server log — no live SMTP involved. Use a unique, dedicated password.
2. Confirm the user row exists (SQL editor) and is verified.
3. Grant the role (approved remote):
   ```
   npm run admin:role -- --email <email> --role admin --confirm-remote
   ```
4. `npm run admin:role -- --list --confirm-remote` → exactly the expected
   admin(s). Passwords are never touched, printed or logged by this tool.

### 5.7 Recover from a failed migration

1. A failing file rolls back **its own transaction only**; earlier files from
   the same run stay applied; bookkeeping never records a failed file.
2. Read the failure output (statement label + file name — no secrets), fix
   the file if it was never applied (checksum is frozen only after a
   successful apply), re-run `--status` then the migration.
3. If the target is uncertain/corrupt: **drop and recreate the sandbox**
   (it is disposable by definition — §5.2) and re-run from an empty state;
   or, for an approved non-empty target, restore the §5.4 backup:
   `npm run db:restore -- --target <db> --file <backup.json> --confirm-remote`
   (the gate applies to restore too).
   Hosted caveat, verify in §5.1 before relying on this: restore/recreate
   need permission to `CREATE`/`DROP DATABASE`, which many hosted plans
   restrict — if the project cannot create a second database, use a separate
   sandbox project (§5.2) instead of recreating databases in place.
4. Record the incident (what failed, what was rolled back, what was done)
   before any retry. Escalate to a new approval if scope changes.

### 5.8 Keep the existing MySQL deployment available for rollback

1. The MySQL database and deployment are **never modified** by any step in
   this runbook — they remain the source of truth and the rollback target
   until an explicitly approved cutover says otherwise.
2. The current Vercel production site (`main` branch) keeps running the old
   stack untouched; none of this work changes it.
3. Rollback posture: PG sandbox work receives no production traffic, so
   "rolling back" is simply not switching anything. After any future cutover,
   keep MySQL frozen-but-runnable for an agreed burn-in period; only a
   separate approval may decommission it, after data parity is verified.
4. Frontend/API URL switch is a cutover-phase decision — never done from a
   migration run.

## 6. What is pinned by tests

- Gate contract (11 refusal/allowance cases):
  `backend/test/remoteMigrationGate.test.js`
- CLI enforcement, refusal-before-connection incl. TLS-invalid, unapproved
  host/db, `DATABASE_URL` tripwire, backup double-gate, MySQL unchanged (13):
  `backend/test/remoteGateCli.test.js`
- TLS threading unit (`pgClientOptions`: verified TLS hosted / byte-identical
  loopback): `backend/test/pgRuntime.test.js`
- Local loopback flows unchanged: `backend/test/pgMigrations.test.js`,
  `backend/test/pgTooling.test.js` (PG) and `backend/test/migrations.test.js`
  (MySQL)
- Refusal output points here (`docs/migration-remote.md`) whenever a
  non-loopback host is detected.
