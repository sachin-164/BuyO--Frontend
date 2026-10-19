#!/usr/bin/env node
// scripts/db-restore.js
// Restores a JSON backup (created by db:backup) into a DISPOSABLE local database.
//
// This is the drill/recovery tool: it never restores over the database the
// backup was taken from, never restores into an existing database (create a
// fresh target name), and verifies every table's row count afterwards.
//
// DUAL-DIALECT (Migration Phase 7): the guards and verification are identical
// for both databases; the accepted backup format follows the active dialect —
// MySQL restores `buyo-mysql-backup/1`, PostgreSQL restores `buyo-pg-backup/1`
// (a format from the other dialect is refused). PostgreSQL settings come from
// PG_* env vars only (never DATABASE_URL; loopback-only, no SSL).
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
const {
  resolveDialect,
  resolveMysqlSettings,
  resolvePostgresSettings,
  toMysql2Options
} = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");
const { enforceRemoteGateOrExit } = require("./lib/remoteTargetGate");
const { pgClientOptions } = require("./lib/pgClientOptions");

const BACKUP_DIR = path.resolve(__dirname, "..", "backups");
const SCRATCH_DATABASE_PATTERN = /^buyodb_[a-z0-9_]+$/i;

// Migration Phase 7 (same rule as the migration runner): the PostgreSQL path
// resolves its target from PG_* env vars only.
const PG_ENV_ONLY =
  "PostgreSQL db:restore resolves its target from PG_* environment variables only " +
  "(DB_DIALECT=postgres); passing explicit settings is not supported on this path.";

function escapeIdentifier(name) {
  return `\`${String(name).replace(/`/g, "``")}\``;
}

