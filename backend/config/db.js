const { Sequelize } = require("sequelize");

// Create MySQL connection
const sequelize = new Sequelize(
  process.env.MYSQL_DB,      // Database name
  process.env.MYSQL_USER,    // MySQL username
  process.env.MYSQL_PASS,    // MySQL password
  {
    host: process.env.MYSQL_HOST, // MySQL host
    dialect: "mysql",
    logging: false
  }
);

// Test connection
sequelize.authenticate()
  .then(() => console.log("✅ MySQL Connected"))
  .catch(err => console.error("❌ MySQL Connection Failed:", err));

module.exports = sequelize;
