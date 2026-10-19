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
// BOUNDARIES (migration Phase 1):
//   - DATABASE_URL is intentionally NOT read anywhere in this file. Supabase
//     connection settings arrive in a later, separately-approved phase.
//   - The PostgreSQL path has NO SSL options yet: the harness is loopback-only.

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

// PostgreSQL settings for the local migration harness (only used when
// DB_DIALECT=postgres). PG_* names mirror the MYSQL_* convention. DATABASE_URL
// is deliberately NOT read here (Supabase arrives in a later approved phase),
// and there is intentionally no SSL knob: this path is loopback-only.
function resolvePostgresSettings(env = process.env) {
  return {
    host: firstDefined(env.PG_HOST, env.PGDBHOST, env.DB_HOST),
    port: Number(firstDefined(env.PG_PORT, env.PGDBPORT, env.DB_PORT, 5432)),
    database: firstDefined(env.PG_DB, env.PGDATABASE, env.DB_NAME),
    username: firstDefined(env.PG_USER, env.PGDBUSER, env.DB_USER),
    password: firstDefined(env.PG_PASS, env.PGDBPASSWORD, env.DB_PASSWORD, "")
  };
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

// Options for Sequelize (used by config/db.js)
function getSequelizeOptions(env = process.env) {
  const dialect = resolveDialect(env);
  if (dialect === "postgres") {
    const settings = resolvePostgresSettings(env);
    return {
      host: settings.host,
      port: settings.port,
      dialect: "postgres",
      logging: false
    };
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
  resolvePostgresSettings,
  resolveSettings,
  isLoopbackHost,
  sslRejectUnauthorized,
  getSequelizeOptions,
  getMysql2Options,
  toMysql2Options
};
