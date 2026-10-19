const { Sequelize } = require("sequelize");
const { resolveDialect, resolveSettings, getSequelizeOptions } = require("./dbConnectionOptions");

// Create the database connection (dual-dialect, migration Phase 1).
// Settings are resolved from environment variables (see dbConnectionOptions.js):
// MySQL is the DEFAULT (local dev uses MYSQL_*; hosted providers may inject
// MYSQLHOST-style names). DB_DIALECT=postgres selects the local PostgreSQL
// migration harness (PG_* names) — a later, separately-approved phase moves
// the app itself; this file only follows the resolved dialect.
const dialect = resolveDialect();
const settings = resolveSettings();
const sequelize = new Sequelize(
  settings.database,       // Database name
  settings.username,       // Database username
  settings.password,       // Database password
  getSequelizeOptions()
);

// Test connection
const label = dialect === "postgres" ? "PostgreSQL" : "MySQL";
sequelize.authenticate()
  .then(() => console.log(`✅ ${label} Connected`))
  .catch(err => console.error(`❌ ${label} Connection Failed:`, err));

module.exports = sequelize;
