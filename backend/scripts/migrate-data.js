// scripts/migrate-data.js — Phase 11: MySQL → PostgreSQL DATA migration
// (schema on the PostgreSQL side always comes from models sync + the numbered
// .pgsql migrations — never from this tool).
//
// SCOPE AND SAFETY
//   - Source: local MySQL only (non-loopback source = hard refusal; the
//     source is opened READ-ONLY inside `START TRANSACTION WITH CONSISTENT
//     SNAPSHOT` so every table is seen at one point in time).
//   - Target: PostgreSQL only (DB_DIALECT=postgres). Loopback targets reuse
//     the existing local guard (--confirm-local + DB_DATA_MIGRATE_ALLOWED_
//     DATABASES allowlist, default: the documented rehearsal scratch name);
//     non-loopback targets must pass the FULL remote approval gate
//     (remoteTargetGate). There is deliberately no alternate unguarded route:
//     the SAME guards run for the CLI and the library entry point, BEFORE any
//     connection is created.
//   - DATABASE_URL is never read; the target comes only from --target-db +
//     PG_* env (and the remote gate's tripwire still applies on hosted runs).
//   - Everything that writes happens in ONE PostgreSQL transaction: inserts +
//     sequence reset. Any error rolls back completely → the target stays
//     empty → a rerun is safe. A target that already contains rows is refused
//     explicitly (previously-imported protection).
//   - Validation runs BEFORE anything is written. Violations (duplicate
//     uniques — including the case-insensitive email/category rules —, missing
//     FK parents, invalid enum values, NOT NULL gaps, column drift) are
//     reported by row id + reason and REFUSED. Rows are never silently
//     discarded, merged or "auto-fixed".
//   - Output is credential-free: table names, row counts, row ids, check
//     names. Never emails, passwords, tokens, hosts or URLs.
//
// CLI:
//   node scripts/migrate-data.js --source-db <mysql-db> --target-db <pg-db>
//        --confirm-local [--dry-run]
const path = require("path");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const { Client } = require("pg");

const {
  resolveDialect,
  resolveMysqlSettings,
  resolvePostgresSettings,
  isLoopbackHost,
  toMysql2Options
} = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");
const { enforceRemoteGateOrExit } = require("./lib/remoteTargetGate");
const { pgClientOptions } = require("./lib/pgClientOptions");

const USAGE =
  "node scripts/migrate-data.js --source-db <mysql-db> --target-db <pg-db> --confirm-local [--dry-run]";

// FK-dependency order: every table appears only after its non-null parents.
// Names come from the models themselves (getTableName), so they match exactly
// what sequelize.sync() created on the PostgreSQL side — never guessed.
const TABLE_ORDER = [
  "User",
  "Category",
  "Address",
  "Product",
  "Order",
  "OrderItem",
  "OrderStatusEvent",
  "CartItem",
  "WishlistItem"
];

// ---------------------------------------------------------------- refusals

class MigrationRefusal extends Error {
  constructor(lines) {
    super(Array.isArray(lines) ? lines.join("\n") : String(lines));
    this.migrationRefusal = true;
  }
}

function printRefusal(lines) {
  const text = Array.isArray(lines) ? lines : [String(lines)];
  console.error("❌ REFUSED: migrate:data — nothing was written.");
  for (const line of text) console.error(`   ${line}`);
}

// ---------------------------------------------------------------- guards

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  const list = [...argv];
  for (let i = 0; i < list.length; i++) {
    const arg = list[i];
    if (arg === "--source-db" || arg === "--target-db") values[arg] = list[++i];
    else flags.add(arg);
  }
  return { flags, values };
}

