const { Sequelize } = require("sequelize");
const { resolveMysqlSettings, getSequelizeOptions } = require("./dbConnectionOptions");

// Create MySQL connection.
// Settings are resolved from environment variables (see dbConnectionOptions.js):
// local dev uses MYSQL_*; hosted providers may inject MYSQLHOST-style names.
const settings = resolveMysqlSettings();
const sequelize = new Sequelize(
  settings.database,       // Database name
  settings.username,       // MySQL username
  settings.password,       // MySQL password
  getSequelizeOptions()
);

// Test connection
sequelize.authenticate()
  .then(() => console.log("✅ MySQL Connected"))
  .catch(err => console.error("❌ MySQL Connection Failed:", err));

module.exports = sequelize;
