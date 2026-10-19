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
// DUAL-DIALECT (Migration Phase 6): with DB_DIALECT=postgres the SAME runner
// discovers NNN_*.pgsql files in this directory and applies them with the same
// guards, checksums and schema_migrations bookkeeping — but each file runs in
// ONE transaction (PostgreSQL DDL is transactional, so a failed or interrupted
// migration leaves no partial state and records nothing). The two naming
// spaces are disjoint by suffix: the MySQL runner only sees .sql files (the
// applied ones are frozen by checksum protection), the PG runner only sees
// .pgsql files. PG settings come from PG_* env vars only — DATABASE_URL is
// never read and the path has no SSL options (loopback-only by design).
//
// .pgsql file directives (details: docs/migration-phase6.md):
//   -- precheck: <label>   the statement must return ZERO rows, otherwise the
//                          migration ABORTS and rolls back. Prechecks are how
//                          existing duplicates are detected BEFORE index
//                          creation; their SELECTs must only reference columns
//                          that are safe to print (IDs/counts — never emails).
//   -- verify: <label>     the statement must return exactly one row whose
//                          boolean column ok is true, otherwise the migration
//                          ABORTS and rolls back — no false success.
// File policy (both dialects): no ";" inside string literals.
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
const { resolveDialect, resolveMysqlSettings, resolvePostgresSettings, toMysql2Options } = require("../config/dbConnectionOptions");
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

async function runMigrations(options = {}) {
  // PostgreSQL branch (Migration Phase 6): PG targets are resolved from PG_*
  // env vars only — an explicit settings object is a MySQL-path concept and
  // must not be silently ignored here.
  if (resolveDialect() === "postgres") {
    if (options.settings) {
      throw new Error(
        "PostgreSQL migrations resolve their target from PG_* environment variables only " +
          "(DB_DIALECT=postgres); passing explicit settings is not supported on this path."
      );
    }
    return runPostgresMigrations({
      quiet: options.quiet ?? false,
      statusOnly: options.statusOnly ?? false
    });
  }

  const { settings = resolveMysqlSettings(), quiet = false, statusOnly = false } = options;
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

// ---------------------------------------------------------------------------
// PostgreSQL path (Migration Phase 6)
//
// Mirrors the MySQL semantics above (discovery order, checksum tamper
// protection, orphan warning, schema_migrations bookkeeping) with three
// deliberate differences forced by the platform:
//   1. Files are NNN_*.pgsql (the .sql namespace stays MySQL-only).
//   2. Each file runs inside ONE transaction: on any failure or interruption
//      PostgreSQL rolls the whole file back — no partial DDL, no bookkeeping
//      row, fully re-runnable after the reported state is fixed.
//   3. Statements can carry `-- precheck:` / `-- verify:` directives so a
//      migration can refuse to run on dirty data (safe diagnostics) and can
//      never claim success without confirming its constraints exist.
// ---------------------------------------------------------------------------

const PG_FILE_PATTERN = /^\d{3}_[a-z0-9_]+\.pgsql$/;

function discoverPgMigrationFiles() {
  const files = fs.readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith(".pgsql")).sort();
  for (const file of files) {
    if (!PG_FILE_PATTERN.test(file)) {
      throw new Error(`Bad migration filename "${file}" — expected NNN_lower_snake_name.pgsql`);
    }
  }
  return files;
}

// Splits a .pgsql file into executable statements while KEEPING directive
// comments with their statement. Same no-";"-inside-strings policy as MySQL.
// Comments are removed only right before execution.
function splitPgStatements(sqlText) {
  const statements = [];
  for (const rawChunk of sqlText.replace(/^\uFEFF/, "").split(";")) {
    let precheckLabel = null;
    let verifyLabel = null;
    const sqlLines = [];
    for (const line of rawChunk.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (trimmed.startsWith("--")) {
        const precheckMatch = /^--\s*precheck:\s*(.+)$/.exec(trimmed);
        const verifyMatch = /^--\s*verify:\s*(.+)$/.exec(trimmed);
        if (precheckMatch) precheckLabel = precheckMatch[1].trim();
        if (verifyMatch) verifyLabel = verifyMatch[1].trim();
        if (!precheckMatch && !verifyMatch && /^--\s*(precheck|verify)\b/i.test(trimmed)) {
          throw new Error(
            `malformed migration directive: "${trimmed}" ` +
              '(expected exactly "-- precheck: <label>" or "-- verify: <label>")'
          );
        }
        continue; // comments are never executed
      }
      sqlLines.push(line);
    }
    const sql = sqlLines.join("\n").trim();
    if (!sql) {
      if (precheckLabel || verifyLabel) {
        throw new Error("migration directive (-- precheck:/-- verify:) without a statement");
      }
      continue; // leading/trailing comment-only chunk
    }
    if (precheckLabel && verifyLabel) {
      throw new Error("a migration statement cannot be both a precheck and a verify");
    }
    statements.push({
      sql,
      kind: precheckLabel ? "precheck" : verifyLabel ? "verify" : "exec",
      label: precheckLabel || verifyLabel || ""
    });
  }
  return statements;
}