// Applies every guard BEFORE any connection is created. CLI mode prints a
// credential-free refusal and exits 1; library mode throws MigrationRefusal.
function guardOrRefuse({ flags = new Set(), values = {}, throwOnRefuse = false } = {}) {
  const refuse = (lines) => {
    if (throwOnRefuse) throw new MigrationRefusal(lines);
    printRefusal(lines);
    process.exit(1);
  };

  const sourceDb = values["--source-db"];
  const targetDb = values["--target-db"];
  const missing = [];
  if (!sourceDb) missing.push("--source-db <mysql-db> (explicit source configuration is required)");
  if (!targetDb) missing.push("--target-db <pg-db> (explicit target configuration is required)");
  if (missing.length) return refuse([...missing, `usage: ${USAGE}`]);

  // Target side must be PostgreSQL.
  if (resolveDialect() !== "postgres") {
    return refuse([
      "the data migration target is PostgreSQL — set DB_DIALECT=postgres (and PG_* env)",
      "the source is always MySQL, configured via MYSQL_* + --source-db"
    ]);
  }

  // Source: loopback MySQL, always (no remote sources in this phase).
  const sourceSettings = resolveMysqlSettings();
  if (!isLoopbackHost(sourceSettings.host)) {
    return refuse([
      `source host "${sourceSettings.host}" is not loopback — remote MySQL sources are not supported`,
      "the source database must be a local MySQL (MYSQL_HOST=localhost/127.0.0.1/::1)"
    ]);
  }

  // Target: reuse the existing safeguards exactly (no alternate route).
  const targetSettings = { ...resolvePostgresSettings(), database: targetDb };
  const mode = enforceRemoteGateOrExit({
    scriptLabel: "migrate:data",
    usage: USAGE,
    settings: targetSettings,
    flags
  });
  if (mode === "local") {
    const allowed = getAllowedDatabases("DB_DATA_MIGRATE_ALLOWED_DATABASES", ["buyoDB_ph11_import"]);
    const reasons = collectLocalGuardReasons({
      flags,
      settings: targetSettings,
      allowed,
      allowedEnvVar: "DB_DATA_MIGRATE_ALLOWED_DATABASES"
    });
    if (reasons.length) {
      if (throwOnRefuse) throw new MigrationRefusal([`usage: ${USAGE}`, ...reasons]);
      refuseLocal("migrate:data", USAGE, reasons);
    }
  }
  return { sourceDb, targetDb, sourceSettings, targetSettings };
}

// ---------------------------------------------------------------- discovery

async function findSourceTableName(mysqlConn, wanted) {
  const [rows] = await mysqlConn.query("SHOW TABLES");
  const actual = rows.map((r) => Object.values(r)[0]);
  return actual.find((n) => n.toLowerCase() === wanted.toLowerCase()) || null;
}

