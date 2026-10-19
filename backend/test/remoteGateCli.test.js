// test/remoteGateCli.test.js — Phase 10: the remote approval gate is actually
// ENFORCED by the CLI tools, and refusal always happens BEFORE any connection
// (or DNS lookup) is attempted.
//
// Technique: point the tools at 127.0.0.2:1 — NOT recognized as loopback by
// isLoopbackHost, an IP literal (no DNS ever), and port 1 where nothing can
// listen. So:
//   - any refused run proves "no connection attempted" by the ABSENCE of
//     ECONNREFUSED/socket errors in stderr,
//   - a fully-approved run proves the gate passed by the PRESENCE of
//     ECONNREFUSED (the connection was actually attempted, locally, instantly).
// No hosted service is contacted — this suite is dialect-agnostic and DB-free.
const test = require("node:test");
const assert = require("node:assert");
const { execFileSync } = require("node:child_process");
const path = require("node:path");

const BACKEND = path.join(__dirname, "..");
const REMOTE_HOST = "127.0.0.2";
const REMOTE_PORT = "1";
const SANDBOX_DB = "buyo_sandbox";
const PASS_SENTINEL = "gate-secret-pass-10";

// stderr markers that would betray a connection/DNS attempt
const CONNECT_ATTEMPT = /ECONNREFUSED|getaddrinfo|ENOTFOUND|EPIPE|ETIMEDOUT|socket/i;

function baseEnv(overrides = {}) {
  const env = {
    ...process.env,
    NODE_ENV: "test",
    DB_DIALECT: "postgres",
    PG_HOST: REMOTE_HOST,
    PG_PORT: REMOTE_PORT,
    PG_DB: SANDBOX_DB,
    PG_USER: "postgres",
    PG_PASS: PASS_SENTINEL,
    // Pin to empty (not deleted): backend/.env may carry a DATABASE_URL line
    // which dotenv would re-inject — dotenv never overrides existing keys, and
    // the gate treats an empty value as absent (its tripwire is presence-based).
    DATABASE_URL: ""
  };
  // Everything gate- or guard-related starts UNSET; cases add pieces explicitly.
  for (const key of [
    "PG_SSL",
    "PG_REMOTE_MIGRATION_APPROVED", "PG_REMOTE_ALLOWED_HOSTS", "PG_REMOTE_ALLOWED_DATABASES",
    "DB_MIGRATE_ALLOWED_DATABASES", "DB_ADMIN_ALLOWED_DATABASES",
    "DB_RESTORE_ALLOWED_DATABASES", "DB_SYNC_ALLOWED_DATABASES"
  ]) {
    delete env[key];
  }
  return { ...env, ...overrides };
}

const FULL_APPROVALS = {
  PG_REMOTE_MIGRATION_APPROVED: "phase-cutover-approval",
  PG_REMOTE_ALLOWED_HOSTS: `${REMOTE_HOST}:${REMOTE_PORT}`,
  PG_REMOTE_ALLOWED_DATABASES: SANDBOX_DB
};

function run(script, args, env) {
  try {
    const stdout = execFileSync(process.execPath, [path.join(BACKEND, "scripts", script), ...args], {
      cwd: BACKEND,
      env,
      encoding: "utf8",
      timeout: 20000
    });
    return { code: 0, stdout, stderr: "" };
  } catch (err) {
    return { code: err.status, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

function assertRefusedWithoutConnecting(res, reasonPattern) {
  assert.equal(res.code, 1, `expected refusal exit 1, got ${res.code}\n${res.stderr}`);
  assert.match(res.stderr, /REFUSED:/);
  if (reasonPattern) assert.match(res.stderr, reasonPattern);
  assert.ok(!CONNECT_ATTEMPT.test(res.stderr), `refusal must happen before any connection attempt:\n${res.stderr}`);
  assert.ok(!res.stderr.includes(PASS_SENTINEL), "password must never be printed");
  assert.ok(!res.stdout.includes(PASS_SENTINEL), "password must never be printed");
}

// ---------- db:migrate ----------

test("db:migrate: missing approval token refuses before any connection", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv({
    PG_REMOTE_ALLOWED_HOSTS: FULL_APPROVALS.PG_REMOTE_ALLOWED_HOSTS,
    PG_REMOTE_ALLOWED_DATABASES: FULL_APPROVALS.PG_REMOTE_ALLOWED_DATABASES
  }));
  assertRefusedWithoutConnecting(res, /PG_REMOTE_MIGRATION_APPROVED/);
});

test("db:migrate: missing --confirm-remote refuses before any connection", () => {
  const res = run("migrate.js", [], baseEnv(FULL_APPROVALS));
  assertRefusedWithoutConnecting(res, /missing --confirm-remote flag/);
});

test("db:migrate: NODE_ENV=production refuses even with token + flag", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv({ ...FULL_APPROVALS, NODE_ENV: "production" }));
  assertRefusedWithoutConnecting(res, /NODE_ENV=production/);
});

