// test/dialect.test.js
// Migration Phase 1: dual-dialect resolution tests.
//
// These are DB-FREE unit tests: they call the pure resolver functions with
// explicit env objects and never open a connection. Their job is to lock down
// the two promises of this phase:
//   1. MySQL stays the DEFAULT: DB_DIALECT unset behaves exactly like before.
//   2. PostgreSQL is an explicit, validated opt-in (DB_DIALECT=postgres).

const { test } = require("node:test");
const assert = require("node:assert/strict");

const {
  resolveDialect,
  resolveMysqlSettings,
  resolvePostgresSettings,
  resolveSettings,
  getSequelizeOptions,
  getMysql2Options,
  sslRejectUnauthorized,
  isLoopbackHost
} = require("../config/dbConnectionOptions");

// ---------- dialect selection ----------

test("resolveDialect: unset DB_DIALECT defaults to mysql (pre-Phase-1 behavior)", () => {
  assert.equal(resolveDialect({}), "mysql");
  assert.equal(resolveDialect({ DB_DIALECT: "" }), "mysql");
  assert.equal(resolveDialect({ DB_DIALECT: "   " }), "mysql");
});

test("resolveDialect: explicit values are honored case-insensitively", () => {
  assert.equal(resolveDialect({ DB_DIALECT: "mysql" }), "mysql");
  assert.equal(resolveDialect({ DB_DIALECT: "MySQL" }), "mysql");
  assert.equal(resolveDialect({ DB_DIALECT: "postgres" }), "postgres");
  assert.equal(resolveDialect({ DB_DIALECT: "PostgreSQL" }), "postgres");
  assert.equal(resolveDialect({ DB_DIALECT: "postgresql" }), "postgres");
});

test("resolveDialect: unknown values throw instead of silently defaulting", () => {
  assert.throws(() => resolveDialect({ DB_DIALECT: "sqlite" }), /Unsupported DB_DIALECT/);
  assert.throws(() => resolveDialect({ DB_DIALECT: "pg" }), /Unsupported DB_DIALECT/);
  assert.throws(() => resolveDialect({ DB_DIALECT: "mariadb" }), /Unsupported DB_DIALECT/);
});

// ---------- MySQL settings unchanged ----------

test("resolveMysqlSettings: unchanged mapping of MYSQL_* names", () => {
  const settings = resolveMysqlSettings({
    MYSQL_HOST: "localhost",
    MYSQL_PORT: "3307",
    MYSQL_DB: "buyoDB",
    MYSQL_USER: "root",
    MYSQL_PASS: "secret",
    MYSQL_SSL: "true"
  });
  assert.deepEqual(settings, {
    host: "localhost",
    port: 3307,
    database: "buyoDB",
    username: "root",
    password: "secret",
    ssl: true
  });
});

test("resolveMysqlSettings: hosted-provider fallbacks still work", () => {
  const settings = resolveMysqlSettings({
    MYSQLHOST: "db.example.internal",
    MYSQLPORT: "3306",
    MYSQLDATABASE: "railwaydb",
    MYSQLUSER: "railwayuser",
    MYSQLPASSWORD: "railwaypass"
  });
  assert.equal(settings.host, "db.example.internal");
  assert.equal(settings.database, "railwaydb");
  assert.equal(settings.username, "railwayuser");
  assert.equal(settings.password, "railwaypass");
});

test("resolveMysqlSettings: default port 3306, no password resolves to undefined (unchanged pre-Phase-1 behavior)", () => {
  const settings = resolveMysqlSettings({});
  assert.equal(settings.port, 3306);
  // firstDefined skips empty strings, so an all-unset password stays undefined —
  // this matches the pre-Phase-1 implementation exactly.
  assert.equal(settings.password, undefined);
  assert.equal(settings.ssl, false);
});

// ---------- PostgreSQL settings (new) ----------

test("resolvePostgresSettings: PG_* mapping with 5432 default", () => {
  const settings = resolvePostgresSettings({
    PG_HOST: "127.0.0.1",
    PG_PORT: "5433",
    PG_DB: "buyoDB_ph2_test",
    PG_USER: "postgres",
    PG_PASS: "harness"
  });
  assert.deepEqual(settings, {
    host: "127.0.0.1",
    port: 5433,
    database: "buyoDB_ph2_test",
    username: "postgres",
    password: "harness"
  });
});

test("resolvePostgresSettings: defaults (port 5432, unset password is undefined)", () => {
  const settings = resolvePostgresSettings({});
  assert.equal(settings.port, 5432);
  assert.equal(settings.password, undefined);
});