async function findTargetTableName(client, wanted) {
  const { rows } = await client.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = 'public' AND lower(table_name) = lower($1)`,
    [wanted]
  );
  return rows[0] ? rows[0].table_name : null;
}

// Simple (non-expression, non-partial, non-primary) unique column-sets on the
// target: model-created constraints AND plain unique indexes both count, so
// 005/006-style uniques are covered. Expression indexes (lower(...)) are
// handled by the explicit checks below (they mirror numbered migration 007).
async function discoverTargetUniques(client) {
  const { rows } = await client.query(`
    SELECT replace(i.indrelid::regclass::text, '"', '') AS table_name,
           i.indexrelid::text AS index_id,
           a.attname AS column_name
    FROM pg_index i
    JOIN LATERAL unnest(i.indkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute a ON a.attrelid = i.indrelid AND a.attnum = k.attnum
    WHERE i.indisunique
      AND i.indisprimary = false
      AND i.indpred IS NULL
      AND i.indexprs IS NULL
      AND a.attnum > 0
    ORDER BY i.indexrelid, k.ord
  `);
  // Group per index in JS: node-postgres returns Postgres arrays as "{...}"
  // text unless type parsers are registered, so no array_agg here.
  const byIndex = {};
  for (const r of rows) {
    if (!byIndex[r.index_id]) byIndex[r.index_id] = { table: r.table_name, columns: [] };
    byIndex[r.index_id].columns.push(r.column_name);
  }
  const byTable = {};
  for (const entry of Object.values(byIndex)) {
    (byTable[entry.table] = byTable[entry.table] || []).push(entry.columns);
  }
  return byTable;
}

async function discoverTargetColumns(client, table) {
  const { rows } = await client.query(
    `SELECT column_name, data_type, udt_name, is_nullable, column_default
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = $1
     ORDER BY ordinal_position`,
    [table]
  );
  return rows;
}

async function discoverFks(client) {
  const { rows } = await client.query(`
    SELECT replace(c.conrelid::regclass::text, '"', '')  AS child_table,
           a.attname                                      AS child_column,
           replace(c.confrelid::regclass::text, '"', '') AS parent_table
    FROM pg_constraint c
    JOIN LATERAL unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord) ON TRUE
    JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace
  `);
  return rows;
}

async function discoverEnumLabels(client) {
  const { rows } = await client.query(`
    SELECT t.typname, e.enumlabel
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    WHERE t.typnamespace = 'public'::regnamespace
    ORDER BY t.typname, e.enumsortorder
  `);
  const labels = {};
  for (const r of rows) (labels[r.typname] = labels[r.typname] || []).push(r.enumlabel);
  return labels;
}

// ---------------------------------------------------------------- values

function coerceValue(value, dataType) {
  if (value === null || value === undefined) return null;
  switch (dataType) {
    case "boolean":
      return value === true || value === 1 || value === "1";
    case "json":
    case "jsonb":
      return typeof value === "string" ? value : JSON.stringify(value);
    case "integer":
    case "bigint":
    case "smallint":
    case "real":
    case "double precision":
      return typeof value === "string" ? Number(value) : value;
    case "numeric":
      return typeof value === "string" ? value : String(value);
    case "timestamp with time zone":
    case "timestamp without time zone":
      return value instanceof Date ? value : new Date(value);
    case "USER-DEFINED":
      return String(value); // enum labels
    default:
      return value; // varchar/text/char
  }
}

// ---------------------------------------------------------------- validation

function addViolation(list, check, ids) {
  if (!ids.length) return;
  list.push({ check, count: ids.length, ids: ids.slice(0, 50) });
}

function validateTable({ table, sourceRows, targetColumns, uniques, fks, enumLabels, parentIds }) {
  const violations = [];

  // 0. column drift: every SOURCE column must exist on the target — no
  //    silent drops in either direction (target-only columns use defaults).
  if (sourceRows.length) {
    const targetNames = new Set(targetColumns.map((c) => c.column_name));
    for (const col of Object.keys(sourceRows[0])) {
      if (!targetNames.has(col)) {
        violations.push({ check: `column drift: source column "${col}" missing on target`, count: 0, ids: [] });
      }
    }
  }

  // 1. NOT NULL without default
  for (const c of targetColumns.filter((c) => c.is_nullable === "NO" && c.column_default === null)) {
    addViolation(
      violations,
      `NOT NULL: ${c.column_name}`,
      sourceRows.filter((r) => r[c.column_name] === null || r[c.column_name] === undefined).map((r) => r.id)
    );
  }

  // 2. simple unique sets (exact values; PG NULLS DISTINCT → skip null members)
  for (const cols of uniques || []) {
    const groups = new Map();
    for (const r of sourceRows) {
      if (cols.some((c) => r[c] === null || r[c] === undefined)) continue;
      const key = cols.map((c) => String(r[c])).join("\u0000");
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r.id);
    }
    addViolation(violations, `unique (${cols.join(", ")})`, [...groups.values()].filter((ids) => ids.length > 1).flat());
  }

  // 3. FK parents must be rows we are importing (non-null values only)
  for (const fk of fks) {
    if (fk.child_table !== table) continue;
    const parents = parentIds.get(fk.parent_table) || new Set();
    addViolation(
      violations,
      `FK ${fk.child_column} -> ${fk.parent_table} (parent row missing)`,
      sourceRows.filter((r) => r[fk.child_column] !== null && r[fk.child_column] !== undefined && !parents.has(r[fk.child_column])).map((r) => r.id)
    );
  }

  // 4. enum membership (target's own labels)
  for (const c of targetColumns) {
    if (c.data_type !== "USER-DEFINED") continue;
    const labels = new Set(enumLabels[c.udt_name] || []);
    if (!labels.size) continue;
    addViolation(
      violations,
      `enum ${c.udt_name}: ${c.column_name}`,
      sourceRows.filter((r) => r[c.column_name] !== null && !labels.has(String(r[c.column_name]))).map((r) => r.id)
    );
  }

  return { table, violations };
}

// Case-insensitive uniqueness (mirrors numbered migration 007, whose
// expression indexes are invisible to the pg_index column discovery above).
function lowerUniqueViolation(sourceRows, column) {
  const groups = new Map();
  for (const r of sourceRows) {
    const v = r[column];
    if (v === null || v === undefined) continue;
    const key = String(v).toLowerCase();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.id);
  }
  return [...groups.values()].filter((g) => g.length > 1).flat();
}

// Cart identity (mirrors 010's expression index
// uq_cartitems_user_product_variant, which pg_index discovery cannot read).
// Legacy MySQL has no variantId column: undefined is the base/NULL line.
function cartIdentityViolation(sourceRows) {
  const groups = new Map();
  for (const r of sourceRows) {
    if (r.productId === null || r.productId === undefined) continue; // NULLs are distinct in PG
    const key = `${r.UserId}\u0000${r.productId}\u0000${r.variantId ?? 0}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r.id);
  }
  return [...groups.values()].filter((g) => g.length > 1).flat();
}

