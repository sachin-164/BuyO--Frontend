#!/usr/bin/env node
// scripts/db-backup.js
// Exports the MySQL database (schema + all rows) to a timestamped JSON dump so it
// can be restored and verified reliably. Read-only against the database.
//
// Output: backend/backups/buyo-backup-<YYYYMMDD-HHmmss>.json
//   - contains: metadata, per-table DDL (SHOW CREATE TABLE), row counts, all rows
//   - never contains credentials (no env values, usernames, passwords or URLs)
//   - written ONLY inside backend/backups/ (git-ignored)
//
// Safety guard: refuses a non-loopback host unless --allow-remote is passed
// explicitly (intended for the future hosted database).
//
// Usage:
//   npm run db:backup
//   npm run db:backup -- --allow-remote
//
// Also usable as a library (used by the migration tests): createBackup({...}).

const fsp = require("fs/promises");
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const { resolveMysqlSettings, isLoopbackHost, toMysql2Options } = require("../config/dbConnectionOptions");

const BACKUP_DIR = path.resolve(__dirname, "..", "backups");

function timestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}` +
    `-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`
  );
}

function escapeIdentifier(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return { __type: "Buffer", base64: value.toString("base64") };
  if (value instanceof Date) return { __type: "Date", iso: value.toISOString() };
  return value;
}

// Library entry point. Throws on refusal (non-loopback without --allow-remote).
async function createBackup({ flags = new Set(), settings = resolveMysqlSettings(), outDir = BACKUP_DIR } = {}) {
  if (!settings.database) throw new Error("No database configured (MYSQL_DB).");
  if (!isLoopbackHost(settings.host) && !flags.has("--allow-remote")) {
    const err = new Error(`host "${settings.host}" is not loopback.`);
    err.refusedRemote = true;
    throw err;
  }

  const connection = await mysql.createConnection(toMysql2Options(settings));
  let tables;
  const dump = {
    format: "buyo-mysql-backup/1",
    createdAt: new Date().toISOString(),
    database: settings.database,
    tables: {}
  };

  try {
    const [tableRows] = await connection.query("SHOW TABLES");
    tables = tableRows.map((row) => Object.values(row)[0]);

    for (const table of tables) {
      const [[ddlRow]] = await connection.query(`SHOW CREATE TABLE ${escapeIdentifier(table)}`);
      const createSql = ddlRow["Create Table"] ?? Object.values(ddlRow)[1];
      const [rows] = await connection.query(`SELECT * FROM ${escapeIdentifier(table)}`);

      dump.tables[table] = {
        rowCount: rows.length,
        createSql,
        rows: rows.map((row) => {
          const normalized = {};
          for (const [column, value] of Object.entries(row)) normalized[column] = normalizeValue(value);
          return normalized;
        })
      };
    }
  } finally {
    await connection.end();
  }

  await fsp.mkdir(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `buyo-backup-${timestamp()}.json`);
  if (!outPath.startsWith(outDir + path.sep)) {
    throw new Error("Refusing to write outside the backups directory.");
  }

  await fsp.writeFile(outPath, JSON.stringify(dump, null, 2), "utf8");

  return { outPath, database: settings.database, tables, dump };
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  try {
    const result = await createBackup({ flags });
    const counts = result.tables.map((t) => `${t}:${result.dump.tables[t].rowCount}`).join(", ");
    console.log(`✅ Backup written: ${path.relative(path.join(__dirname, ".."), result.outPath)}`);
    console.log(`   Tables (${result.tables.length}): ${counts || "(none)"}`);
    console.log("   Contains schema + data + row counts. No credentials are stored.");
  } catch (err) {
    if (err.refusedRemote) {
      console.error(`❌ REFUSED: ${err.message}`);
      console.error("   Pass --allow-remote only when you intend to back up a hosted database.");
      process.exit(1);
    }
    throw err;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ db:backup failed:", err.message);
    process.exit(1);
  });
}

module.exports = { createBackup, BACKUP_DIR };
