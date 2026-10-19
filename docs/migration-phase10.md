# Migration Phase 10 — Remote Gate Integration, CLI TLS and Sandbox Runbook

Status: **tooling preparation + local testing only.** No Supabase contact, no
hosted database access, no remote admin, no remote migrations applied, no
deploy, no production setting changes. Base commit: `de0c01e` (Phase 9).

## 1. What changed

| File | Change |
|---|---|
| `backend/scripts/lib/remoteTargetGate.js` | Contract unchanged (8 conditions, exact token, tripwire) + two enforcement helpers: `enforceRemoteGateOrExit()` (CLI `main()`s — returns `"local"` for loopback, `"remote-approved"` when every condition holds, else prints credential-free reasons and exits 1) and `assertRemoteGateApproved()` (library call site — throws `refusedRemote`-flagged error with attached reasons) |
| `backend/scripts/lib/pgClientOptions.js` (new) | Single source turning resolved PG settings into `pg` Client options: `ssl: { rejectUnauthorized: true }` iff `settings.ssl`, otherwise **no ssl key at all** (loopback byte-identical) |
| `backend/scripts/migrate.js` | `main()`: PG non-loopback ⇒ gate first (refusal before any connection); loopback/MySQL keep the exact `--confirm-local` flow. `runPostgresMigrations()`: client via `pgClientOptions` + credential-free `Target: db @ host:port [TLS verified\|plaintext]` line |
| `backend/scripts/admin-role.js` | Same gate in `main()`; `connectPg()` via `pgClientOptions` |
| `backend/scripts/db-restore.js` | Same gate in `main()` (scratch-name allowlist exception stays inside the local branch, `target` hoisted); `runRestorePg` clients via `pgClientOptions` |
| `backend/scripts/db-backup.js` | PG non-loopback now needs `--allow-remote` **AND** the full gate (`assertRemoteGateApproved` after the unchanged `assertBackupTargetAllowed`); main's refusal handler prints gate reasons when flagged; `buildPgDump` client via `pgClientOptions`. MySQL `--allow-remote` behavior byte-identical |
| `backend/scripts/db-sync.js` | Comment only: **never** remote, not even with the gate — hosted schema comes only from numbered migrations |
| `backend/test/remoteGateCli.test.js` (new, 13) | See §3 |
| `backend/test/pgRuntime.test.js` | +1 `pgClientOptions` unit test (verified TLS hosted / byte-identical loopback / maintenance-db override) |
| `backend/test/pgTooling.test.js` | `admin:role` non-loopback refusal assertion updated from the old `/not loopback/` guard message to the new, strictly stronger gate refusal (same intent: exit 1 before any connection — now also asserted explicitly) |
| `backend/package.json` | `remoteGateCli.test.js` added to `npm test` (171 tests total) |
| `docs/migration-remote.md` | Rewritten: protection matrix (§1), contract (§2), identity/silence (§3), local-vs-approval table (§4), **sandbox-first runbook (§5.0–5.8)**, test evidence (§6) |
| `backend/.env.example`, `docs/environment-variables.md`, `docs/deployment.md` | Gate variables documented as enforced; `DATABASE_URL` tripwire note |

## 2. Decisions

- **Enforcement point = CLI entry (`main()` / `createBackup()`), not library
  internals:** loopback resolves to the unchanged `--confirm-local` guard
  (zero behavior change for local flows and MySQL); non-loopback resolves to
  the gate, which must pass *before* a `pg` Client is ever constructed.
- **`db:backup` keeps `--allow-remote` and adds the gate** — additive, never
  a replacement; the Phase 7 refusal message/test stays valid for the flag
  itself. MySQL remote-backup semantics untouched.
- **`db:sync` deliberately has no remote path at all** (not even with full
  approvals): model-based sync is a local-dev convenience; hosted schema is
  exclusively numbered-migration territory.
- **TLS:** threaded through all four CLI clients via one helper; hosted
  targets always `rejectUnauthorized: true` — no bypass knob anywhere; the
  `PG_SSL` resolution (fail-fast on garbage) happens before any connection.
- **No guessed target identity:** allowlists come only from operator env at
  run time; nothing Supabase-shaped is hardcoded. The remote path is now
  *possible but off by default* — every documented approval condition must
  hold, and the sandbox runbook (§5 of `docs/migration-remote.md`) is the
  only sanctioned way to use it.
- **`DATABASE_URL` tripwire now also trips on `backend/.env` leftovers:** a
  non-empty line there refuses remote runs by design (documented: remove for
  an approved operation). Tests pin `DATABASE_URL` = empty as "absent".

## 3. Test evidence (this commit)

`backend/test/remoteGateCli.test.js` (13) — refuses BEFORE any connection
(target `127.0.0.2:1`: non-loopback, IP-literal so no DNS, port 1 so any
attempt would yield an instant `ECONNREFUSED` — its ABSENCE in refusal
stderr proves no attempt; its PRESENCE in approved-case stderr proves the
gate passed):

1. missing approval token → refused (migrate)
2. missing `--confirm-remote` → refused (migrate)
3. `NODE_ENV=production` → refused even with token+flag
4. unapproved `host:port` → refused
5. unapproved database → refused
6. `DATABASE_URL` present → refused, its contents never echoed
7. invalid `PG_SSL` → refuses before connecting
8. fully approved target → gate passes; connection attempted (local ECONNREFUSED only)
9. `admin:role` unapproved → refused before connecting
10. `db-restore` unapproved → refused before connecting
11. `db:backup` with `--allow-remote` but no gate → refused (stronger than Phase 7)
12. `db:backup` with `--allow-remote` + full gate → attempted (ECONNREFUSED only)
13. MySQL `db:backup` non-loopback without `--allow-remote` → still refused (unchanged)

Matrix (all local; no hosted service contacted):

- `npm test` **171 → 170 pass / 0 fail / 1 skip** (skip = Phase 3 PG-only savepoint).
- PG all green: smoke 5, catalog 18, orders 22, auth 16, cart 15,
  security 20, migrations 14, tooling 8.
- Environment flake during the run: the tooling suite hit a stray
  `postgres.exe` (Windows embedded-PG shared-memory release race, PID 3888);
  killed the stray by PID (user's MySQL PIDs 4640/5564 untouched), ports
  5433/5434 verified free, suites re-run green. Not a code defect.

## 4. Out of scope / prerequisites still needed for a real remote migration

- **No remote run has ever happened.** Prerequisites remain: an explicitly
  approved phase, a real Supabase project identity (host:port + database
  recorded from the dashboard, not guessed), sandbox creation/confirmation,
  and removal of the `DATABASE_URL` line for the operation — all spelled out
  in `docs/migration-remote.md` §5.
- Data migration MySQL → PostgreSQL is **not designed** (documented gap in
  runbook §5.4); this phase moves schema tooling only.
- No Supabase contact/creation, no deploy, no Vercel/Supabase setting
  changes; `main` untouched.