// ---------------------------------------------------------------- import

async function insertRows(client, targetTable, columns, rows) {
  const CHUNK = 200;
  const quoted = columns.map((c) => `"${c}"`).join(", ");
  for (let start = 0; start < rows.length; start += CHUNK) {
    const chunk = rows.slice(start, start + CHUNK);
    const params = [];
    const tuples = chunk.map((r) => {
      const placeholders = columns.map((c) => {
        params.push(r[c]);
        return `$${params.length}`;
      });
      return `(${placeholders.join(", ")})`;
    });
    await client.query(`INSERT INTO "${targetTable}" (${quoted}) VALUES ${tuples.join(", ")}`, params);
  }
}

// setval is transactional in PostgreSQL → atomic with the inserts.
// Non-empty: next id = max(id) + 1. Empty: next id = 1 (is_called = false).
async function resetSequences(client, targetTable) {
  await client.query(
    `SELECT setval(
       pg_catalog.pg_get_serial_sequence('"${targetTable}"', 'id'),
       COALESCE((SELECT MAX("id") FROM "${targetTable}"), 1),
       (SELECT COUNT(*) > 0 FROM "${targetTable}")
     )`
  );
}

// ---------------------------------------------------------------- verify

async function verifyTarget({ client, tables, sourceIds }) {
  const report = {};
  for (const { name: target } of tables) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n, COALESCE(SUM("id"), 0)::bigint AS sid FROM "${target}"`
    );
    const idsRes = await client.query(`SELECT "id" FROM "${target}" ORDER BY "id"`);
    const targetIds = idsRes.rows.map((r) => r.id);
    const src = [...sourceIds.get(target)].sort((a, b) => a - b);
    report[target] = {
      sourceRows: src.length,
      targetRows: rows[0].n,
      countsMatch: src.length === rows[0].n && targetIds.length === rows[0].n,
      idsPreserved: src.length === targetIds.length && src.every((v, i) => Number(v) === Number(targetIds[i])),
      sumIdSource: src.reduce((a, b) => a + Number(b), 0),
      sumIdTarget: Number(rows[0].sid)
    };
  }
  return report;
}

async function verifyFks(client, fks) {
  const issues = [];
  for (const fk of fks) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM "${fk.child_table}" c
       LEFT JOIN "${fk.parent_table}" p ON p."id" = c."${fk.child_column}"
       WHERE c."${fk.child_column}" IS NOT NULL AND p."id" IS NULL`
    );
    if (rows[0].n > 0) issues.push(`${fk.child_table}.${fk.child_column}: ${rows[0].n} orphaned`);
  }
  return issues;
}

