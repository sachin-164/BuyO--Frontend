// config/dbConnectionOptions.js
// Single place that turns environment variables into MySQL connection settings.
//
// Local development uses the MYSQL_* names documented in .env.example.
// Hosted MySQL providers (Railway, Render, etc.) often expose different names
// (MYSQLHOST / MYSQLDATABASE / MYSQLUSER / MYSQLPASSWORD / MYSQLPORT); those are
// accepted as additive fallbacks so deployment needs no code change.
//
// This module only RESOLVES settings — it never opens a connection.

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
  const settings = resolveMysqlSettings(env);
  const options = {
    host: settings.host,
    port: settings.port,
    dialect: "mysql",
    logging: false
  };
  if (settings.ssl) {
    options.dialectOptions = { ssl: { rejectUnauthorized: false } };
  }
  return options;
}

// Options for raw mysql2 connections (used by scripts/db-backup.js)
function getMysql2Options(env = process.env) {
  const settings = resolveMysqlSettings(env);
  const options = {
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    database: settings.database
  };
  if (settings.ssl) {
    options.ssl = { rejectUnauthorized: false };
  }
  return options;
}

module.exports = {
  resolveMysqlSettings,
  isLoopbackHost,
  getSequelizeOptions,
  getMysql2Options
};
