// server.js
const dotenv = require("dotenv");
dotenv.config(); // ✅ Load .env first

const { createApp } = require("./app");
const sequelize = require("./config/db"); // MySQL connection (Sequelize)

const app = createApp();

// Start Server
const startServer = async () => {
  try {
    // Test DB connection
    await sequelize.authenticate();
    console.log(`✅ MySQL Connected to DB: ${process.env.MYSQL_DB}`);

    // Schema is managed explicitly — no implicit sync on boot.
    // Local dev:  npm run db:sync -- --confirm-local
    // Production: versioned migrations (later phase)

    const PORT = process.env.PORT || 5000;
    app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ DB Connection Failed:", err.message);
    process.exit(1); // Stop app if DB fails
  }
};

startServer();
