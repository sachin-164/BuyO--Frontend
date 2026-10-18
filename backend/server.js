// server.js
const dotenv = require("dotenv");
dotenv.config(); // ✅ Load .env first

const { createApp } = require("./app");
const sequelize = require("./config/db"); // MySQL connection (Sequelize)

const app = createApp();

// Fail-fast sanity checks (Phase 11). Warnings never print secret values.
function warnAboutConfig() {
  const secret = process.env.JWT_SECRET || "";
  if (secret && secret.length < 32) {
    console.warn(
      "⚠️ JWT_SECRET is shorter than 32 characters — use a long random value in production " +
        '(generate: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))")'
    );
  }
  if (process.env.NODE_ENV === "production") {
    if (!process.env.FRONTEND_URL) {
      console.warn("⚠️ FRONTEND_URL is not set — verification/reset emails will contain broken links.");
    }
    if (!process.env.BACKEND_URL) {
      console.warn("⚠️ BACKEND_URL is not set — verification emails will contain broken links.");
    }
  }
}

// Start Server
let server = null;

const startServer = async () => {
  try {
    // Test DB connection
    await sequelize.authenticate();
    console.log(`✅ MySQL Connected to DB: ${process.env.MYSQL_DB}`);

    // Schema is managed explicitly — no implicit sync on boot.
    // Local dev:  npm run db:sync -- --confirm-local
    // Production: numbered migrations (npm run db:migrate -- --confirm-local)

    warnAboutConfig();

    const PORT = process.env.PORT || 5000;
    server = app.listen(PORT, () => {
      console.log(`🚀 Server running on http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error("❌ DB Connection Failed:", err.message);
    process.exit(1); // Stop app if DB fails
  }
};

// Process-level safety nets (Phase 11): log and exit rather than limp along
// in an undefined state. Graceful shutdown closes HTTP first, then the pool,
// so in-flight requests can finish.
process.on("unhandledRejection", (reason) => {
  console.error("❌ Unhandled promise rejection:", reason instanceof Error ? reason.stack || reason.message : reason);
  process.exit(1);
});
process.on("uncaughtException", (err) => {
  console.error("❌ Uncaught exception:", err.stack || err.message);
  process.exit(1);
});

async function shutdown(signal) {
  console.log(`\n${signal} received — shutting down gracefully...`);
  try {
    if (server) {
      await new Promise((resolve) => server.close(resolve));
    }
    await sequelize.close();
    process.exit(0);
  } catch (err) {
    console.error("❌ Error during shutdown:", err.message);
    process.exit(1);
  }
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

startServer();
