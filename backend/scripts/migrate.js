#!/usr/bin/env node
// scripts/migrate.js
// Numbered, versioned MySQL migrations — LOCAL-ONLY, explicit, auditable.
//
// How it works
//   - Migrations live in backend/migrations/NNN_name.sql, applied in filename order.
//   - Applied migrations are recorded in the `schema_migrations` table together
//     with a SHA-256 checksum. Editing an already-applied file is REFUSED.
//   - Statements are split on ";" — migration files must NOT contain ";"
//     inside string literals (kept simple on purpose; see docs/schema-v1.md).
//   - Statements run sequentially. MySQL DDL is not transactional, so every
//     migration step is GUARDED (checks information_schema first) and safe to
//     re-run after a partial failure. Recovery strategy: pre-migration backup
//     (npm run db:backup) + scratch restore (npm run db:restore).
//   - sequelize.sync({ alter: true }) is NEVER used for schema evolution.
//
// Safety guards — REFUSES to run unless ALL hold:
//   1. --confirm-local flag passed          2. NODE_ENV is not "production"
//   3. host is loopback                     4. database in DB_MIGRATE_ALLOWED_DATABASES
//
// Usage:
//   npm run db:migrate -- --confirm-local            apply pending migrations
//   npm run db:migrate -- --confirm-local --status   show applied/pending only

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const crypto = require("crypto");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const { resolveMysqlSettings, toMysql2Options } = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");

const MIGRATIONS_DIR = path.resolve(__dirname, "..", "migrations");
const BOOKKEEPING_TABLE = "schema_migrations";
const FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.sql$/;
const DEFAULT_ALLOWED_DATABASES = ["buyoDB"];

function computeChecksum(text) {
  return crypto.createHash("sha256").update(text, "utf8").digest("hex");
}

// Simple statement splitter. Comment lines (starting with --) are dropped and
// the remainder is split on ";". Policy: no semicolons inside string literals.
function splitStatements(sqlText) {
  const lines = sqlText.replace(/^\uFEFF/, "").split(/\r?\n/);
  const withoutComments = lines.map((line) => (line.trim().startsWith("--") ? "" : line)).join("\n");
  return withoutComments.split(";").map((s) => s.trim()).filter(Boolean);
}

function discoverMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (!FILE_PATTERN.test(file)) {
      throw new Error(`Bad migration filename "${file}" — expected NNN_lower_snake_name.sql`);
    }
  }
  return files;
}

async function getAppliedMigrations(connection) {
  const [rows] = await connection.query(
    `SELECT \`id\`, \`checksum\`, \`appliedAt\`, \`executionMs\` FROM \`${BOOKKEEPING_TABLE}\` ORDER BY \`id\``
  );
  return rows;
}

async function bookkeepingTableExists(connection) {
  const [rows] = await connection.query(
    "SELECT COUNT(*) AS n FROM information_schema.TABLES WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = ?",
    [BOOKKEEPING_TABLE]
  );
  return rows[0].n > 0;
}

