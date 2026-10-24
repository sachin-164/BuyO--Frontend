#!/usr/bin/env node
// scripts/db-backup.js
// Exports the database (schema + all rows) to a timestamped JSON dump so it
// can be restored and verified reliably. Read-only against the database.
//
// DUAL-DIALECT (Migration Phase 7):
//   - MySQL (default): format `buyo-mysql-backup/1` — SHOW TABLES / SHOW CREATE
//     TABLE / SELECT *. Byte-identical to the pre-Phase-7 behavior.
//   - PostgreSQL (DB_DIALECT=postgres): format `buyo-pg-backup/1` — pg_catalog
//     metadata (columns + types + defaults + serial sequences, PK/unique/check
//     constraints, foreign keys, non-constraint indexes, enum types) + SELECT *.
//     A tested in-process equivalent of pg_dump for this guarded local tool —
//     see docs/migration-phase7.md for prerequisites and limitations.
//   The two formats are NOT interchangeable: db:restore only accepts the
//   format matching the active dialect.
//
// Output: backend/backups/buyo-backup-<YYYYMMDD-HHmmss>.json
//   - contains: metadata, per-table DDL, row counts, all rows
//   - never contains credentials (no env values, usernames, passwords or URLs)
//   - written ONLY inside backend/backups/ (git-ignored)
//
// Safety guard: refuses a non-loopback host unless --allow-remote is passed
// explicitly (intended for the future hosted database). PostgreSQL settings
// come from PG_* env vars only — never DATABASE_URL (loopback-only, no SSL).
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
const {
  resolveDialect,
  resolveMysqlSettings,
  resolvePostgresSettings,
  isLoopbackHost,
  toMysql2Options
} = require("../config/dbConnectionOptions");
const { assertRemoteGateApproved } = require("./lib/remoteTargetGate");
const { pgClientOptions } = require("./lib/pgClientOptions");

const BACKUP_DIR = path.resolve(__dirname, "..", "backups");

// A dump contains PII (emails, addresses, order history) and password hashes.
// Writing it into a consumer cloud-sync folder (OneDrive/Dropbox/iCloud/Google
// Drive) copies it to a third party outside the access controls of this repo.
// We warn loudly instead of silently accepting it; docs/backup-restore.md
// requires an encrypted, access-restricted destination for real backups.
const CLOUD_SYNC_MARKERS = [/onedrive/i, /dropbox/i, /google[ _-]?drive/i, /icloud/i, /sharepoint/i];

function cloudSyncFolderFor(target) {
  const normalized = path.resolve(target);
  return CLOUD_SYNC_MARKERS.find((marker) => marker.test(normalized));
}

function warnIfCloudSynced(outDir) {
  const marker = cloudSyncFolderFor(outDir);
  if (!marker) return;
  console.warn(
    "⚠️  WARNING: this backup directory is inside a consumer cloud-sync folder. " +
      "The dump contains PII and password hashes. Move it to encrypted, access-restricted storage " +
      "and delete the plaintext copy (docs/backup-restore.md §1.1)."
  );
}

// Migration Phase 7 (same rule as the migration runner): the PostgreSQL path
// resolves its target from PG_* env vars only; explicit settings are a
// MySQL-path concept and must not be silently ignored.
const PG_ENV_ONLY =
  "PostgreSQL db:backup resolves its target from PG_* environment variables only " +
  "(DB_DIALECT=postgres); passing explicit settings is not supported on this path.";

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

// PostgreSQL identifier quoting (double quotes).
function quoteIdent(name) {
  return `"${String(name).replace(/"/g, '""')}"`;
}

function normalizeValue(value) {
  if (value === null || value === undefined) return value;
  if (Buffer.isBuffer(value)) return { __type: "Buffer", base64: value.toString("base64") };
  if (value instanceof Date) return { __type: "Date", iso: value.toISOString() };
  return value;
}

function normalizeRow(row) {
  const normalized = {};
  for (const [column, value] of Object.entries(row)) normalized[column] = normalizeValue(value);
  return normalized;
}

// Shared refusal: non-loopback hosts need the explicit --allow-remote opt-in.
function assertBackupTargetAllowed(settings, flags, envLabel) {
  if (!settings.database) throw new Error(`No database configured (${envLabel}).`);
  if (!isLoopbackHost(settings.host) && !flags.has("--allow-remote")) {
    const err = new Error(`host "${settings.host}" is not loopback.`);
    err.refusedRemote = true;
    throw err;
  }
}

// --------------------------------------------------------------------------
// MySQL dump (format buyo-mysql-backup/1) — unchanged behavior.
// --------------------------------------------------------------------------

