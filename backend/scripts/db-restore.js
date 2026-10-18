#!/usr/bin/env node
// scripts/db-restore.js
// Restores a JSON backup (created by db:backup) into a DISPOSABLE local database.
//
// This is the drill/recovery tool: it never restores over the database the
// backup was taken from, never restores into an existing database (create a
// fresh target name), and verifies every table's row count afterwards.
//
// Usage:
//   npm run db:restore -- --file backups/buyo-backup-<stamp>.json --target buyoDB_restore_check --confirm-local
//   npm run db:restore -- --target buyoDB_restore_check --confirm-local        (uses newest backup)
//
// Safety rules:
//   1. --confirm-local + loopback host + NODE_ENV != production (like other tools)
//   2. target must match buyoDB_* (scratch pattern) or be listed in
//      DB_RESTORE_ALLOWED_DATABASES explicitly
//   3. target must NOT be the backup's source database (or any existing database)
//   4. row counts are verified against the backup metadata; mismatch = failure

const fs = require("fs");
const fsp = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const { resolveMysqlSettings, toMysql2Options } = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");

const BACKUP_DIR = path.resolve(__dirname, "..", "backups");
const SCRATCH_DATABASE_PATTERN = /^buyodb_[a-z0-9_]+$/i;

function escapeIdentifier(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

function reviveValue(value) {
  if (value && typeof value === "object") {
    if (value.__type === "Date") return new Date(value.iso);
    if (value.__type === "Buffer") return Buffer.from(value.base64, "base64");
    // mysql2 returns JSON columns already parsed (object/array). Re-serialize so
    // the INSERT sends valid JSON text — an object would reach MySQL as the
    // invalid string "[object Object]" and fail the restore.
    return JSON.stringify(value);
  }
  return value;
}

function chunk(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) chunks.push(items.slice(i, i + size));
  return chunks;
}

async function findLatestBackup() {
  const entries = await fsp.readdir(BACKUP_DIR).catch(() => []);
  const backups = entries.filter((name) => /^buyo-backup-\d{8}-\d{6}\.json$/.test(name)).sort();
  if (!backups.length) throw new Error(`No backups found in ${BACKUP_DIR} — run: npm run db:backup`);
  return path.join(BACKUP_DIR, backups[backups.length - 1]);
}

// Library entry point (used by tests and by main()).
async function runRestore({ backupPath, targetDatabase, settings = resolveMysqlSettings(), log = console.log }) {
  const database = String(targetDatabase || "").trim();
  if (!database) throw new Error("A target database name is required (--target).");

  const backup = JSON.parse(await fsp.readFile(backupPath, "utf8"));
  if (backup.format !== "buyo-mysql-backup/1") {
    throw new Error(`Unsupported backup format "${backup.format}" — expected buyo-mysql-backup/1.`);
  }
  const sourceDatabase = String(backup.database || "");
  if (sourceDatabase.toLowerCase() === database.toLowerCase()) {
    throw new Error(`Refusing to restore over the database the backup was taken from ("${sourceDatabase}"). Pick a scratch target.`);
  }
  const explicitlyAllowed = getAllowedDatabases("DB_RESTORE_ALLOWED_DATABASES");
  if (!SCRATCH_DATABASE_PATTERN.test(database) && !explicitlyAllowed.includes(database)) {
    throw new Error(
      `Refusing: "${database}" is not a buyoDB_* scratch database. ` +
        "Add it to DB_RESTORE_ALLOWED_DATABASES to allow it explicitly."
    );
  }

  // Create the target — it must not exist yet.
  const adminConnection = await mysql.createConnection(toMysql2Options(settings, { includeDatabase: false }));
  try {
    const [exists] = await adminConnection.query(
      "SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?",
      [database]
    );
    if (exists.length) {
      throw new Error(`Refusing: database "${database}" already exists. Drop it first or choose a new target name.`);
    }
    await adminConnection.query(`CREATE DATABASE ${escapeIdentifier(database)}`);
  } finally {
    await adminConnection.end();
  }

  const connection = await mysql.createConnection(toMysql2Options({ ...settings, database }));
  try {
    // FK checks off while loading (standard dump/restore technique; verified below).
    await connection.query("SET FOREIGN_KEY_CHECKS = 0");

    const tableNames = Object.keys(backup.tables);
    for (const table of tableNames) {
      await connection.query(backup.tables[table].createSql);
    }

    const summary = {};
    for (const table of tableNames) {
      const info = backup.tables[table];
      const rows = Array.isArray(info.rows) ? info.rows : [];
      if (rows.length) {
        const columns = Object.keys(rows[0]);
        const values = rows.map((row) => columns.map((column) => reviveValue(row[column])));
        for (const batch of chunk(values, 500)) {
          await connection.query(
            `INSERT INTO ${escapeIdentifier(table)} (${columns.map(escapeIdentifier).join(", ")}) VALUES ?`,
            [batch]
          );
        }
      }
      const [[countRow]] = await connection.query(`SELECT COUNT(*) AS n FROM ${escapeIdentifier(table)}`);
      const expected = Number(info.rowCount ?? rows.length);
      if (countRow.n !== expected) {
        throw new Error(`Row count mismatch for "${table}": backup has ${expected}, restored ${countRow.n}.`);
      }
      summary[table] = countRow.n;
      log(`   ${table}: ${countRow.n} rows restored`);
    }

    await connection.query("SET FOREIGN_KEY_CHECKS = 1");
    return { database, tables: summary, source: backupPath };
  } finally {
    await connection.end();
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const settings = resolveMysqlSettings();
  const allowed = getAllowedDatabases("DB_RESTORE_ALLOWED_DATABASES", []);

  const reasons = collectLocalGuardReasons({
    flags,
    settings,
    allowed,
    allowedEnvVar: "DB_RESTORE_ALLOWED_DATABASES"
  });
  // The scratch-pattern exception (buyoDB_*) is handled inside runRestore; the
  // generic guard still requires a confirm flag, loopback host and non-prod.
  const targetIndex = [...flags].indexOf("--target");
  const target = targetIndex >= 0 ? [...flags][targetIndex + 1] : undefined;
  const allowListReason = reasons.find((r) => r.includes("DB_RESTORE_ALLOWED_DATABASES"));
  if (allowListReason && target && SCRATCH_DATABASE_PATTERN.test(target)) {
    reasons.splice(reasons.indexOf(allowListReason), 1);
  }
  if (reasons.length) {
    refuseLocal("db:restore", "npm run db:restore -- --target <buyoDB_scratch> --confirm-local [--file <backup.json>]", reasons);
  }

  if (!target) {
    console.error("❌ Usage: npm run db:restore -- --target <buyoDB_scratch> --confirm-local [--file <backup.json>]");
    process.exit(1);
  }

  const fileIndex = [...flags].indexOf("--file");
  const file = fileIndex >= 0 ? [...flags][fileIndex + 1] : undefined;
  const backupPath = file ? path.resolve(file) : await findLatestBackup();
  if (!fs.existsSync(backupPath)) {
    console.error(`❌ Backup file not found: ${backupPath}`);
    process.exit(1);
  }

  console.log(`→ Restoring ${path.relative(path.join(__dirname, ".."), backupPath)} into "${target}"...`);
  const result = await runRestore({ backupPath, targetDatabase: target, settings });
  console.log(`✅ Restore verified: ${Object.keys(result.tables).length} table(s), row counts match the backup.`);
  console.log(`   This is a scratch database — drop it when done: DROP DATABASE ${escapeIdentifier(target)}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ db:restore failed:", err.message);
    process.exit(1);
  });
}

module.exports = { runRestore, findLatestBackup };
