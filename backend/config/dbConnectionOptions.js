// config/dbConnectionOptions.js
// Single place that turns environment variables into database connection settings.
//
// DUAL-DIALECT (migration Phase 1): MySQL is the DEFAULT and remains the
// production behavior. PostgreSQL is an OPT-IN for the local migration harness
// only, selected with DB_DIALECT=postgres. When DB_DIALECT is unset or
// "mysql", every function below behaves exactly as it did before this phase.
//
// Local development uses the MYSQL_* names documented in .env.example
// (PG_* names for the PostgreSQL harness). Hosted MySQL providers (Railway,
// Render, etc.) often expose different names (MYSQLHOST / MYSQLDATABASE /
// MYSQLUSER / MYSQLPASSWORD / MYSQLPORT); those are accepted as additive
// fallbacks so deployment needs no code change.
//
// This module only RESOLVES settings — it never opens a connection.
//
// BOUNDARIES (migration Phase 1, extended Phase 9):
//   - DATABASE_URL is read ONLY on the PostgreSQL path (approved Supabase
//     phase): when DB_DIALECT=postgres, the URL fills any connection field
//     (host/port/database/username/password) left unset by the explicit
//     PG_* names — the discrete names always WIN, so the local loopback
//     harness is unaffected even when a DATABASE_URL line sits in backend/.env.
//     The MySQL path never reads it, and there is deliberately NO dialect
//     inference from DATABASE_URL: MySQL stays the default until the dialect
//     is explicitly selected (a stray URL must never silently retarget local
//     development). The remote-migration gate tripwire (its mere PRESENCE
//     refuses remote DB operations) is unchanged.
//   - PostgreSQL TLS (Phase 9): verification is always ON when TLS is used —
//     there is deliberately NO knob to set rejectUnauthorized:false on this
//     path. Unset PG_SSL = automatic (TLS for non-loopback hosts, none for
//     loopback), so local embedded-PostgreSQL testing needs no changes. Any
//     sslmode-style query parameter on DATABASE_URL is deliberately ignored —
//     the PG_SSL env knob (and the automatic rule) remains the only switch.
//   - Supabase CA trust (Phase 11): Supabase-hosted PostgreSQL endpoints use
//     Supabase's private PKI, whose root is NOT in Node's default trust
//     store. For *.supabase.co / *.supabase.com hosts the official Supabase
//     Root 2021 CA (see supabaseRootCa.js, public certificate data) is added
//     to the connection's trust — certificate-chain and hostname verification
//     stay FULLY ON. Other hosts keep the default public trust store.

const SUPABASE_ROOT_CA = require("./supabaseRootCa");

function firstDefined(...values) {
  for (const value of values) {
    if (value !== undefined && value !== null && value !== "") return value;
  }
  return undefined;
}

function isTruthy(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  return normalized === "true" || normalized === "1" || normalized === "yes";
}

// TLS certificate verification (Phase 11). Certificates are VERIFIED by
// default. MYSQL_SSL_REJECT_UNAUTHORIZED=false (or 0/no) disables verification
// — an explicit, opt-in local-development exception for self-signed
// certificates that must never be set in production (it makes the connection
// MITM-able). Any other value, including empty, keeps verification ON.
function sslRejectUnauthorized(env = process.env) {
  const normalized = String(env.MYSQL_SSL_REJECT_UNAUTHORIZED ?? "").trim().toLowerCase();
  if (normalized === "") return true;
  return !(normalized === "false" || normalized === "0" || normalized === "no");
}

function resolveMysqlSettings(env = process.env) {
  return {
    host: firstDefined(env.MYSQL_HOST, env.MYSQLHOST, env.DB_HOST),
    port: Number(firstDefined(env.MYSQL_PORT, env.MYSQLPORT, env.DB_PORT, 3306)),
    database: firstDefined(env.MYSQL_DB, env.MYSQLDATABASE, env.DB_NAME),
    username: firstDefined(env.MYSQL_USER, env.MYSQLUSER, env.DB_USER),
    password: firstDefined(env.MYSQL_PASS, env.MYSQLPASSWORD, env.DB_PASSWORD, ""),
    ssl: isTruthy(firstDefined(env.MYSQL_SSL, env.DB_SSL))
  };
}

// Dialect selection (migration Phase 1). UNSET (or "mysql") = the pre-Phase-1
// MySQL behavior. "postgres" (also accepted: "postgresql") enables the local
// PostgreSQL migration harness. Anything else throws rather than silently
// defaulting — a typo must never fall through to the wrong database.
function resolveDialect(env = process.env) {
  const raw = String(env.DB_DIALECT ?? "").trim().toLowerCase();
  if (raw === "" || raw === "mysql") return "mysql";
  if (raw === "postgres" || raw === "postgresql") return "postgres";
  throw new Error(
    `Unsupported DB_DIALECT "${env.DB_DIALECT}" (expected "mysql" or "postgres")`
  );
}

