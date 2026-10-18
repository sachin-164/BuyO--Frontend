#!/usr/bin/env node
// scripts/db-sync.js
// Explicit, LOCAL-ONLY schema sync for development.
//
// This replaces the boot-time sequelize.sync() calls: it creates any tables the
// Sequelize models define (plain sync — it never drops or force-recreates).
//
// Usage:
//   npm run db:sync -- --confirm-local           create missing tables
//   npm run db:sync -- --confirm-local --alter   dev-only: apply column changes
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

const { resolveMysqlSettings, isLoopbackHost } = require("../config/dbConnectionOptions");

const DEFAULT_ALLOWED_DATABASES = ["buyoDB", "buyoDB_ph1_verify"];

function fail(reasons) {
  console.error("❌ REFUSED: db:sync only runs against an explicitly confirmed LOCAL dev database.");
  for (const reason of reasons) console.error(`   - ${reason}`);
  console.error("   Usage: npm run db:sync -- --confirm-local");
  process.exit(1);
}

function getAllowedDatabases() {
  const raw = (process.env.DB_SYNC_ALLOWED_DATABASES || "").trim();
  if (!raw) return DEFAULT_ALLOWED_DATABASES;
  return raw.split(",").map((name) => name.trim()).filter(Boolean);
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const settings = resolveMysqlSettings();
  const allowed = getAllowedDatabases();
  const reasons = [];

  if (!flags.has("--confirm-local")) reasons.push("missing --confirm-local flag");
  if (String(process.env.NODE_ENV || "").toLowerCase() === "production") reasons.push("NODE_ENV=production is set");
  if (!settings.host) reasons.push("no database host configured");
  else if (!isLoopbackHost(settings.host)) reasons.push(`host "${settings.host}" is not loopback (localhost/127.0.0.1/::1)`);
  if (!settings.database) reasons.push("no database name configured (MYSQL_DB)");
  else if (!allowed.includes(settings.database)) reasons.push(`database "${settings.database}" is not in DB_SYNC_ALLOWED_DATABASES (${allowed.join(", ")})`);

  if (reasons.length) fail(reasons);

  if (flags.has("--alter")) {
    console.warn("⚠️  --alter mode: existing LOCAL tables may be altered to match the models.");
  }

  // Load all models first so associations (User → CartItem/WishlistItem) register.
  require("../models/user");
  require("../models/product");
  require("../models/cart");
  require("../models/wishlist");
  const sequelize = require("../config/db");

  await sequelize.authenticate();
  console.log(`✅ Connected (local) — database: ${settings.database}`);

  await sequelize.sync(flags.has("--alter") ? { alter: true } : {});
  console.log("✅ Local schema sync complete (no drops, no force).");

  await sequelize.close();
}

main().catch((err) => {
  console.error("❌ db:sync failed:", err.message);
  process.exit(1);
});