async function verifySequences(client, tables, sourceIds) {
  const results = [];
  for (const { name: target } of tables) {
    const seqRes = await client.query(
      `SELECT pg_catalog.pg_get_serial_sequence('"${target}"', 'id') AS seq`
    );
    let lastValue = null;
    if (seqRes.rows[0].seq) {
      const nameRes = await client.query(
        `SELECT pg_catalog.pg_get_serial_sequence('"${target}"', 'id')::regclass::text AS seq`
      );
      const seqName = nameRes.rows[0].seq; // SQL-ready (quoted when needed)
      const { rows } = await client.query(`SELECT last_value FROM ${seqName}`);
      lastValue = rows[0] ? Number(rows[0].last_value) : null;
    }
    const maxId = Math.max(0, ...[...sourceIds.get(target)].map(Number));
    results.push({
      table: target,
      maxId,
      lastValue,
      // after setval: non-empty → last_value == maxId (next = maxId+1);
      // empty → setval(1, false) → last_value == 1 reported via is_called=false
      ok: maxId > 0 ? lastValue === maxId : lastValue === null || lastValue === 1
    });
  }
  return results;
}

// ---------------------------------------------------------------- main flow

async function runDataMigration({ sourceDb, targetDb, flags = new Set(), dryRun = false, quiet = false } = {}) {
  // GUARDS FIRST — before any connection exists (identical for CLI + library).
  guardOrRefuse({ flags, values: { "--source-db": sourceDb, "--target-db": targetDb }, throwOnRefuse: true });

  const log = quiet ? () => {} : (...args) => console.log(...args);

  // Model table names — static metadata; no connection opens at import
  // (Phase 9 guarantee) and getTableName() never queries.
  require("../models/user");
  require("../models/category");
  require("../models/address");
  require("../models/product");
  require("../models/order"); // pulls OrderItem + OrderStatusEvent
  require("../models/cart");
  require("../models/wishlist");

  const modelByTable = {
    User: require("../models/user"),
    Category: require("../models/category"),
    Address: require("../models/address"),
    Product: require("../models/product"),
    Order: require("../models/order"),
    OrderItem: require("../models/orderItem"),
    OrderStatusEvent: require("../models/orderStatusEvent"),
    CartItem: require("../models/cart"),
    WishlistItem: require("../models/wishlist")
  };

  const targetSettings = { ...resolvePostgresSettings(), database: targetDb };
  const sourceSettings = { ...resolveMysqlSettings(), database: sourceDb };

  // Table map: PostgreSQL names come from the models; the MySQL source is
  // matched case-insensitively (Windows MySQL folds table names to lowercase).
  const tables = TABLE_ORDER.map((model) => ({
    model,
    name: modelByTable[model].getTableName()
  }));

  const violationsByTable = {};
  const summary = { sourceDb, targetDb, dryRun, tables: {}, violations: {}, verify: null, sequences: null };

  const source = await mysql.createConnection(toMysql2Options(sourceSettings));
  const client = new Client(pgClientOptions(targetSettings));
  let snapshotOpen = false;
  try {
    // ---- source: read-only consistent snapshot ---------------------------
    await source.query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ");
    await source.query("START TRANSACTION WITH CONSISTENT SNAPSHOT");
    snapshotOpen = true;

    // ---- target: connect + previously-imported refusal -------------------
    await client.connect();

    const emptyCheck = [];
    for (const t of tables) {
      const actual = await findTargetTableName(client, t.name);
      if (!actual) {
        throw new MigrationRefusal([
          `target table "${t.name}" does not exist in "${targetDb}" — initialize the schema first`,
          "schema comes from sequelize sync + the numbered .pgsql migrations (docs/migration-data.md)"
        ]);
      }
      t.name = actual; // exact casing as stored
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${actual}"`);
      if (rows[0].n > 0) emptyCheck.push(`${actual}=${rows[0].n}`);
    }
    if (emptyCheck.length) {
      throw new MigrationRefusal([
        `target "${targetDb}" already contains imported rows (${emptyCheck.join(", ")})`,
        "refusing to run against a previously imported target — use a fresh scratch database",
        "failed runs roll back completely, so an empty target always means 'safe to rerun'"
      ]);
    }

    // ---- read + validate every table (nothing written yet) ---------------
    const sourceRowsByTable = new Map();
    const sourceIds = new Map();
    for (const t of tables) {
      const actual = await findSourceTableName(source, t.name);
      if (!actual) throw new MigrationRefusal([`source table "${t.name}" not found in "${sourceDb}"`]);
      const [rows] = await source.query(`SELECT * FROM \`${actual}\` ORDER BY \`id\``); // deterministic
      sourceRowsByTable.set(t.name, rows);
      sourceIds.set(t.name, new Set(rows.map((r) => r.id)));
    }

    const uniquesByTable = await discoverTargetUniques(client);
    const allFks = await discoverFks(client);
    const enumLabels = await discoverEnumLabels(client);
    const parentIds = new Map(tables.map((t) => [t.name, sourceIds.get(t.name)]));

    for (const t of tables) {
      const targetColumns = await discoverTargetColumns(client, t.name);
      const rows = sourceRowsByTable.get(t.name);
      const found = validateTable({
        table: t.name,
        sourceRows: rows,
        targetColumns,
        uniques: uniquesByTable[t.name] || [],
        fks: allFks,
        enumLabels,
        parentIds
      });
      if (found.violations.length) violationsByTable[t.name] = found.violations;
      const lowerName = t.name.toLowerCase(); // PG physical casing may be "Users"/"Categories"
      if (lowerName === "users") addViolationList(violationsByTable, t.name, "case-insensitive unique lower(email)", lowerUniqueViolation(rows, "email"));
      if (lowerName === "categories") addViolationList(violationsByTable, t.name, "case-insensitive unique lower(name)", lowerUniqueViolation(rows, "name"));
      if (lowerName === "cartitems") addViolationList(violationsByTable, t.name, "unique (UserId, productId, COALESCE(variantId, 0))", cartIdentityViolation(rows));
      summary.tables[t.name] = { sourceRows: rows.length };
    }

    const violationCount = Object.values(violationsByTable).reduce((n, l) => n + l.reduce((m, v) => m + v.count, 0), 0);
    summary.violations = violationsByTable;
    if (violationCount > 0) throw new MigrationRefusal(formatViolations(violationsByTable));

    // ---- dry run stops here (nothing written) ----------------------------
    if (dryRun) {
      log("DRY RUN — validation passed; nothing was written.");
      summary.ok = true;
      printSummary(summary);
      return summary;
    }

    // ---- one transaction: inserts + sequence reset -----------------------
    try {
      await client.query("BEGIN");
      for (const t of tables) {
        const rows = sourceRowsByTable.get(t.name);
        if (!rows.length) {
          summary.tables[t.name].imported = 0;
          continue;
        }
        const targetColumns = await discoverTargetColumns(client, t.name);
        const typeByCol = Object.fromEntries(targetColumns.map((c) => [c.column_name, c.data_type]));
        const columns = Object.keys(rows[0]).filter((c) => typeByCol[c] !== undefined);
        const coerced = rows.map((r) => {
          const out = {};
          for (const c of columns) out[c] = coerceValue(r[c], typeByCol[c]);
          return out;
        });
        await insertRows(client, t.name, columns, coerced);
        await resetSequences(client, t.name);
        summary.tables[t.name].imported = coerced.length;
      }
      await client.query("COMMIT");
    } catch (err) {
      await client.query("ROLLBACK").catch(() => {});
      throw err;
    }

    // ---- verification (post-commit) --------------------------------------
    summary.verify = await verifyTarget({ client, tables, sourceIds });
    summary.verifyFkIssues = await verifyFks(client, allFks);
    summary.sequences = await verifySequences(client, tables, sourceIds);
    summary.ok =
      Object.values(summary.verify).every((v) => v.countsMatch && v.idsPreserved) &&
      summary.verifyFkIssues.length === 0 &&
      summary.sequences.every((s) => s.ok);
    printSummary(summary);
    return summary;
  } finally {
    if (snapshotOpen) await source.query("ROLLBACK").catch(() => {});
    await source.end().catch(() => {});
    await client.end().catch(() => {});
  }
}