// PostgreSQL identifier quoting (double quotes).
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function reviveValue(value) {
  if (value && typeof value === "object") {
    if (value.__type === "Date") return new Date(value.iso);
    if (value.__type === "Buffer") return Buffer.from(value.base64, "base64");
    // mysql2 AND pg both return JSON columns already parsed (object/array).
    // Re-serialize so the INSERT sends valid JSON text — an object would reach
    // the database as the invalid string "[object Object]" and fail the
    // restore. (Re-serialized plain objects are exactly what JSON columns need.)
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

// --------------------------------------------------------------------------
// Library entry point (used by tests and by main()).
// Guards (source-name, scratch pattern) run for BOTH dialects before any
// connection is made; each dialect then only accepts its own backup format.
// --------------------------------------------------------------------------

async function runRestore({ backupPath, targetDatabase, settings: explicitSettings, log = console.log }) {
  const database = String(targetDatabase || "").trim();
  if (!database) throw new Error("A target database name is required (--target).");

  const backup = JSON.parse(await fsp.readFile(backupPath, "utf8"));
  const dialect = resolveDialect();
  const expectedFormat = dialect === "postgres" ? "buyo-pg-backup/1" : "buyo-mysql-backup/1";
  if (backup.format !== expectedFormat) {
    throw new Error(`Unsupported backup format "${backup.format}" — expected ${expectedFormat}.`);
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

  if (dialect === "postgres") {
    if (explicitSettings) throw new Error(PG_ENV_ONLY);
    return runRestorePg({ backup, database, backupPath, log });
  }

  const settings = explicitSettings ?? resolveMysqlSettings();

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

// --------------------------------------------------------------------------
// PostgreSQL restore (Migration Phase 7) — mirrors the MySQL semantics:
// fresh target only, then enum types → sequences → tables → rows (count
// verified per table) → PK/unique/check constraints → foreign keys → indexes
// → sequence advancement past the restored ids.
//
// Constraints/FKs are applied AFTER the rows: PostgreSQL validates them on
// ADD, so a corrupted backup fails loudly instead of loading bad data.
// --------------------------------------------------------------------------

// Multi-row INSERT with positional $n placeholders (pg has no mysql2 "VALUES ?" batch).
function insertStatementPg(table, columns, rowCount) {
  const placeholders = [];
  let n = 0;
  for (let r = 0; r < rowCount; r++) {
    placeholders.push(`(${columns.map(() => `$${++n}`).join(", ")})`);
  }
  return (
    `INSERT INTO ${quoteIdent(table)} (${columns.map(quoteIdent).join(", ")}) ` +
    `VALUES ${placeholders.join(", ")}`
  );
}

// PostgreSQL does NOT advance sequences past manually inserted ids — after a
// restore, setval(seq, MAX(id), hasRows) makes the next DEFAULT insert land on
// MAX(id)+1 instead of colliding (empty table → nextval = 1).
function setvalStatementPg(table, column) {
  const t = quoteIdent(table);
  const c = quoteIdent(column);
  const regclassArg = `'${t.replace(/'/g, "''")}'`;
  const columnArg = `'${String(column).replace(/'/g, "''")}'`;
  return (
    `SELECT setval(pg_get_serial_sequence(${regclassArg}, ${columnArg}), ` +
    `GREATEST((SELECT MAX(${c}) FROM ${t}), 1), ` +
    `(SELECT MAX(${c}) FROM ${t}) IS NOT NULL)`
  );
}

async function runRestorePg({ backup, database, backupPath, log }) {
  const settings = resolvePostgresSettings();
  const { Client } = require("pg");
  // Phase 10: TLS threaded from the resolved settings (verification always on
  // for hosted targets; loopback stays plaintext).
  const connect = (dbName) => new Client(pgClientOptions(settings, dbName));

  // Create the target — it must not exist yet.
  const admin = connect("postgres");
  await admin.connect();
  try {
    const { rows } = await admin.query(`SELECT 1 FROM pg_database WHERE datname = $1`, [database]);
    if (rows.length) {
      throw new Error(`Refusing: database "${database}" already exists. Drop it first or choose a new target name.`);
    }
    await admin.query(`CREATE DATABASE ${quoteIdent(database)}`);
  } finally {
    await admin.end().catch(() => {});
  }

  const client = connect(database);
  await client.connect();
  try {
    // 1. Enum types first — column definitions reference them.
    for (const [name, labels] of Object.entries(backup.enumTypes || {})) {
      const values = labels.map((label) => `'${String(label).replace(/'/g, "''")}'`).join(", ");
      await client.query(`CREATE TYPE ${quoteIdent(name)} AS ENUM (${values})`);
    }

    // 2. Serial sequences (column defaults reference them), then tables.
    for (const [table, info] of Object.entries(backup.tables)) {
      for (const seq of info.sequences || []) {
        await client.query(`CREATE SEQUENCE IF NOT EXISTS ${seq.name}`);
      }
      await client.query(info.createSql);
      for (const seq of info.sequences || []) {
        await client.query(`ALTER SEQUENCE ${seq.name} OWNED BY ${quoteIdent(table)}.${quoteIdent(seq.column)}`);
      }
    }

    // 3. Rows, with per-table count verification (same contract as MySQL).
    const summary = {};
    for (const [table, info] of Object.entries(backup.tables)) {
      const rows = Array.isArray(info.rows) ? info.rows : [];
      if (rows.length) {
        const columns = Object.keys(rows[0]);
        const values = rows.map((row) => columns.map((column) => reviveValue(row[column])));
        for (const batch of chunk(values, 500)) {
          await client.query(insertStatementPg(table, columns, batch.length), batch.flat());
        }
      }
      const { rows: countRows } = await client.query(`SELECT COUNT(*) AS n FROM ${quoteIdent(table)}`);
      const actual = Number(countRows[0].n);
      const expected = Number(info.rowCount ?? rows.length);
      if (actual !== expected) {
        throw new Error(`Row count mismatch for "${table}": backup has ${expected}, restored ${actual}.`);
      }
      summary[table] = actual;
      log(`   ${table}: ${actual} rows restored`);
    }

    // 4. PK/unique/check constraints (validated on ADD), then foreign keys.
    for (const info of Object.values(backup.tables)) {
      for (const sql of info.constraintSqls || []) await client.query(sql);
    }
    for (const info of Object.values(backup.tables)) {
      for (const sql of info.fkSqls || []) await client.query(sql);
    }

    // 5. Remaining (non-constraint) indexes.
    for (const info of Object.values(backup.tables)) {
      for (const sql of info.indexSqls || []) await client.query(sql);
    }

    // 6. Advance sequences past the restored ids.
    for (const [table, info] of Object.entries(backup.tables)) {
      for (const seq of info.sequences || []) {
        await client.query(setvalStatementPg(table, seq.column));
      }
    }

    return { database, tables: summary, source: backupPath };
  } finally {
    await client.end().catch(() => {});
  }
}

async function main() {
  const flags = new Set(process.argv.slice(2));
  const dialect = resolveDialect();
  const settings = dialect === "postgres" ? resolvePostgresSettings() : resolveMysqlSettings();

  // Phase 10: non-loopback POSTGRESQL targets must pass the remote approval
  // gate (refuses BEFORE any connection); loopback + MySQL keep the exact
  // local-guard flow (with the scratch-name allowlist exception) below.
  let mode = "local";
  if (dialect === "postgres") {
    mode = enforceRemoteGateOrExit({
      scriptLabel: "db:restore",
      usage: "npm run db:restore -- --target <buyoDB_scratch> --confirm-local [--file <backup.json>]",
      settings,
      flags
    });
  }

  const allowed = getAllowedDatabases("DB_RESTORE_ALLOWED_DATABASES", []);
  const targetIndex = [...flags].indexOf("--target");
  const target = targetIndex >= 0 ? [...flags][targetIndex + 1] : undefined;

  if (mode === "local") {
    const reasons = collectLocalGuardReasons({
      flags,
      settings,
      allowed,
      allowedEnvVar: "DB_RESTORE_ALLOWED_DATABASES"
    });
    // The scratch-pattern exception (buyoDB_*) is handled inside runRestore; the
    // generic guard still requires a confirm flag, loopback host and non-prod.
    const allowListReason = reasons.find((r) => r.includes("DB_RESTORE_ALLOWED_DATABASES"));
    if (allowListReason && target && SCRATCH_DATABASE_PATTERN.test(target)) {
      reasons.splice(reasons.indexOf(allowListReason), 1);
    }
    if (reasons.length) {
      refuseLocal("db:restore", "npm run db:restore -- --target <buyoDB_scratch> --confirm-local [--file <backup.json>]", reasons);
    }
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
  // The PG library path refuses explicit settings (PG_* env only); MySQL keeps
  // receiving the guard's resolved settings as before.
  const result =
    dialect === "postgres"
      ? await runRestore({ backupPath, targetDatabase: target })
      : await runRestore({ backupPath, targetDatabase: target, settings });
  console.log(`✅ Restore verified: ${Object.keys(result.tables).length} table(s), row counts match the backup.`);
  const dropHint = dialect === "postgres" ? quoteIdent(target) : escapeIdentifier(target);
  console.log(`   This is a scratch database — drop it when done: DROP DATABASE ${dropHint}`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ db:restore failed:", err.message);
    process.exit(1);
  });
}

module.exports = { runRestore, findLatestBackup };
