// test/pgRuntime.test.js — Phase 9: PostgreSQL production-runtime resolution.
//
// Pure env-parsing tests (no database, no server): TLS defaults, explicit
// PG_SSL handling, the hardcoded certificate-verification posture, the small
// serverless pool, and the "no connection at module import" guarantee of
// config/db.js (checked in a subprocess). MySQL behavior assertions guard
// against regressions from the shared module.
const test = require("node:test");
const assert = require("node:assert");
const path = require("node:path");
const { execFileSync } = require("node:child_process");

const {
  resolvePostgresSettings,
  resolvePgSslSetting,
  resolvePoolOptions,
  getSequelizeOptions,
  intFromEnvSetting
} = require("../config/dbConnectionOptions");
const { pgClientOptions } = require("../scripts/lib/pgClientOptions");

// ---------- TLS defaults (auto rule) ----------

test("PG TLS: loopback stays plaintext; anything else is treated as hosted (TLS on)", () => {
  for (const host of ["127.0.0.1", "localhost", "::1", "[::1]"]) {
    assert.equal(resolvePostgresSettings({ PG_HOST: host }).ssl, false, `loopback ${host}`);
  }
  assert.equal(resolvePostgresSettings({ PG_HOST: "db.example.supabase.co" }).ssl, true, "hosted host");
  // Unset/unknown host counts as hosted — the secure default.
  assert.equal(resolvePostgresSettings({}).ssl, true, "no host configured");
  assert.equal(resolvePostgresSettings({ PG_HOST: "" }).ssl, true, "empty host configured");
  // Hosted-style fallback names follow the same rule.
  assert.equal(resolvePostgresSettings({ PGDBHOST: "db.internal.example" }).ssl, true);
});

test("PG_SSL: explicit values override the auto rule; garbage refuses to resolve", () => {
  // Forced on (e.g. a TLS-terminating local tunnel)
  assert.equal(resolvePgSslSetting("127.0.0.1", { PG_SSL: "true" }), true);
  assert.equal(resolvePgSslSetting("127.0.0.1", { PG_SSL: "TRUE" }), true);
  assert.equal(resolvePgSslSetting("127.0.0.1", { PG_SSL: "yes" }), true);
  // Forced off (e.g. a plaintext SSH tunnel to a hosted DB)
  assert.equal(resolvePgSslSetting("db.example.co", { PG_SSL: "false" }), false);
  assert.equal(resolvePgSslSetting("db.example.co", { PG_SSL: "0" }), false);
  // Invalid values throw — a typo must never silently pick a mode.
  assert.throws(() => resolvePgSslSetting("db.example.co", { PG_SSL: "maybe" }), /Unsupported PG_SSL/);
  assert.throws(() => resolvePgSslSetting("127.0.0.1", { PG_SSL: "on" }), /Unsupported PG_SSL/);
  // Settings-level integration
  assert.equal(resolvePostgresSettings({ PG_HOST: "db.example.co", PG_SSL: "false" }).ssl, false);
});

// ---------- TLS verification posture ----------

test("PG TLS always verifies certificates — no rejectUnauthorized:false knob exists", () => {
  const options = getSequelizeOptions({
    DB_DIALECT: "postgres",
    PG_HOST: "db.example.co",
    PG_SSL: "true"
  });
  assert.deepEqual(options.dialectOptions.ssl, { rejectUnauthorized: true });

  // The MySQL opt-out knob must never leak into the PG path.
  const poisoned = getSequelizeOptions({
    DB_DIALECT: "postgres",
    PG_HOST: "db.example.co",
    PG_SSL: "true",
    MYSQL_SSL: "true",
    MYSQL_SSL_REJECT_UNAUTHORIZED: "false"
  });
  assert.equal(poisoned.dialectOptions.ssl.rejectUnauthorized, true);
});

test("PG path: no dialectOptions at all when TLS is off (loopback default)", () => {
  const options = getSequelizeOptions({ DB_DIALECT: "postgres", PG_HOST: "127.0.0.1" });
  assert.equal("dialectOptions" in options, false);
});

// ---------- Serverless pool ----------

test("pool: small serverless defaults on the PG path; env overrides honored", () => {
  const defaults = resolvePoolOptions({});
  assert.deepEqual(defaults, { max: 2, min: 0, idle: 10000, acquire: 30000 });

  const overridden = resolvePoolOptions({
    DB_POOL_MAX: "4",
    DB_POOL_MIN: "1",
    DB_POOL_IDLE_MS: "5000",
    DB_POOL_ACQUIRE_MS: "15000"
  });
  assert.deepEqual(overridden, { max: 4, min: 1, idle: 5000, acquire: 15000 });

  const options = getSequelizeOptions({
    DB_DIALECT: "postgres",
    PG_HOST: "127.0.0.1",
    DB_POOL_MAX: "3"
  });
  assert.equal(options.pool.max, 3);
});

test("pool: invalid configuration refuses to resolve (fail fast, name-only errors)", () => {
  assert.throws(() => resolvePoolOptions({ DB_POOL_MAX: "0" }), /DB_POOL_MAX must be an integer between 1 and 10/);
  assert.throws(() => resolvePoolOptions({ DB_POOL_MAX: "abc" }), /DB_POOL_MAX/);
  assert.throws(() => resolvePoolOptions({ DB_POOL_MAX: "11" }), /DB_POOL_MAX/);
  // min is implicitly capped at max
  assert.throws(() => resolvePoolOptions({ DB_POOL_MAX: "2", DB_POOL_MIN: "5" }), /DB_POOL_MIN/);
  assert.throws(() => resolvePoolOptions({ DB_POOL_IDLE_MS: "abc" }), /DB_POOL_IDLE_MS/);
  assert.throws(() => resolvePoolOptions({ DB_POOL_ACQUIRE_MS: "0" }), /DB_POOL_ACQUIRE_MS/);
  // Boundary-valid values resolve fine.
  assert.equal(resolvePoolOptions({ DB_POOL_MAX: "10" }).max, 10);
  assert.equal(resolvePoolOptions({ DB_POOL_MIN: "0", DB_POOL_MAX: "1" }).min, 0);
});

