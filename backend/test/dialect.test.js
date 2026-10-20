// test/dialect.test.js
// Migration Phase 1: dual-dialect resolution tests.
//
// These are DB-FREE unit tests: they call the pure resolver functions with
// explicit env objects and never open a connection. Their job is to lock down
// the promises of this phase:
//   1. MySQL stays the DEFAULT: DB_DIALECT unset behaves exactly like before
//      (a stray DATABASE_URL never flips the dialect — no inference).
//   2. PostgreSQL is an explicit, validated opt-in (DB_DIALECT=postgres).
//   3. On the PostgreSQL path, DATABASE_URL (approved Supabase phase) fills
//      what the explicit PG_* names leave unset — the names always win, URLs
//      are validated without ever echoing their contents, and TLS certificate
//      verification stays hardcoded on.
//   4. TLS to Supabase endpoints trusts ONLY the official Supabase Root 2021
//      CA (Phase 11, fingerprint-pinned public certificate) with verification
//      fully ON; non-Supabase hosts and the MySQL path are untouched.

const { test } = require("node:test");
const assert = require("node:assert/strict");
const { X509Certificate } = require("node:crypto");

const {
  resolveDialect,
  resolveMysqlSettings,
  parsePostgresUrl,
  resolvePostgresSettings,
  resolveSettings,
  getSequelizeOptions,
  getMysql2Options,
  sslRejectUnauthorized,
  isLoopbackHost,
  isSupabaseHost
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

test("resolveDialect: a DATABASE_URL alone never flips the dialect (no inference)", () => {
  // MySQL stays the default until DB_DIALECT is EXPLICITLY set: a stray
  // DATABASE_URL (e.g. a leftover line in backend/.env) must never silently
  // retarget local development or the test harness at a hosted database.
  assert.equal(resolveDialect({ DATABASE_URL: "postgresql://u:p@db.example.com:5432/x" }), "mysql");
  assert.equal(resolveDialect({ DATABASE_URL: "postgres://u:p@db.example.com:5432/x" }), "mysql");
  assert.equal(resolveDialect({ DB_DIALECT: "mysql", DATABASE_URL: "postgresql://u:p@db.example.com:5432/x" }), "mysql");
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
    password: "harness",
    ssl: false // Phase 9: loopback stays plaintext by default (auto rule)
  });
});

test("resolvePostgresSettings: defaults (port 5432, unset password is undefined)", () => {
  const settings = resolvePostgresSettings({});
  assert.equal(settings.port, 5432);
  assert.equal(settings.password, undefined);
});

// ---------- DATABASE_URL on the PostgreSQL path (approved Supabase phase) ----------

// All hosts below are FAKE, documentation-style values: these are pure
// resolver tests that never open a connection (no real Supabase endpoint is
// ever contacted by this suite).

const POOLER_URL =
  "postgresql://postgres.aaaaaaaaaaaa:pool%40pass%21word@aws-0-example-1.pooler.supabase.com:6543/postgres";

test("parsePostgresUrl: Supabase transaction-pooler shape with percent-encoded password", () => {
  const parsed = parsePostgresUrl(POOLER_URL);
  assert.deepEqual(parsed, {
    host: "aws-0-example-1.pooler.supabase.com",
    port: 6543,
    database: "postgres",
    username: "postgres.aaaaaaaaaaaa",
    password: "pool@pass!word" // percent-decoded
  });
});

test("parsePostgresUrl: absent/empty -> null (not an error)", () => {
  assert.equal(parsePostgresUrl(undefined), null);
  assert.equal(parsePostgresUrl(null), null);
  assert.equal(parsePostgresUrl(""), null);
  assert.equal(parsePostgresUrl("   "), null);
});

test("parsePostgresUrl: unencoded special characters in the password (brackets, @) parse", () => {
  // Real pooler passwords can contain an unencoded @ inside brackets; the
  // WHATWG parser splits userinfo at the LAST @, so this must round-trip.
  const parsed = parsePostgresUrl("postgresql://postgres.ref1:[abc[def@ghi]]@db.example.com:6543/postgres");
  assert.equal(parsed.username, "postgres.ref1");
  assert.equal(parsed.password, "[abc[def@ghi]]");
  assert.equal(parsed.host, "db.example.com");
  assert.equal(parsed.port, 6543);
});