function addViolationList(violationsByTable, table, check, ids) {
  if (!ids.length) return;
  (violationsByTable[table] = violationsByTable[table] || []).push({
    check,
    count: ids.length,
    ids: ids.slice(0, 50)
  });
}

function formatViolations(violations) {
  const lines = ["validation failed — NO rows were written (refusing to discard or auto-fix anything):"];
  for (const [table, list] of Object.entries(violations)) {
    for (const v of list) {
      lines.push(
        `${table}: ${v.check} — ${v.count} row(s), ids: ${v.ids.join(", ")}${v.count > v.ids.length ? ", …" : ""}`
      );
    }
  }
  lines.push("resolve these in the SOURCE database first, then rerun (docs/migration-data.md § duplicates)");
  return lines;
}

function printSummary(summary) {
  console.log("");
  console.log("== migrate:data summary (credential-free) ==");
  console.log(`source: ${summary.sourceDb}  target: ${summary.targetDb}${summary.dryRun ? "  [DRY RUN]" : ""}`);
  for (const [table, info] of Object.entries(summary.tables)) {
    const bits = [`source rows: ${info.sourceRows}`];
    if (info.imported !== undefined) bits.push(`imported: ${info.imported}`);
    console.log(`  ${table}: ${bits.join(", ")}`);
  }
  if (summary.verify) {
    const countsOk = Object.values(summary.verify).every((v) => v.countsMatch);
    const idsOk = Object.values(summary.verify).every((v) => v.idsPreserved);
    console.log(`  verification: counts ${countsOk ? "MATCH" : "MISMATCH"}, ids preserved: ${idsOk ? "YES" : "NO"}`);
    console.log(
      `  FK orphan check: ${(summary.verifyFkIssues || []).length === 0 ? "0 issues" : summary.verifyFkIssues.join("; ")}`
    );
    console.log(`  sequences reset: ${(summary.sequences || []).filter((s) => s.ok).length}/${(summary.sequences || []).length} verified`);
  }
  const total = Object.values(summary.violations || {}).reduce((n, l) => n + l.reduce((m, v) => m + v.count, 0), 0);
  console.log(`  rejected rows: ${total}${total ? " (refused — see above)" : ""}`);
  console.log("");
}

async function main() {
  const { flags, values } = parseArgs(process.argv.slice(2));
  try {
    const summary = await runDataMigration({
      sourceDb: values["--source-db"],
      targetDb: values["--target-db"],
      flags,
      dryRun: flags.has("--dry-run")
    });
    if (summary.ok === false) {
      console.error("❌ migrate:data: verification failed — inspect the summary above");
      process.exit(1);
    }
    console.log("✅ migrate:data complete.");
    process.exit(0);
  } catch (err) {
    if (err.migrationRefusal) {
      printRefusal(err.message.split("\n"));
      process.exit(1);
    }
    console.error("❌ migrate:data failed:", err.message);
    process.exit(1);
  }
}

if (require.main === module) main();

module.exports = { runDataMigration, guardOrRefuse, MigrationRefusal, TABLE_ORDER };