async function buildMysqlDump(settings) {
  const connection = await mysql.createConnection(toMysql2Options(settings));
  const dump = {
    format: "buyo-mysql-backup/1",
    createdAt: new Date().toISOString(),
    database: settings.database,
    tables: {}
  };

  try {
    const [tableRows] = await connection.query("SHOW TABLES");
    const tables = tableRows.map((row) => Object.values(row)[0]);

    for (const table of tables) {
      const [[ddlRow]] = await connection.query(`SHOW CREATE TABLE ${escapeIdentifier(table)}`);
      const createSql = ddlRow["Create Table"] ?? Object.values(ddlRow)[1];
      const [rows] = await connection.query(`SELECT * FROM ${escapeIdentifier(table)}`);

      dump.tables[table] = {
        rowCount: rows.length,
        createSql,
        rows: rows.map(normalizeRow)
      };
    }
  } finally {
    await connection.end();
  }
  return dump;
}

// --------------------------------------------------------------------------
// PostgreSQL dump (format buyo-pg-backup/1) — Migration Phase 7.
//
// PostgreSQL has no SHOW CREATE TABLE, so the DDL is rebuilt from pg_catalog
// (physical names, never assumed from model properties):
//   createSql      CREATE TABLE with column types (format_type), NOT NULL and
//                  verbatim defaults; serial columns keep their nextval
//                  default and the referenced sequence is listed separately
//   sequences      [{ name, column }] — created and owned around createSql
//   constraintSqls PK/unique/check/exclusion constraints (validated AFTER rows)
//   fkSqls         foreign keys (added AFTER every table's rows are loaded)
//   indexSqls      indexes that do NOT back a constraint (raw CREATE INDEX,
//                  incl. the Phase 6 functional uq_*_lower indexes)
//   rows           all data (SELECT *; Date/Buffer normalized like MySQL)
// --------------------------------------------------------------------------

async function describeTablePg(client, table) {
  const { rows: columns } = await client.query(
    `SELECT a.attname AS name, format_type(a.atttypid, a.atttypmod) AS type,
            a.attnotnull AS notnull, a.attgenerated AS generated,
            pg_get_expr(d.adbin, d.adrelid) AS default_expr
     FROM pg_attribute a
     JOIN pg_class c ON c.oid = a.attrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE n.nspname = current_schema() AND c.relname = $1
       AND a.attnum > 0 AND NOT a.attisdropped
     ORDER BY a.attnum`,
    [table]
  );

  const sequences = [];
  const lines = columns.map((col) => {
    if (col.generated) {
      throw new Error(`Unsupported generated column "${table}.${col.name}" in the backup path.`);
    }
    let line = `  ${quoteIdent(col.name)} ${col.type}`;
    if (col.notnull) line += " NOT NULL";
    if (col.default_expr) {
      line += ` DEFAULT ${col.default_expr}`;
      // Serial-style default: remember the sequence so the restore can
      // recreate it (and its ownership) before/after the table.
      const nextval = /^nextval\('(.+)'::regclass\)$/.exec(col.default_expr);
      if (nextval) sequences.push({ name: nextval[1], column: col.name });
    }
    return line;
  });
  const createSql = `CREATE TABLE ${quoteIdent(table)} (\n${lines.join(",\n")}\n)`;

  const { rows: constraints } = await client.query(
    `SELECT con.conname AS name, con.contype AS type, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relname = $1
       AND con.contype IN ('p', 'u', 'c', 'x')
     ORDER BY con.conname`,
    [table]
  );
  const constraintSqls = constraints.map(
    (row) => `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(row.name)} ${row.def}`
  );

  const { rows: fks } = await client.query(
    `SELECT con.conname AS name, pg_get_constraintdef(con.oid) AS def
     FROM pg_constraint con
     JOIN pg_class c ON c.oid = con.conrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = current_schema() AND c.relname = $1 AND con.contype = 'f'
     ORDER BY con.conname`,
    [table]
  );
  const fkSqls = fks.map(
    (row) => `ALTER TABLE ${quoteIdent(table)} ADD CONSTRAINT ${quoteIdent(row.name)} ${row.def}`
  );

  // Indexes NOT backing any constraint (constraint-backed and primary indexes
  // are rebuilt via constraintSqls above — emitting both would duplicate them).
  const { rows: indexes } = await client.query(
    `SELECT i.relname AS name, pg_get_indexdef(i.oid) AS def
     FROM pg_index ix
     JOIN pg_class i ON i.oid = ix.indexrelid
     JOIN pg_class t ON t.oid = ix.indrelid
     JOIN pg_namespace n ON n.oid = t.relnamespace
     LEFT JOIN pg_constraint con ON con.conindid = ix.indexrelid
     WHERE n.nspname = current_schema() AND t.relname = $1
       AND con.oid IS NULL AND NOT ix.indisprimary
     ORDER BY i.relname`,
    [table]
  );
  const indexSqls = indexes.map((row) => row.def);

  const { rows } = await client.query(`SELECT * FROM ${quoteIdent(table)}`);

  return {
    rowCount: rows.length,
    createSql,
    sequences,
    constraintSqls,
    fkSqls,
    indexSqls,
    rows: rows.map(normalizeRow)
  };
}