test("parsePostgresUrl: wrong scheme throws (name only, value never echoed)", () => {
  assert.throws(() => parsePostgresUrl("mysql://user:secret@db.example.com/buyo"), /DATABASE_URL must use the postgresql/);
  assert.throws(() => parsePostgresUrl("not a url at all"), /DATABASE_URL must use the postgresql/);
});

test("parsePostgresUrl: malformed URL throws a clean error that never echoes the value", () => {
  let captured = null;
  try {
    parsePostgresUrl("postgresql://user:supersecret%zz@host:5432/db");
  } catch (err) {
    captured = err;
  }
  assert.ok(captured, "must throw");
  assert.match(captured.message, /DATABASE_URL/);
  assert.ok(!captured.message.includes("supersecret"), "password must never appear in the error");
  assert.ok(!captured.message.includes("postgresql://"), "the URL must never appear in the error");

  assert.throws(() => parsePostgresUrl("postgresql://user:pa%zz@host:5432/db"), /invalid percent-encoding/);
});

test("parsePostgresUrl: no port -> undefined (defaults applied by the resolver)", () => {
  assert.equal(parsePostgresUrl("postgresql://user:pass@db.example.com/buyo").port, undefined);
  // postgres:// alias scheme is accepted too
  assert.equal(parsePostgresUrl("postgres://user:pass@db.example.com:5432/buyo").port, 5432);
});

test("resolvePostgresSettings: DATABASE_URL fills what the PG_* names leave unset", () => {
  const settings = resolvePostgresSettings({ DATABASE_URL: POOLER_URL });
  assert.equal(settings.host, "aws-0-example-1.pooler.supabase.com");
  assert.equal(settings.port, 6543);
  assert.equal(settings.database, "postgres");
  assert.equal(settings.username, "postgres.aaaaaaaaaaaa");
  assert.equal(settings.password, "pool@pass!word");
  // Non-loopback host -> automatic TLS (certificate verification stays on)
  assert.equal(settings.ssl, true);
});

test("resolvePostgresSettings: explicit PG_* names always WIN over DATABASE_URL", () => {
  // The local loopback harness must be unaffected even when backend/.env
  // carries a DATABASE_URL line.
  const settings = resolvePostgresSettings({
    PG_HOST: "127.0.0.1",
    PG_PORT: "5433",
    PG_DB: "buyoDB_ph2_test",
    PG_USER: "postgres",
    PG_PASS: "harness",
    DATABASE_URL: POOLER_URL
  });
  assert.deepEqual(settings, {
    host: "127.0.0.1",
    port: 5433,
    database: "buyoDB_ph2_test",
    username: "postgres",
    password: "harness",
    ssl: false // loopback stays plaintext (automatic rule)
  });
});

test("resolvePostgresSettings: URL fills only the missing fields (mixed sources)", () => {
  const settings = resolvePostgresSettings({
    PG_DB: "buyoDB_ph2_test", // explicit name wins for the database
    DATABASE_URL: POOLER_URL
  });
  assert.equal(settings.database, "buyoDB_ph2_test");
  assert.equal(settings.host, "aws-0-example-1.pooler.supabase.com");
  assert.equal(settings.port, 6543);
});

test("resolvePostgresSettings: URL without port defaults to 5432", () => {
  const settings = resolvePostgresSettings({
    DATABASE_URL: "postgresql://user:pass@db.example.com/buyo"
  });
  assert.equal(settings.port, 5432);
});

test("resolvePostgresSettings: sslmode query parameters are ignored (PG_SSL stays the knob)", () => {
  const auto = resolvePostgresSettings({
    DATABASE_URL: "postgresql://user:pass@db.example.com:5432/buyo?sslmode=disable"
  });
  assert.equal(auto.ssl, true, "a sslmode=disable query param must NOT weaken TLS");
  const forced = resolvePostgresSettings({
    PG_SSL: "true",
    DATABASE_URL: "postgresql://user:pass@127.0.0.1:5432/buyo?sslmode=disable"
  });
  assert.equal(forced.ssl, true, "PG_SSL=true still forces TLS");
});

