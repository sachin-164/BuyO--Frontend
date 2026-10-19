// test/remoteMigrationGate.test.js — Phase 9: the future remote-migration
// approval contract (scripts/lib/remoteTargetGate.js).
//
// The gate is design-contract only: the migration runner remains loopback-only
// (pinned by test/pgMigrations.test.js and test/migrations.test.js), and this
// suite pins the gate's refusal-by-default, target-identity validation and
// credential-silence guarantees. Pure function — no database, no network.
const test = require("node:test");
const assert = require("node:assert");

const {
  evaluateRemoteTarget,
  APPROVAL_ENV,
  APPROVAL_TOKEN,
  HOSTS_ENV,
  DATABASES_ENV
} = require("../scripts/lib/remoteTargetGate");

const REMOTE_SETTINGS = { host: "db.example.supabase.co", port: 5432, database: "buyo_prod" };

function fullyApprovedEnv(overrides = {}) {
  return {
    [APPROVAL_ENV]: APPROVAL_TOKEN,
    [HOSTS_ENV]: "db.example.supabase.co:5432",
    [DATABASES_ENV]: "buyo_prod",
    ...overrides
  };
}

const REMOTE_FLAGS = new Set(["--confirm-remote"]);

test("refusal by default: no env, no flag, nothing approved", () => {
  const result = evaluateRemoteTarget({ settings: REMOTE_SETTINGS });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes(APPROVAL_ENV)), "names the missing approval token");
  assert.ok(result.reasons.some((r) => r.includes("--confirm-remote")), "names the missing flag");
  assert.ok(result.reasons.some((r) => r.includes(HOSTS_ENV)), "names the empty host allowlist");
  assert.ok(result.reasons.some((r) => r.includes(DATABASES_ENV)), "names the empty database allowlist");
});

test("missing --confirm-remote refuses even when everything else is approved", () => {
  const result = evaluateRemoteTarget({ env: fullyApprovedEnv(), settings: REMOTE_SETTINGS });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes("missing --confirm-remote flag")));
});

test("missing/wrong approval token refuses even with flag + allowlists set", () => {
  const noToken = evaluateRemoteTarget({
    env: fullyApprovedEnv({ [APPROVAL_ENV]: "" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(noToken.allowed, false);

  const wrongToken = evaluateRemoteTarget({
    env: fullyApprovedEnv({ [APPROVAL_ENV]: "yes-i-am-sure" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(wrongToken.allowed, false);
});

test("unapproved target: host:port and database must both match pre-declared values exactly", () => {
  const hostMismatch = evaluateRemoteTarget({
    env: fullyApprovedEnv({ [HOSTS_ENV]: "other-db.example.co:5432" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(hostMismatch.allowed, false);
  assert.ok(hostMismatch.reasons.some((r) => r.includes(`${HOSTS_ENV}`)));

  const portMismatch = evaluateRemoteTarget({
    env: fullyApprovedEnv({ [HOSTS_ENV]: "db.example.supabase.co:6543" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(portMismatch.allowed, false);

  const dbMismatch = evaluateRemoteTarget({
    env: fullyApprovedEnv({ [DATABASES_ENV]: "buyo_staging" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(dbMismatch.allowed, false);
  assert.ok(dbMismatch.reasons.some((r) => r.includes('"buyo_prod" is not in')));
});

test("production environment is always refused", () => {
  const result = evaluateRemoteTarget({
    env: fullyApprovedEnv({ NODE_ENV: "production" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes("NODE_ENV=production")));
});

test("loopback targets are refused here — they belong to the --confirm-local flow", () => {
  const result = evaluateRemoteTarget({
    env: fullyApprovedEnv({
      [HOSTS_ENV]: "127.0.0.1:5432",
      [DATABASES_ENV]: "buyoDB"
    }),
    flags: REMOTE_FLAGS,
    settings: { host: "127.0.0.1", port: 5432, database: "buyoDB" }
  });
  assert.equal(result.allowed, false);
  assert.ok(result.reasons.some((r) => r.includes("loopback")));
});

test("invalid target configuration is refused with precise reasons", () => {
  const noHost = evaluateRemoteTarget({ env: fullyApprovedEnv(), flags: REMOTE_FLAGS, settings: { port: 5432, database: "buyo_prod" } });
  assert.equal(noHost.allowed, false);
  assert.ok(noHost.reasons.some((r) => r.includes("no database host configured")));

  for (const port of [0, 70000, "abc", undefined]) {
    const badPort = evaluateRemoteTarget({
      env: fullyApprovedEnv(),
      flags: REMOTE_FLAGS,
      settings: { ...REMOTE_SETTINGS, port }
    });
    assert.equal(badPort.allowed, false, `port ${port} must be refused`);
    assert.ok(badPort.reasons.some((r) => r.includes("port")), `port ${port} reason`);
  }

  const noDb = evaluateRemoteTarget({ env: fullyApprovedEnv(), flags: REMOTE_FLAGS, settings: { host: REMOTE_SETTINGS.host, port: 5432 } });
  assert.equal(noDb.allowed, false);
  assert.ok(noDb.reasons.some((r) => r.includes("no database name configured")));
});

test("DATABASE_URL can never enable or bypass the gate — its presence is itself refused", () => {
  // Fully approved WITHOUT the URL -> allowed (contract positive case).
  const clean = evaluateRemoteTarget({ env: fullyApprovedEnv(), flags: REMOTE_FLAGS, settings: REMOTE_SETTINGS });
  assert.equal(clean.allowed, true, "fully approved target evaluates to allowed (contract only)");

  // Same config, DATABASE_URL present -> refused (tripwire).
  const withUrl = evaluateRemoteTarget({
    env: fullyApprovedEnv({ DATABASE_URL: "postgres://user:pass@evil.example.co:5432/other" }),
    flags: REMOTE_FLAGS,
    settings: REMOTE_SETTINGS
  });
  assert.equal(withUrl.allowed, false);
  assert.ok(withUrl.reasons.some((r) => r.includes("DATABASE_URL")));

  // A DATABASE_URL-only environment resolves nothing: no host/database/credentials
  // are ever taken from it (the target stays empty and unapproved).
  const urlOnly = evaluateRemoteTarget({
    env: { DATABASE_URL: "postgres://user:pass@evil.example.co:5432/other" },
    flags: REMOTE_FLAGS,
    settings: { port: 5432 }
  });
  assert.equal(urlOnly.allowed, false);
});

test("refusal reasons never contain usernames or passwords", () => {
  const result = evaluateRemoteTarget({
    env: fullyApprovedEnv({ NODE_ENV: "production", DATABASE_URL: "postgres://leak:leakpass@x/leakdb" }),
    flags: REMOTE_FLAGS,
    settings: { ...REMOTE_SETTINGS, username: "svc_buyo_migration", password: "Sup3rS3cret-Pass!" }
  });
  assert.equal(result.allowed, false);
  const text = JSON.stringify(result.reasons);
  assert.ok(!text.includes("svc_buyo_migration"), "username must never be echoed");
  assert.ok(!text.includes("Sup3rS3cret-Pass!"), "password must never be echoed");
  assert.ok(!text.includes("leakpass"), "credentials from DATABASE_URL must never be echoed");
});