// Parse a PostgreSQL connection URL (approved Supabase phase). Returns null
// when no URL is set; throws a CLEAN error (variable name only — the URL
// itself contains the password and is never echoed, not even truncated) when
// set but unusable. Supports the Supabase transaction-pooler shape
// (postgresql://postgres.<ref>:<password>@<pooler-host>:6543/postgres) and
// percent-encoded credentials. The URL's query string (e.g. sslmode=...) is
// deliberately ignored — TLS stays governed by PG_SSL/the automatic rule with
// certificate verification hardcoded on.
function parsePostgresUrl(raw) {
  if (raw === undefined || raw === null || String(raw).trim() === "") return null;
  const value = String(raw).trim();
  if (!/^postgres(ql)?:\/\//i.test(value)) {
    throw new Error(
      "DATABASE_URL must use the postgresql:// (or postgres://) scheme when DB_DIALECT=postgres"
    );
  }
  let url;
  try {
    // WHATWG URL splits userinfo at the LAST @, so pooler passwords that
    // contain an unencoded @ (bracketed format) still parse correctly.
    url = new URL(value);
  } catch {
    throw new Error(
      "DATABASE_URL is not a valid URL (expected postgresql://user:password@host:port/database)"
    );
  }
  const decode = (part) => {
    try {
      return decodeURIComponent(part);
    } catch {
      throw new Error("DATABASE_URL contains invalid percent-encoding in its credentials or database name");
    }
  };
  const database = url.pathname.replace(/^\//, "");
  return {
    host: url.hostname || undefined,
    port: url.port ? Number(url.port) : undefined,
    database: database ? decode(database) : undefined,
    username: url.username ? decode(url.username) : undefined,
    password: url.password ? decode(url.password) : undefined
  };
}

// PostgreSQL settings (DB_DIALECT=postgres). Precedence: the explicit PG_*
// names always win; DATABASE_URL only fills what they leave unset. This keeps
// the local loopback harness byte-identical even when backend/.env carries a
// DATABASE_URL line, while production (URL only, no PG_*) works with nothing
// but DATABASE_URL + DB_DIALECT=postgres.
function resolvePostgresSettings(env = process.env) {
  const fromUrl = parsePostgresUrl(env.DATABASE_URL);
  const host = firstDefined(env.PG_HOST, env.PGDBHOST, env.DB_HOST, fromUrl && fromUrl.host);
  return {
    host,
    port: Number(firstDefined(env.PG_PORT, env.PGDBPORT, env.DB_PORT, fromUrl && fromUrl.port, 5432)),
    database: firstDefined(env.PG_DB, env.PGDATABASE, env.DB_NAME, fromUrl && fromUrl.database),
    username: firstDefined(env.PG_USER, env.PGDBUSER, env.DB_USER, fromUrl && fromUrl.username),
    password: firstDefined(env.PG_PASS, env.PGDBPASSWORD, env.DB_PASSWORD, fromUrl && fromUrl.password),
    ssl: resolvePgSslSetting(host, env)
  };
}

// Phase 9: TLS decision for PostgreSQL.
//   PG_SSL unset  -> automatic: TLS for any host that is NOT recognized
//                    loopback (local dev + embedded test clusters stay
//                    plaintext; hosted databases get TLS). An unrecognized
//                    or missing host counts as hosted — fail secure.
//   PG_SSL=true   -> force TLS even on loopback (e.g. a TLS-terminating
//                    local tunnel).
//   PG_SSL=false  -> explicitly disable TLS (e.g. a plaintext SSH tunnel).
//   anything else -> throws: a typo must never silently pick a mode.
// TLS always verifies certificates (rejectUnauthorized:true is hardcoded in
// getSequelizeOptions) — there is intentionally no knob to weaken it.
// Supabase hosts additionally trust the official Supabase Root 2021 CA
// (supabaseRootCa.js); other hosts use the default public trust store.
function resolvePgSslSetting(host, env = process.env) {
  const raw = String(env.PG_SSL ?? "").trim().toLowerCase();
  if (raw === "") return !isLoopbackHost(host);
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  throw new Error(
    `Unsupported PG_SSL value "${env.PG_SSL}" (expected true, false, or unset for automatic: TLS for non-loopback hosts)`
  );
}

// Strict integer env reader: unset -> default; anything invalid throws with
// the variable NAME (never a secret value — these are sizes/timeouts).
function intFromEnvSetting(env, name, def, lo, hi) {
  const raw = env[name];
  if (raw === undefined || raw === null || String(raw).trim() === "") return def;
  const value = Number(String(raw).trim());
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new Error(`${name} must be an integer between ${lo} and ${hi} (got "${raw}")`);
  }
  return value;
}