test("db:migrate: an unapproved host:port is rejected", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv({
    ...FULL_APPROVALS,
    PG_REMOTE_ALLOWED_HOSTS: "other-db.example.co:5432"
  }));
  assertRefusedWithoutConnecting(res, /PG_REMOTE_ALLOWED_HOSTS/);
});

test("db:migrate: an unapproved database is rejected", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv({
    ...FULL_APPROVALS,
    PG_REMOTE_ALLOWED_DATABASES: "some_other_db"
  }));
  assertRefusedWithoutConnecting(res, /PG_REMOTE_ALLOWED_DATABASES/);
});

test("db:migrate: DATABASE_URL cannot bypass the gate (its presence is refused)", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv({
    ...FULL_APPROVALS,
    DATABASE_URL: "postgres://user:pass@evil.example.co:5432/other"
  }));
  assertRefusedWithoutConnecting(res, /DATABASE_URL/);
  assert.ok(!res.stderr.includes("evil.example.co") || !/pass@/.test(res.stderr), "URL credentials must never be echoed");
});

test("db:migrate: invalid TLS configuration refuses before connecting", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv({ ...FULL_APPROVALS, PG_SSL: "garbage" }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /Unsupported PG_SSL/);
  assert.ok(!CONNECT_ATTEMPT.test(res.stderr), `must fail before any connection:\n${res.stderr}`);
  assert.ok(!res.stderr.includes(PASS_SENTINEL));
});

test("db:migrate: a fully approved target is ATTEMPTED (gate passes; local ECONNREFUSED only)", () => {
  const res = run("migrate.js", ["--confirm-remote"], baseEnv(FULL_APPROVALS));
  assert.equal(res.code, 1, "connection to the refused local port still fails — expected");
  assert.doesNotMatch(res.stderr, /REFUSED:/, "the gate must NOT refuse a fully approved target");
  assert.match(res.stderr, /ECONNREFUSED/, "proves the connection was attempted only after full approval");
  assert.ok(!res.stderr.includes(PASS_SENTINEL));
});

// ---------- admin:role ----------

test("admin:role: unapproved remote target refuses before any connection", () => {
  const res = run("admin-role.js", ["--email", "someone@example.com", "--role", "admin", "--confirm-remote"], baseEnv({}));
  assertRefusedWithoutConnecting(res, /PG_REMOTE_MIGRATION_APPROVED/);
});

// ---------- db:restore ----------

test("db:restore: unapproved remote target refuses before any connection", () => {
  const res = run("db-restore.js", ["--target", "buyo_sandbox_20261019", "--confirm-remote"], baseEnv({}));
  assertRefusedWithoutConnecting(res, /PG_REMOTE_MIGRATION_APPROVED/);
});

// ---------- db:backup ----------

test("db:backup: --allow-remote ALONE is no longer enough for PostgreSQL", () => {
  const res = run("db-backup.js", ["--allow-remote"], baseEnv({}));
  assertRefusedWithoutConnecting(res, /PG_REMOTE_MIGRATION_APPROVED/);
  assert.match(res.stderr, /BOTH --allow-remote AND every approval gate condition/);
});

test("db:backup: --allow-remote + full gate passes the gate (attempted; local ECONNREFUSED only)", () => {
  const res = run("db-backup.js", ["--allow-remote", "--confirm-remote"], baseEnv(FULL_APPROVALS));
  assert.equal(res.code, 1, "connection to the refused local port still fails — expected");
  assert.doesNotMatch(res.stderr, /REFUSED:/);
  assert.match(res.stderr, /ECONNREFUSED/);
  assert.ok(!res.stderr.includes(PASS_SENTINEL));
});

// ---------- MySQL protections unchanged ----------

test("db:backup (MySQL): non-loopback still refuses without --allow-remote — behavior unchanged", () => {
  const res = run("db-backup.js", [], baseEnv({
    DB_DIALECT: "mysql",
    MYSQL_HOST: "db.example.com",
    MYSQL_DB: "buyo_prod"
  }));
  assert.equal(res.code, 1);
  assert.match(res.stderr, /REFUSED:/);
  assert.match(res.stderr, /--allow-remote/);
  assert.ok(!CONNECT_ATTEMPT.test(res.stderr), `must fail before any connection:\n${res.stderr}`);
});