async function ensureBookkeepingTablePg(client) {
  await client.query(
    `CREATE TABLE IF NOT EXISTS ${BOOKKEEPING_TABLE} (
      id VARCHAR(191) NOT NULL,
      checksum CHAR(64) NOT NULL,
      "appliedAt" TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "executionMs" INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (id)
    )`
  );
}

async function getAppliedMigrationsPg(client) {
  const { rows } = await client.query(
    `SELECT id, checksum, "appliedAt", "executionMs" FROM ${BOOKKEEPING_TABLE} ORDER BY id`
  );
  return rows;
}

async function executePgStatement(client, statement) {
  if (statement.kind === "exec") {
    await client.query(statement.sql);
    return;
  }

  let rows;
  try {
    ({ rows } = await client.query(statement.sql));
  } catch (err) {
    throw new Error(`${statement.kind} "${statement.label}" query failed: ${err.message}`);
  }

  if (statement.kind === "precheck") {
    if (rows.length > 0) {
      const preview = rows.slice(0, 20);
      throw new Error(
        `precheck failed (${statement.label}): ${rows.length} conflicting row group(s) found. ` +
          `Conflicting records (as selected by the precheck, safe columns only): ${JSON.stringify(preview)}` +
          (rows.length > preview.length ? ` … and ${rows.length - preview.length} more group(s)` : "") +
          ". NOTHING was changed — resolve these duplicates manually (see docs/migration-phase6.md, " +
          "section on duplicate remediation) and re-run."
      );
    }
    return;
  }

  // verify: exactly one row, boolean column `ok` strictly true.
  const ok = rows.length === 1 && rows[0] && rows[0].ok === true;
  if (!ok) {
    throw new Error(
      `verify failed (${statement.label}): expected exactly one row with ok=true, got ${JSON.stringify(rows)}. ` +
        "The required constraint was NOT confirmed present."
    );
  }
}

async function runPostgresMigrations({ quiet = false, statusOnly = false } = {}) {
  const log = quiet ? () => {} : (...args) => console.log(...args);
  const settings = resolvePostgresSettings();
  const files = discoverPgMigrationFiles();
  const { Client } = require("pg");
  const client = new Client({
    host: settings.host,
    port: settings.port,
    user: settings.username,
    password: settings.password,
    database: settings.database
    // No SSL: this path is loopback-only by design (migration Phase 1).
  });
  await client.connect();

  try {
    const exists = await client.query(`SELECT to_regclass('${BOOKKEEPING_TABLE}') IS NOT NULL AS present`);
    const bookkeepingExists = exists.rows[0].present === true;

    if (statusOnly) {
      const applied = bookkeepingExists ? await getAppliedMigrationsPg(client) : [];
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

    if (!bookkeepingExists) await ensureBookkeepingTablePg(client);
    const appliedRows = await getAppliedMigrationsPg(client);
    const applied = new Map(appliedRows.map((row) => [row.id, row]));

    // Tamper protection: applied files must not change (same rule as MySQL).
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
      const statements = splitPgStatements(sqlText);
      log(`→ applying ${file} (${statements.length} statement(s), in one transaction)...`);
      const startedAt = Date.now();
      await client.query("BEGIN");
      try {
        for (const statement of statements) {
          await executePgStatement(client, statement);
        }
        const executionMs = Date.now() - startedAt;
        await client.query(
          `INSERT INTO ${BOOKKEEPING_TABLE} (id, checksum, "appliedAt", "executionMs") VALUES ($1, $2, NOW(), $3)`,
          [file, checksum, executionMs]
        );
        await client.query("COMMIT");
        log(`✅ ${file} applied (${executionMs} ms)`);
        appliedNow.push(file);
      } catch (err) {
        await client.query("ROLLBACK").catch(() => {});
        throw new Error(
          `migration ${file} failed and was fully rolled back: ${err.message}\n` +
            "   No rows were changed and schema_migrations was NOT updated for this file.\n" +
            "   Fix the reported state (duplicate remediation: docs/migration-phase6.md) and re-run."
        );
      }
    }
    log(`✅ Migrations complete. Applied ${appliedNow.length} migration(s).`);
    return { applied: appliedNow, pending: [], upToDate: false };
  } finally {
    await client.end();
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const dialect = resolveDialect();
  const settings = dialect === "postgres" ? resolvePostgresSettings() : resolveMysqlSettings();
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
  // The PG branch resolves its own PG_* settings (passing the guard's settings
  // object is rejected there); MySQL keeps passing them as before.
  if (dialect === "postgres") await runMigrations({ statusOnly });
  else await runMigrations({ settings, statusOnly });
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
  splitPgStatements,
  computeChecksum,
  discoverMigrationFiles,
  discoverPgMigrationFiles,
  getAppliedMigrations,
  bookkeepingTableExists,
  ensureBookkeepingTable,
  MIGRATIONS_DIR,
  BOOKKEEPING_TABLE
};
