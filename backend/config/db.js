const { Sequelize } = require("sequelize");
const { resolveDialect, resolveSettings, getSequelizeOptions } = require("./dbConnectionOptions");

// Create the database connection (dual-dialect, migration Phase 1).
// Settings are resolved from environment variables (see dbConnectionOptions.js):
// MySQL is the DEFAULT and remains the production behavior until cutover.
// DB_DIALECT=postgres selects the PostgreSQL path (PG_* names).
//
// Phase 9: NO connection is attempted at module load. Sequelize connects
// lazily on first use — server.js authenticates explicitly at startup (with
// real error handling), and the serverless entry (api/index.js) performs no
// database work at cold start until a request actually reaches a route that
// needs the database.
resolveDialect(); // validates DB_DIALECT at module load (throws on typos)
const settings = resolveSettings();
const sequelize = new Sequelize(
  settings.database,       // Database name
  settings.username,       // Database username
  settings.password,       // Database password
  getSequelizeOptions()
);

module.exports = sequelize;