async function buildPgDump(settings) {
  const { Client } = require("pg");
  // Phase 10: TLS threaded from the resolved settings (verification always on
  // for hosted targets; loopback stays plaintext).
  const client = new Client(pgClientOptions(settings));
  await client.connect();

  const dump = {
    format: "buyo-pg-backup/1",
    createdAt: new Date().toISOString(),
    database: settings.database,
    enumTypes: {},
    tables: {}
  };

  try {
    // Enum types referenced by any column (e.g. Users.role) — restore needs
    // CREATE TYPE before the tables that use them. The subquery yields DISTINCT
    // type oids: a type used by several columns must not duplicate its labels
    // (CREATE TYPE rejects duplicate labels).
    const { rows: enumRows } = await client.query(
      `SELECT t.typname AS name, e.enumlabel AS label, e.enumsortorder AS ord
       FROM pg_type t
       JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typtype = 'e'
         AND t.oid IN (
           SELECT DISTINCT a.atttypid
           FROM pg_attribute a
           JOIN pg_class c ON c.oid = a.attrelid
           JOIN pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = current_schema() AND a.attnum > 0 AND NOT a.attisdropped
         )
       ORDER BY t.typname, e.enumsortorder`
    );
    for (const row of enumRows) (dump.enumTypes[row.name] ??= []).push(row.label);

    const { rows: tableRows } = await client.query(
      `SELECT tablename FROM pg_tables WHERE schemaname = current_schema() ORDER BY tablename`
    );
    for (const row of tableRows) {
      dump.tables[row.tablename] = await describeTablePg(client, row.tablename);
    }
  } finally {
    await client.end();
  }
  return dump;
}

// --------------------------------------------------------------------------
// Library entry point. Throws on refusal (non-loopback without --allow-remote).
// --------------------------------------------------------------------------

async function createBackup(options = {}) {
  const { flags = new Set(), outDir = BACKUP_DIR } = options;
  const explicitSettings = options.settings;
  const dialect = resolveDialect();

  let dump;
  let database;
  if (dialect === "postgres") {
    if (explicitSettings) throw new Error(PG_ENV_ONLY);
    const settings = resolvePostgresSettings();
    assertBackupTargetAllowed(settings, flags, "PG_DB");
    // Phase 10: for a POSTGRESQL target, --allow-remote alone is no longer
    // sufficient — the full remote approval gate must pass too (throws a
    // credential-free, refusal-flagged error BEFORE any connection). The
    // MySQL path keeps its exact --allow-remote behavior, unchanged.
    if (!isLoopbackHost(settings.host)) {
      assertRemoteGateApproved({ scriptLabel: "db:backup", settings, flags });
    }
    database = settings.database;
    dump = await buildPgDump(settings);
  } else {
    const settings = explicitSettings ?? resolveMysqlSettings();
    assertBackupTargetAllowed(settings, flags, "MYSQL_DB");
    database = settings.database;
    dump = await buildMysqlDump(settings);
  }

  await fsp.mkdir(outDir, { recursive: true });
  const outPath = path.resolve(outDir, `buyo-backup-${timestamp()}.json`);
  if (!outPath.startsWith(outDir + path.sep)) {
    throw new Error("Refusing to write outside the backups directory.");
  }
  warnIfCloudSynced(outDir);

  await fsp.writeFile(outPath, JSON.stringify(dump, null, 2), "utf8");

  return { outPath, database, tables: Object.keys(dump.tables), dump };
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
      if (err.remoteGate) {
        // Phase 10 gate failure — print every (credential-free) reason.
        for (const reason of err.remoteGateReasons || []) console.error(`   - ${reason}`);
        console.error("   A PostgreSQL remote backup needs BOTH --allow-remote AND every approval gate condition");
        console.error("   (docs/migration-remote.md).");
      } else {
        console.error("   Pass --allow-remote only when you intend to back up a hosted database.");
      }
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
