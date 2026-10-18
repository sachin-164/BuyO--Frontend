#!/usr/bin/env node
// scripts/db-sync.js
// Explicit, LOCAL-ONLY table bootstrap for development.
//
// This replaces the boot-time sequelize.sync() calls: it creates any tables the
// Sequelize models define (plain sync — it never drops or force-recreates).
//
// Schema EVOLUTION (new columns, constraints, backfills) does NOT happen here:
// use the versioned migrations instead (npm run db:migrate). The old `--alter`
// mode is disabled on purpose so sequelize.sync({ alter: true }) can never be
// used to evolve the schema.
//
// Usage:
//   npm run db:sync -- --confirm-local           create missing tables
//
// Safety guards — the script REFUSES to run unless ALL of these hold:
//   1. --confirm-local flag is passed (explicit intent)
//   2. NODE_ENV is not "production"
//   3. Target host is loopback (localhost / 127.0.0.1 / ::1)
//   4. Target database is listed in DB_SYNC_ALLOWED_DATABASES
//      (comma-separated; defaults to local dev database names only)
//
// Production schema changes are NOT possible through this script.

const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env") });

const { resolveMysqlSettings } = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");

const DEFAULT_ALLOWED_DATABASES = ["buyoDB", "buyoDB_ph1_verify"];

async function main() {
  const flags = new Set(process.argv.slice(2));
  const settings = resolveMysqlSettings();
  const allowed = getAllowedDatabases("DB_SYNC_ALLOWED_DATABASES", DEFAULT_ALLOWED_DATABASES);

  const reasons = collectLocalGuardReasons({
    flags,
    settings,
    allowed,
    allowedEnvVar: "DB_SYNC_ALLOWED_DATABASES"
  });
  if (reasons.length) refuseLocal("db:sync", "npm run db:sync -- --confirm-local", reasons);

  if (flags.has("--alter")) {
    console.error("❌ REFUSED: --alter is disabled. Schema evolution runs through versioned migrations.");
    console.error("   Apply pending migrations with: npm run db:migrate -- --confirm-local");
    process.exit(1);
  }

  // Load all models first so associations register (User → CartItem/WishlistItem,
  // Category → Product).
  require("../models/user");
  require("../models/category");
  require("../models/product");
  require("../models/cart");
  require("../models/wishlist");
  const sequelize = require("../config/db");

  await sequelize.authenticate();
  console.log(`✅ Connected (local) — database: ${settings.database}`);

  await sequelize.sync();
  console.log("✅ Local schema sync complete (no drops, no force, no alter).");
  console.log("   For schema changes use: npm run db:migrate -- --confirm-local");

  await sequelize.close();
}

main().catch((err) => {
  console.error("❌ db:sync failed:", err.message);
  process.exit(1);
});