async function ensureBookkeepingTable(connection) {
  await connection.query(
    `CREATE TABLE IF NOT EXISTS \`${BOOKKEEPING_TABLE}\` (
      \`id\` VARCHAR(191) NOT NULL,
      \`checksum\` CHAR(64) NOT NULL,
      \`appliedAt\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`executionMs\` INT NOT NULL DEFAULT 0,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
  );
}

async function runMigrations({ settings = resolveMysqlSettings(), quiet = false, statusOnly = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const files = discoverMigrationFiles();
  const connection = await mysql.createConnection(toMysql2Options(settings));

  try {
    if (statusOnly) {
      const applied = (await bookkeepingTableExists(connection)) ? await getAppliedMigrations(connection) : [];
      const appliedIds = new Set(applied.map((row) => row.id));
      const pending = files.filter((file) => !appliedIds.has(file));
      log(`Applied migrations (${applied.length}):`);
      for (const row of applied) log(`   ✅ ${row.id}  (applied ${row.appliedAt.toISOString?.() ?? row.appliedAt}, ${row.executionMs} ms)`);
      if (!applied.length) log("   (none — schema_migrations not initialized yet)");
      log(`Pending migrations (${pending.length}):`);
      for (const file of pending) log(`   ⏳ ${file}`);
      if (!pending.length) log("   (none)");
      return { applied: [], pending, upToDate: pending.length === 0, status: true };
    }

    await ensureBookkeepingTable(connection);
    const appliedRows = await getAppliedMigrations(connection);
    const applied = new Map(appliedRows.map((row) => [row.id, row]));

    // Tamper protection: applied files must not change.
    const changed = [];
    for (const file of files) {
      if (!applied.has(file)) continue;
      const checksum = computeChecksum(await fsp.readFile(path.join(MIGRATIONS_DIR, file), "utf8"));
      if (checksum !== applied.get(file).checksum) changed.push(file);
    }
    if (changed.length) {
      throw new Error(
        `already-applied migration file(s) changed: ${changed.join(", ")}. ` +
          "Create a NEW migration instead of editing applied ones."
      );
    }
    const known = new Set(files);
    const orphaned = [...applied.keys()].filter((id) => !known.has(id));
    if (orphaned.length) log(`⚠️  schema_migrations lists unknown migration file(s): ${orphaned.join(", ")}`);

    const pending = files.filter((file) => !applied.has(file));
    if (!pending.length) {
      log("✅ Database schema is up to date. No pending migrations.");
      return { applied: [], pending: [], upToDate: true };
    }

    log(`→ ${pending.length} pending migration(s): ${pending.join(", ")}`);
    const appliedNow = [];
    for (const file of pending) {
      const sqlText = await fsp.readFile(path.join(MIGRATIONS_DIR, file), "utf8");
      const checksum = computeChecksum(sqlText);
      const statements = splitStatements(sqlText);
      log(`→ applying ${file} (${statements.length} statement(s))...`);
      const startedAt = Date.now();
      try {
        for (const statement of statements) {
          await connection.query(statement);
        }
      } catch (err) {
        throw new Error(
          `migration ${file} failed: ${err.message}\n` +
            "   The database may be partially migrated. Migrations are guarded, so you can fix and re-run;\n" +
            "   alternatively restore from a backup: npm run db:restore -- --help"
        );
      }
      const executionMs = Date.now() - startedAt;
      await connection.query(
        `INSERT INTO \`${BOOKKEEPING_TABLE}\` (\`id\`, \`checksum\`, \`appliedAt\`, \`executionMs\`) VALUES (?, ?, NOW(), ?)`,
        [file, checksum, executionMs]
      );
      log(`✅ ${file} applied (${executionMs} ms)`);
      appliedNow.push(file);
    }
    log(`✅ Migrations complete. Applied ${appliedNow.length} migration(s).`);
    return { applied: appliedNow, pending: [], upToDate: false };
  } finally {
    await connection.end();
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const settings = resolveMysqlSettings();
  const allowed = getAllowedDatabases("DB_MIGRATE_ALLOWED_DATABASES", DEFAULT_ALLOWED_DATABASES);

  const reasons = collectLocalGuardReasons({
    flags,
    settings,
    allowed,
    allowedEnvVar: "DB_MIGRATE_ALLOWED_DATABASES"
  });
  if (reasons.length) {
    refuseLocal("db:migrate", "npm run db:migrate -- --confirm-local [--status]", reasons);
  }

  const statusOnly = flags.has("--status");
  await runMigrations({ settings, statusOnly });
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ db:migrate failed:", err.message);
    process.exit(1);
  });
}

module.exports = {
  runMigrations,
  splitStatements,
  computeChecksum,
  discoverMigrationFiles,
  getAppliedMigrations,
  bookkeepingTableExists,
  ensureBookkeepingTable,
  MIGRATIONS_DIR,
  BOOKKEEPING_TABLE
};