test("resolvePostgresSettings: NEVER reads DATABASE_URL (Supabase boundary)", () => {
  // Phase 1 must not derive Postgres settings from DATABASE_URL — that is a
  // later, separately-approved phase. A DATABASE_URL-only env must yield no
  // host/database at all.
  const settings = resolvePostgresSettings({
    DATABASE_URL: "postgres://user:pass@supabase.internal:5432/buyo"
  });
  assert.equal(settings.host, undefined);
  assert.equal(settings.database, undefined);
  assert.equal(settings.username, undefined);
});

// ---------- Sequelize options ----------

test("getSequelizeOptions: default is MySQL with no SSL block (unchanged)", () => {
  const options = getSequelizeOptions({ MYSQL_HOST: "localhost", MYSQL_DB: "buyoDB" });
  assert.equal(options.dialect, "mysql");
  assert.equal(options.host, "localhost");
  assert.equal("dialectOptions" in options, false);
});

test("getSequelizeOptions: MySQL SSL opt-in keeps verified-by-default TLS", () => {
  const verified = getSequelizeOptions({ MYSQL_SSL: "true" });
  assert.equal(verified.dialectOptions.ssl.rejectUnauthorized, true);
  const optedOut = getSequelizeOptions({ MYSQL_SSL: "true", MYSQL_SSL_REJECT_UNAUTHORIZED: "false" });
  assert.equal(optedOut.dialectOptions.ssl.rejectUnauthorized, false);
});

test("getSequelizeOptions: DB_DIALECT=postgres switches dialect and skips MySQL SSL", () => {
  const options = getSequelizeOptions({
    DB_DIALECT: "postgres",
    PG_HOST: "127.0.0.1",
    PG_PORT: "5433",
    MYSQL_SSL: "true" // MySQL knob must not leak into the postgres path
  });
  assert.equal(options.dialect, "postgres");
  assert.equal(options.host, "127.0.0.1");
  assert.equal(options.port, 5433);
  assert.equal("dialectOptions" in options, false);
});

test("getSequelizeOptions: DB_DIALECT=postgres ignores MYSQL_* host/db", () => {
  const options = getSequelizeOptions({
    DB_DIALECT: "postgres",
    PG_HOST: "127.0.0.1",
    MYSQL_HOST: "mysql-host",
    MYSQL_PORT: "3306"
  });
  assert.equal(options.host, "127.0.0.1");
  assert.notEqual(options.host, "mysql-host");
});

// ---------- routing helper + preserved utilities ----------

test("resolveSettings: routes by dialect", () => {
  assert.equal(resolveSettings({ MYSQL_DB: "buyoDB" }).database, "buyoDB");
  assert.equal(
    resolveSettings({ DB_DIALECT: "postgres", PG_DB: "buyoDB_ph2_test" }).database,
    "buyoDB_ph2_test"
  );
});

test("getMysql2Options: unchanged raw mysql2 mapping (scripts depend on it)", () => {
  const options = getMysql2Options({
    MYSQL_HOST: "localhost",
    MYSQL_PORT: "3306",
    MYSQL_DB: "buyoDB",
    MYSQL_USER: "root",
    MYSQL_PASS: "secret"
  });
  assert.deepEqual(options, {
    host: "localhost",
    port: 3306,
    user: "root",
    password: "secret",
    database: "buyoDB"
  });
});

test("getMysql2Options: includeDatabase=false omits the database (migrate use)", () => {
  const { resolveMysqlSettings: r } = require("../config/dbConnectionOptions");
  const options = require("../config/dbConnectionOptions").toMysql2Options(
    r({ MYSQL_HOST: "localhost", MYSQL_USER: "root" }),
    { includeDatabase: false }
  );
  assert.equal("database" in options, false);
});

test("sslRejectUnauthorized: verified by default, explicit opt-out only", () => {
  assert.equal(sslRejectUnauthorized({}), true);
  assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "" }), true);
  assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "true" }), true);
  assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "false" }), false);
  assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "0" }), false);
  assert.equal(sslRejectUnauthorized({ MYSQL_SSL_REJECT_UNAUTHORIZED: "no" }), false);
});

test("isLoopbackHost: unchanged loopback detection (guards reuse it)", () => {
  assert.equal(isLoopbackHost("localhost"), true);
  assert.equal(isLoopbackHost("127.0.0.1"), true);
  assert.equal(isLoopbackHost("::1"), true);
  assert.equal(isLoopbackHost("[::1]"), true);
  assert.equal(isLoopbackHost("db.example.com"), false);
  assert.equal(isLoopbackHost(""), false);
  assert.equal(isLoopbackHost(undefined), false);
});