test("getSequelizeOptions: explicit postgres + URL-only env builds a verified-TLS postgres client", () => {
  const options = getSequelizeOptions({ DB_DIALECT: "postgres", DATABASE_URL: POOLER_URL });
  assert.equal(options.dialect, "postgres");
  assert.equal(options.host, "aws-0-example-1.pooler.supabase.com");
  assert.equal(options.port, 6543);
  // Certificate verification is hardcoded on — no knob exists to weaken it.
  assert.equal(options.dialectOptions.ssl.rejectUnauthorized, true);
});

// ---------- Supabase root CA trust (Phase 11) ----------

// Public certificate data pinned from the official Supabase Root 2021 CA
// (see config/supabaseRootCa.js for full provenance). Not a secret.
const SUPABASE_ROOT_FINGERPRINT256 =
  "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

test("supabaseRootCa: inlined PEM is the self-signed Supabase root, pinned by fingerprint", () => {
  const pem = require("../config/supabaseRootCa");
  assert.equal(typeof pem, "string", "module must export the PEM string directly");
  const x = new X509Certificate(pem);
  assert.match(x.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(x.subject, x.issuer, "root must be self-signed (subject === issuer)");
  assert.equal(x.ca, true, "basicConstraints CA:TRUE");
  assert.equal(x.verify(x.publicKey), true, "self-signature must verify");
  assert.equal(
    x.fingerprint256,
    SUPABASE_ROOT_FINGERPRINT256,
    "pinned fingerprint changed — inlined PEM was edited, corrupted, or swapped"
  );
  // Node's X509Certificate.keyUsage is not populated for this cert — verify
  // the KeyUsage extension (2.5.29.15) exists at the DER level instead.
  const der = Buffer.from(
    pem.split("\n").filter((line) => !line.startsWith("-----")).join(""),
    "base64"
  );
  assert.ok(
    der.includes(Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x0f])),
    "KeyUsage extension (OID 2.5.29.15) must be present in the certificate DER"
  );
  assert.ok(
    Date.parse(x.validTo) > Date.parse("2030-01-01"),
    "root must still be within its validity window"
  );
  assert.equal(pem.includes("PRIVATE KEY"), false, "must never contain private key material");
});

test("isSupabaseHost: matches only genuine Supabase endpoints (no lookalike domains)", () => {
  // Real shapes: direct endpoint and pooler endpoints.
  assert.equal(isSupabaseHost("db.exampleproject.supabase.co"), true);
  assert.equal(isSupabaseHost("aws-0-ap-south-1.pooler.supabase.com"), true);
  assert.equal(isSupabaseHost("aws-0-example-1.pooler.supabase.com"), true);
  assert.equal(isSupabaseHost("AWS-0-AP-SOUTH-1.POOLER.SUPABASE.COM"), true);
  assert.equal(isSupabaseHost("supabase.co"), true);
  // Lookalikes must never match: the label before "supabase." must be a real
  // subdomain separator, and the suffix must END the hostname.
  assert.equal(isSupabaseHost("evil.supabase.co.attacker.com"), false);
  assert.equal(isSupabaseHost("supabase.co.evil.example"), false);
  assert.equal(isSupabaseHost("notsupabase.co"), false);
  assert.equal(isSupabaseHost("mysupabase.com"), false);
  assert.equal(isSupabaseHost("db.example.com"), false);
  assert.equal(isSupabaseHost("localhost"), false);
  assert.equal(isSupabaseHost("127.0.0.1"), false);
  assert.equal(isSupabaseHost(""), false);
  assert.equal(isSupabaseHost(undefined), false);
  assert.equal(isSupabaseHost(null), false);
});