// Phase 9: small, serverless-suitable Sequelize pool for the POSTGRES path
// only (MySQL keeps Sequelize's defaults byte-for-byte — the existing test
// configuration and behavior are preserved). Defaults suit a warm serverless
// instance talking to a pooled (transaction-mode) hosted endpoint; every
// value is env-tunable and strictly validated (DB_POOL_MIN is implicitly
// capped at DB_POOL_MAX).
function resolvePoolOptions(env = process.env) {
  const max = intFromEnvSetting(env, "DB_POOL_MAX", 2, 1, 10);
  const min = intFromEnvSetting(env, "DB_POOL_MIN", 0, 0, max);
  const idle = intFromEnvSetting(env, "DB_POOL_IDLE_MS", 10000, 1000, 300000);
  const acquire = intFromEnvSetting(env, "DB_POOL_ACQUIRE_MS", 30000, 1000, 300000);
  return { max, min, idle, acquire };
}

// Convenience: settings for whichever dialect is selected.
function resolveSettings(env = process.env) {
  return resolveDialect(env) === "postgres"
    ? resolvePostgresSettings(env)
    : resolveMysqlSettings(env);
}

// Loopback = explicitly local. Used by the local-only guards in scripts/.
function isLoopbackHost(host) {
  if (!host) return false;
  const normalized = String(host).trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "[::1]"
  );
}

// Supabase cloud hosts (Phase 11): db.<ref>.supabase.co (direct) and
// aws-*-<region>.pooler.supabase.com (transaction/session poolers). Anchored
// at the END of the hostname so lookalike domains (e.g.
// "supabase.co.attacker.example") never match, and a preceding dot (or start
// of string) is required so "notsupabase.co" never matches. Only these hosts
// get the pinned Supabase root CA added to their TLS trust; every other host
// keeps the default public trust store unchanged.
function isSupabaseHost(host) {
  if (!host) return false;
  return /(^|\.)supabase\.(co|com)$/.test(String(host).trim().toLowerCase());
}

// Options for Sequelize (used by config/db.js)
function getSequelizeOptions(env = process.env) {
  const dialect = resolveDialect(env);
  if (dialect === "postgres") {
    const settings = resolvePostgresSettings(env);
    const options = {
      host: settings.host,
      port: settings.port,
      dialect: "postgres",
      logging: false,
      // Small pool by default (Phase 9) — serverless-suitable, strictly validated.
      pool: resolvePoolOptions(env)
    };
    // TLS with certificate VERIFICATION, hardcoded — no opt-out exists (Phase 9).
    if (settings.ssl) {
      const sslOptions = { rejectUnauthorized: true };
      // Supabase endpoints chain to Supabase's private root CA, which is not
      // in Node's default trust store (a bare verify fails with
      // SELF_SIGNED_CERT_IN_CHAIN before authentication). For those hosts
      // ONLY, add the official Supabase Root 2021 CA as an extra trust
      // anchor; verification and hostname checks remain fully enabled, and
      // non-Supabase hosts keep the default public trust store untouched.
      if (isSupabaseHost(settings.host)) {
        sslOptions.ca = [SUPABASE_ROOT_CA];
      }
      options.dialectOptions = { ssl: sslOptions };
    }
    return options;
  }
  const settings = resolveMysqlSettings(env);
  const options = {
    host: settings.host,
    port: settings.port,
    dialect: "mysql",
    logging: false
  };
  if (settings.ssl) {
    options.dialectOptions = { ssl: { rejectUnauthorized: sslRejectUnauthorized(env) } };
  }
  return options;
}

// Options for raw mysql2 connections from resolved settings
// (used by scripts/db-backup.js, db-restore.js, db-migrate.js, admin-role.js)
function toMysql2Options(settings, { includeDatabase = true, env = process.env } = {}) {
  const options = {
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password
  };
  if (includeDatabase && settings.database) options.database = settings.database;
  if (settings.ssl) {
    options.ssl = { rejectUnauthorized: sslRejectUnauthorized(env) };
  }
  return options;
}

// Options for raw mysql2 connections (used by scripts/db-backup.js)
function getMysql2Options(env = process.env) {
  return toMysql2Options(resolveMysqlSettings(env), { env });
}

module.exports = {
  resolveDialect,
  resolveMysqlSettings,
  parsePostgresUrl,
  resolvePostgresSettings,
  resolvePgSslSetting,
  resolvePoolOptions,
  intFromEnvSetting,
  resolveSettings,
  isLoopbackHost,
  isSupabaseHost,
  sslRejectUnauthorized,
  getSequelizeOptions,
  getMysql2Options,
  toMysql2Options
};