// ---------- MySQL behavior preserved ----------

test("MySQL path: settings and Sequelize options unchanged (no pool, no ssl block)", () => {
  const options = getSequelizeOptions({ MYSQL_HOST: "localhost", MYSQL_DB: "buyoDB" });
  assert.equal(options.dialect, "mysql");
  assert.equal("pool" in options, false, "MySQL keeps Sequelize's default pool");
  assert.equal("dialectOptions" in options, false);
});

// ---------- No connection at module import ----------

test("config/db.js opens no connection at import (serverless cold-start guarantee)", () => {
  // Port 1 on loopback: nothing ever listens there. The OLD module-load
  // probe would have attempted a connection and printed "Connection Failed";
  // the Phase 9 module must load silently and exit cleanly.
  const dbModule = path.join(__dirname, "..", "config", "db.js");
  const script = `
    process.env.DB_DIALECT = "postgres";
    process.env.PG_HOST = "127.0.0.1";
    process.env.PG_PORT = "1";
    process.env.PG_DB = "buyoDB";
    process.env.PG_USER = "postgres";
    require(${JSON.stringify(dbModule)});
    console.log("MODULE_LOADED");
  `;
  const out = execFileSync(process.execPath, ["-e", script], { encoding: "utf8", timeout: 15000 });
  assert.match(out, /MODULE_LOADED/);
  assert.doesNotMatch(out, /Connection Failed/);
});

// ---------- shared integer reader (used by health route too) ----------

test("intFromEnvSetting: defaults, ranges and strict validation", () => {
  assert.equal(intFromEnvSetting({}, "X_TIMEOUT_MS", 2000, 100, 30000), 2000);
  assert.equal(intFromEnvSetting({ X_TIMEOUT_MS: "" }, "X_TIMEOUT_MS", 2000, 100, 30000), 2000);
  assert.equal(intFromEnvSetting({ X_TIMEOUT_MS: " 2500 " }, "X_TIMEOUT_MS", 2000, 100, 30000), 2500);
  assert.throws(() => intFromEnvSetting({ X_TIMEOUT_MS: "50" }, "X_TIMEOUT_MS", 2000, 100, 30000), /X_TIMEOUT_MS/);
  assert.throws(() => intFromEnvSetting({ X_TIMEOUT_MS: "30001" }, "X_TIMEOUT_MS", 2000, 100, 30000), /X_TIMEOUT_MS/);
  assert.throws(() => intFromEnvSetting({ X_TIMEOUT_MS: "abc" }, "X_TIMEOUT_MS", 2000, 100, 30000), /X_TIMEOUT_MS/);
  assert.throws(() => intFromEnvSetting({ X_TIMEOUT_MS: "1.5" }, "X_TIMEOUT_MS", 2000, 100, 30000), /X_TIMEOUT_MS/);
});

// ---------- Phase 10: CLI client options (TLS threading) ----------

test("pgClientOptions: hosted targets get verified TLS; loopback stays byte-identical (no ssl key)", () => {
  const loopback = pgClientOptions({
    host: "127.0.0.1", port: 5433, username: "postgres", password: "x", database: "buyoDB"
  });
  assert.deepEqual(loopback, {
    host: "127.0.0.1", port: 5433, user: "postgres", password: "x", database: "buyoDB"
  });
  assert.equal("ssl" in loopback, false, "loopback plaintext — embedded-PostgreSQL behavior unchanged");

  const hosted = pgClientOptions({
    host: "db.example.co", port: 5432, username: "u", password: "p", database: "d", ssl: true
  });
  assert.deepEqual(hosted.ssl, { rejectUnauthorized: true }, "verification always on — no bypass exists");

  // explicit override of the target database (maintenance connections)
  const maintenance = pgClientOptions(
    { host: "db.example.co", port: 5432, username: "u", password: "p", database: "d", ssl: true },
    "postgres"
  );
  assert.equal(maintenance.database, "postgres");
  assert.deepEqual(maintenance.ssl, { rejectUnauthorized: true });
});

// Supabase hosts pin the official root as an EXTRA anchor (the production
// certificate chain is private-rooted: a bare verify fails with
// SELF_SIGNED_CERT_IN_CHAIN before authentication). Verification stays fully
// enabled; look-alike hostnames must never receive the pinned CA.
test("pgClientOptions: Supabase hosts get the pinned root CA + rejectUnauthorized:true; look-alikes do not", () => {
  const SUPABASE_ROOT_CA = require("../config/supabaseRootCa");
  const supabase = pgClientOptions({
    host: "db.example-project.supabase.co", port: 5432, username: "u", password: "p", database: "d", ssl: true
  });
  assert.deepEqual(
    supabase.ssl,
    { rejectUnauthorized: true, ca: [SUPABASE_ROOT_CA] },
    "extra trust anchor added — verification itself unchanged and still ON"
  );
  const lookalike = pgClientOptions({
    host: "supabase.co.attacker.example", port: 5432, username: "u", password: "p", database: "d", ssl: true
  });
  assert.deepEqual(lookalike.ssl, { rejectUnauthorized: true }, "suffix-anchored match only — no CA for look-alikes");
  const loopback = pgClientOptions({ host: "127.0.0.1", port: 5433, username: "u", password: "p", database: "d" });
  assert.equal("ssl" in loopback, false, "loopback untouched by the CA logic");
});