test("getSequelizeOptions: Supabase pooler host trusts ONLY the pinned Supabase root CA", () => {
  const options = getSequelizeOptions({ DB_DIALECT: "postgres", DATABASE_URL: POOLER_URL });
  const ssl = options.dialectOptions.ssl;
  // Verification stays fully ON — the CA is additive trust, never a downgrade.
  assert.equal(ssl.rejectUnauthorized, true);
  assert.ok(Array.isArray(ssl.ca), "Supabase hosts must receive a ca array");
  assert.equal(ssl.ca.length, 1, "exactly one trust anchor (the Supabase root)");
  const x = new X509Certificate(ssl.ca[0]);
  assert.match(x.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(x.fingerprint256, SUPABASE_ROOT_FINGERPRINT256);
  assert.equal(x.subject, x.issuer);
});

test("getSequelizeOptions: Supabase direct endpoint (db.<ref>.supabase.co) also trusts the CA", () => {
  const options = getSequelizeOptions({
    DB_DIALECT: "postgres",
    DATABASE_URL: "postgresql://user:pass@db.exampleproject.supabase.co:5432/postgres"
  });
  assert.equal(options.dialectOptions.ssl.rejectUnauthorized, true);
  assert.ok(Array.isArray(options.dialectOptions.ssl.ca));
  assert.equal(new X509Certificate(options.dialectOptions.ssl.ca[0]).fingerprint256, SUPABASE_ROOT_FINGERPRINT256);
});

test("getSequelizeOptions: non-Supabase TLS hosts keep the default public trust store (no ca injected)", () => {
  const options = getSequelizeOptions({
    DB_DIALECT: "postgres",
    PG_HOST: "db.other-provider.example.com",
    PG_SSL: "true"
  });
  assert.equal(options.dialectOptions.ssl.rejectUnauthorized, true);
  assert.equal("ca" in options.dialectOptions.ssl, false, "no pinned CA for non-Supabase hosts");
});

test("getSequelizeOptions: loopback postgres (embedded harness) stays plaintext and untouched", () => {
  const options = getSequelizeOptions({ DB_DIALECT: "postgres", PG_HOST: "127.0.0.1" });
  assert.equal("dialectOptions" in options, false, "loopback needs no TLS and gets no CA");
});

test("getSequelizeOptions: MySQL path never receives the Supabase CA logic", () => {
  // Even with a Supabase-shaped host, the MySQL dialect must behave exactly
  // as before Phase 11 (no SSL block unless MYSQL_SSL, no ca array ever).
  const noSsl = getSequelizeOptions({ MYSQL_HOST: "db.exampleproject.supabase.co", MYSQL_DB: "buyoDB" });
  assert.equal(noSsl.dialect, "mysql");
  assert.equal("dialectOptions" in noSsl, false);
  const withSsl = getSequelizeOptions({ MYSQL_HOST: "db.exampleproject.supabase.co", MYSQL_SSL: "true" });
  assert.equal(withSsl.dialectOptions.ssl.rejectUnauthorized, true);
  assert.equal("ca" in withSsl.dialectOptions.ssl, false, "MySQL SSL never gets the Supabase CA");
});

test("getSequelizeOptions: mysql stays the default with a URL present (no inference)", () => {
  const options = getSequelizeOptions({ DATABASE_URL: POOLER_URL, MYSQL_HOST: "localhost", MYSQL_DB: "buyoDB" });
  assert.equal(options.dialect, "mysql");
  assert.equal(options.host, "localhost");
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

// ---------- dialect-aware stock literal (migration Phase 3) ----------

const { stockDelta } = require("../utils/sqlLiterals");

test("stockDelta: MySQL keeps the original backtick-quoted SQL byte-for-byte", () => {
  assert.equal(stockDelta("-", 2, {}), "`stock` - 2");
  assert.equal(stockDelta("+", 7, {}), "`stock` + 7");
  assert.equal(stockDelta("-", 1, { DB_DIALECT: "mysql" }), "`stock` - 1");
});

test("stockDelta: PostgreSQL uses double quotes (backticks are a syntax error there)", () => {
  assert.equal(stockDelta("-", 2, { DB_DIALECT: "postgres" }), '"stock" - 2');
  assert.equal(stockDelta("+", 7, { DB_DIALECT: "postgres" }), '"stock" + 7');
  assert.equal(stockDelta("-", 1, { DB_DIALECT: "PostgreSQL" }), '"stock" - 1');
});

test("stockDelta: rejects unsafe operands and quantities (no injection surface)", () => {
  assert.throws(() => stockDelta("*", 1, {}), /Unsupported stock operator/);
  assert.throws(() => stockDelta("=", 1, {}), /Unsupported stock operator/);
  assert.throws(() => stockDelta("-", 0, {}), /Non-integer/);
  assert.throws(() => stockDelta("-", -3, {}), /Non-integer/);
  assert.throws(() => stockDelta("-", 1.5, {}), /Non-integer/);
  assert.throws(() => stockDelta("-", "2 OR 1=1", {}), /Non-integer/);
});
