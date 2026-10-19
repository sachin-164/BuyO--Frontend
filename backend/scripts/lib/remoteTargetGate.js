// scripts/lib/remoteTargetGate.js — remote-target approval gate
// (contract: Phase 9; CLI integration: Phase 10).
//
// STATUS (Phase 10): the gate is now ENFORCED by the PostgreSQL CLI tools —
// scripts/migrate.js, scripts/admin-role.js, scripts/db-backup.js and
// scripts/db-restore.js route every NON-loopback target through it (loopback
// keeps the unchanged --confirm-local flow). Remote execution stays disabled
// by default: without every condition below, the tools refuse BEFORE any
// connection or DNS lookup is attempted. db:sync and test:user never grow a
// remote path at all (local-dev tools by design). See docs/migration-remote.md
// for the sandbox-first runbook that accompanies an approved remote run.
//
// The contract: a remote target may be considered "approved" ONLY when ALL of
// the following hold at the same time —
//
//   1. PG_REMOTE_MIGRATION_APPROVED equals the exact per-phase approval token
//      (disabled by default; the token is set by the operator only after the
//      cutover phase receives explicit approval),
//   2. the --confirm-remote flag was passed explicitly,
//   3. NODE_ENV is not "production",
//   4. the target has a valid shape (host set, port 1..65535, database set),
//   5. the target host is NOT loopback (loopback must use the ordinary
//      --confirm-local flow — no parallel path for local databases),
//   6. host:port appears in PG_REMOTE_ALLOWED_HOSTS AND the database name
//      appears in PG_REMOTE_ALLOWED_DATABASES (exact match, pre-declared),
//   7. DATABASE_URL is ABSENT from the environment — remote targets must
//      come only from explicit PG_* names, so an arbitrary URL can never
//      bypass this validation, implicitly or otherwise.
//
// Identity validation never reads, prints or compares passwords: the target
// identity is host + port + database. Username is not echoed either. Hosts
// and database names appear in refusal messages because they are operator
// configuration, not secrets — credentials never do.

const { isLoopbackHost } = require("../../config/dbConnectionOptions");

const APPROVAL_ENV = "PG_REMOTE_MIGRATION_APPROVED";
const APPROVAL_TOKEN = "phase-cutover-approval"; // exact value required; unset/other = disabled
const HOSTS_ENV = "PG_REMOTE_ALLOWED_HOSTS";          // comma-separated "host:port"
const DATABASES_ENV = "PG_REMOTE_ALLOWED_DATABASES";  // comma-separated database names

function parseList(raw) {
  return String(raw || "").split(",").map((entry) => entry.trim()).filter(Boolean);
}

// Pure function: returns { allowed: boolean, reasons: string[] } ([] reasons = allowed).
// `settings` is the resolved PG settings object (host/port/database are the
// only fields consulted; username/password are deliberately ignored).
function evaluateRemoteTarget({ env = process.env, flags = new Set(), settings } = {}) {
  const reasons = [];

  // 1. Disabled by default: without the exact approval token, nothing else matters.
  if (String(env[APPROVAL_ENV] || "").trim() !== APPROVAL_TOKEN) {
    reasons.push(`${APPROVAL_ENV} is not set to the required per-phase approval token (remote migration is disabled by default)`);
  }

  // 2. Explicit flag (mirrors the --confirm-local discipline).
  if (!flags.has("--confirm-remote")) reasons.push("missing --confirm-remote flag");

  // 3. Production refusal (same safeguard as the local guard).
  if (String(env.NODE_ENV || "").toLowerCase() === "production") {
    reasons.push("NODE_ENV=production is set");
  }

  // 4. Target shape.
  const host = settings && settings.host ? String(settings.host).trim() : "";
  const database = settings && settings.database ? String(settings.database).trim() : "";
  const port = settings ? Number(settings.port) : NaN;
  if (!host) reasons.push("no database host configured (PG_HOST)");
  if (!database) reasons.push("no database name configured (PG_DB)");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    reasons.push(`target port is missing or invalid (PG_PORT${settings && settings.port !== undefined ? `, got "${settings.port}"` : ""})`);
  }

  // 5. Loopback targets never belong on the remote path.
  if (host && isLoopbackHost(host)) {
    reasons.push(`host "${host}" is loopback — use the standard --confirm-local flow instead`);
  }

  // 6. Exact-match allowlists (pre-declared target identity).
  const allowedHosts = parseList(env[HOSTS_ENV]);
  if (!allowedHosts.length) {
    reasons.push(`${HOSTS_ENV} is empty — the exact target host:port must be pre-approved`);
  } else if (!host || !Number.isInteger(port) || !allowedHosts.includes(`${host}:${port}`)) {
    reasons.push(`target host:port is not in ${HOSTS_ENV}`);
  }
  const allowedDatabases = parseList(env[DATABASES_ENV]);
  if (!allowedDatabases.length) {
    reasons.push(`${DATABASES_ENV} is empty — the exact database must be pre-approved`);
  } else if (!database || !allowedDatabases.includes(database)) {
    reasons.push(`database "${database}" is not in ${DATABASES_ENV}`);
  }

  // 7. DATABASE_URL tripwire: its mere presence is refused so that no future
  // code path can ever treat a free-form URL as the migration target.
  if (String(env.DATABASE_URL || "").trim() !== "") {
    reasons.push("DATABASE_URL is set in the environment — remote targets must come from explicit PG_* names only");
  }

  return { allowed: reasons.length === 0, reasons };
}

// Throwing variant for library-style call sites (db:backup's createBackup):
// returns normally when approved; throws an error carrying `refusedRemote`
// (so db-backup's existing refusal handler formats it) with the credential-
// free reasons attached. Loopback targets are not this gate's business.
function assertRemoteGateApproved({ scriptLabel, settings, env = process.env, flags = new Set() }) {
  if (settings && isLoopbackHost(settings.host)) return;
  const verdict = evaluateRemoteTarget({ env, flags, settings });
  if (verdict.allowed) return;
  const err = new Error(`${scriptLabel}: remote target "${settings && settings.host}" is not approved.`);
  err.refusedRemote = true;
  err.remoteGate = true;
  err.remoteGateReasons = verdict.reasons;
  throw err;
}

// Exit variant for CLI main()s: returns "local" for loopback targets (the
// caller then applies the unchanged --confirm-local guard) or "remote-approved"
// when every gate condition holds; otherwise prints a credential-free refusal
// and exits 1 BEFORE any connection is created.
function enforceRemoteGateOrExit({ scriptLabel, usage, settings, env = process.env, flags = new Set() }) {
  if (settings && isLoopbackHost(settings.host)) return "local";
  const verdict = evaluateRemoteTarget({ env, flags, settings });
  if (verdict.allowed) return "remote-approved";
  console.error(`❌ REFUSED: ${scriptLabel} only runs against a LOCAL database or a fully APPROVED remote target.`);
  for (const reason of verdict.reasons) console.error(`   - ${reason}`);
  console.error("   Remote targets stay disabled unless every approval condition holds (docs/migration-remote.md).");
  console.error(`   Usage: ${usage}`);
  process.exit(1);
}

module.exports = {
  evaluateRemoteTarget,
  assertRemoteGateApproved,
  enforceRemoteGateOrExit,
  APPROVAL_ENV,
  APPROVAL_TOKEN,
  HOSTS_ENV,
  DATABASES_ENV
};
