const { Sequelize } = require("sequelize");
// Bundler visibility: sequelize constructs its dialect driver via a DYNAMIC
// require ("Please install mysql2 package manually" is thrown from its
// connection manager), which Vercel's nft tracer cannot follow — the
// deployed function bundle omitted mysql2 and every cold start died at
// db.js:16 (verified live). These static requires pin the drivers into the
// serverless bundle; both are production dependencies with no side effects
// at require time. pg-hstore is intentionally NOT required here: it is not
// installed (sequelize's PG-dialect-only concern) and MySQL stays the
// default until the cutover — revisit when the PG path becomes runtime.
require("mysql2");
require("pg");
const { resolveDialect, resolveSettings, getSequelizeOptions } = require("./dbConnectionOptions");

// Create the database connection (dual-dialect, migration Phase 1).
// Settings are resolved from environment variables (see dbConnectionOptions.js):
// MySQL is the DEFAULT and remains the production behavior until cutover.
// DB_DIALECT=postgres selects the PostgreSQL path (PG_* names).
//
// Phase 9: NO connection is attempted at module load. Sequelize connects
// lazily on first use — server.js authenticates explicitly at startup (with
// real error handling), and the serverless entry (api/app.js) performs no
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
