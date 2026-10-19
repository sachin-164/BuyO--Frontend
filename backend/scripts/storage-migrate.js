#!/usr/bin/env node
// scripts/storage-migrate.js — guarded local /uploads/ -> Supabase Storage
// migration (Phase 12; design: docs/storage-supabase.md §6).
//
// NEVER runs without explicit approval, and by default does nothing but
// inventory. Modes (exactly one required):
//   --dry-run   inventory only: reads the local MySQL source, classifies every
//               /uploads/... product image reference, writes a JSON report.
//               No storage SDK is constructed, nothing is uploaded, no row is
//               modified.
//   --apply     additionally uploads each READY file to the EXPLICITLY approved
//               target (--bucket), verifies content integrity (sha-256 of the
//               downloaded object must equal the local file), and only then
//               updates the database reference — optimistically
//               (WHERE image = <old value>; a row changed since inventory is
//               skipped and reported, never overwritten).
//
// SAFETY (refusals happen BEFORE any connection or SDK construction):
//   * local guard (scripts/lib/localDbGuard.js): --confirm-local, no
//     production, loopback host, database in STORAGE_MIGRATE_ALLOWED_DATABASES
//   * --apply additionally: STORAGE_MIGRATION_APPROVED == "phase-cutover-approval"
//     AND --confirm-remote AND explicit --bucket AND SUPABASE_URL +
//     SUPABASE_SERVICE_ROLE_KEY present AND NODE_ENV != production AND
//     DATABASE_URL unset (tripwire, same posture as docs/migration-remote.md;
//     this tool never reads it)
//
// Source files are never deleted or modified — recovery = revert the `image`
// values recorded in the report's `before` fields (see docs/storage-supabase.md §6.4).
"use strict";

const path = require("path");
const fs = require("fs");
const crypto = require("crypto");
const dotenv = require("dotenv");
dotenv.config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const mysql = require("mysql2/promise");
const {
  resolveMysqlSettings,
  toMysql2Options
} = require("../config/dbConnectionOptions");
const { getAllowedDatabases, collectLocalGuardReasons, refuseLocal } = require("./lib/localDbGuard");
const { IMAGE_SIGNATURES, getImageStore, resolveMaxImageBytes } = require("../lib/imageStore");

const USAGE =
  "node scripts/storage-migrate.js --source-db <mysql-db> --dry-run --confirm-local | " +
  "--source-db <mysql-db> --apply --bucket <name> --confirm-remote --confirm-local";

const APPROVAL_TOKEN = "phase-cutover-approval";

class StorageMigrateRefusal extends Error {
  constructor(lines) {
    super(lines.join(" | "));
    this.lines = lines;
  }
}

function parseArgs(argv) {
  const flags = new Set();
  const values = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--dry-run" || arg === "--apply" || arg === "--confirm-local" || arg === "--confirm-remote") {
      flags.add(arg);
    } else if (arg === "--source-db" || arg === "--bucket") {
      const value = argv[i + 1];
      if (!value || value.startsWith("--")) throw new Error(`missing value for ${arg}`);
      values[arg] = value;
      i += 1;
    } else {
      throw new Error(`unknown argument: ${arg}`);
    }
  }
  return { flags, values };
}

// ---------------------------------------------------------------- guards

function guardOrRefuse({ flags, values, env = process.env, throwOnRefuse = false } = {}) {
  const refuse = (lines) => {
    if (throwOnRefuse) throw new StorageMigrateRefusal(lines);
    console.error("❌ REFUSED: storage-migrate only uploads to an explicitly approved target.");
    for (const line of lines) console.error(`   - ${line}`);
    console.error(`   Usage: ${USAGE}`);
    process.exit(1);
  };

  const errors = [];
  const dryRun = flags.has("--dry-run");
  const apply = flags.has("--apply");
  if (dryRun === apply) errors.push("exactly one of --dry-run or --apply is required");

  const sourceDb = values["--source-db"];
  if (!sourceDb) errors.push("--source-db <mysql-db> (explicit source configuration is required)");

  // Local source guard: loopback MySQL + explicit database allowlist.
  const settings = { ...resolveMysqlSettings(), database: sourceDb };
  const allowed = getAllowedDatabases("STORAGE_MIGRATE_ALLOWED_DATABASES", ["buyoDB_ph12_storage"]);
  const reasons = collectLocalGuardReasons({
    flags,
    settings,
    allowed,
    allowedEnvVar: "STORAGE_MIGRATE_ALLOWED_DATABASES"
  });
  errors.push(...reasons);

  if (apply) {
    if (String(env.STORAGE_MIGRATION_APPROVED || "") !== APPROVAL_TOKEN) {
      errors.push(`STORAGE_MIGRATION_APPROVED must equal "${APPROVAL_TOKEN}" (explicit operator approval)`);
    }
    if (!flags.has("--confirm-remote")) errors.push("missing --confirm-remote flag for --apply");
    const bucket = values["--bucket"];
    if (!bucket || !/^[A-Za-z0-9][A-Za-z0-9._-]{1,62}$/.test(bucket)) {
      errors.push("--bucket <name> must be given explicitly (the approved target, 2-63 chars)");
    }
    if (String(env.NODE_ENV || "").toLowerCase() === "production") {
      errors.push("NODE_ENV=production is set: --apply refuses to run");
    }
    if (!String(env.SUPABASE_URL || "").trim()) errors.push("SUPABASE_URL must be set for --apply");
    if (!String(env.SUPABASE_SERVICE_ROLE_KEY || "").trim()) {
      errors.push("SUPABASE_SERVICE_ROLE_KEY must be set for --apply");
    }
    if (String(env.DATABASE_URL || "").trim() !== "") {
      errors.push(
        "DATABASE_URL must be unset for this operation (remove the line from backend/.env for the run; this tool never reads it)"
      );
    }
  }

  if (errors.length) return refuse([...errors, `usage: ${USAGE}`]);
  return { dryRun, apply, sourceDb, settings, bucket: values["--bucket"] || null };
}

// ---------------------------------------------------------------- inventory

function detectImageType(buffer) {
  for (const [type, check] of Object.entries(IMAGE_SIGNATURES)) {
    if (check(buffer)) return type;
  }
  return null;
}

// Resolves /uploads/<name> to a file path INSIDE the uploads dir (traversal
// references are reported unsafe, never followed).
function resolveUploadRefPath(uploadsDir, imageValue) {
  const name = path.basename(String(imageValue || ""));
  if (!name || name === "." || name === "..") return null;
  const root = path.resolve(uploadsDir) + path.sep;
  const resolved = path.resolve(path.join(uploadsDir, name));
  if (!resolved.startsWith(root)) return null;
  return resolved;
}

function classifyImageFile(filePath, maxBytes) {
  let buffer;
  try {
    buffer = fs.readFileSync(filePath);
  } catch {
    return { status: "missing-file" };
  }
  const size = buffer.length;
  if (size < 1) return { status: "invalid-content", reason: "empty file" };
  if (size > maxBytes) return { status: "invalid-content", reason: `file larger than ${maxBytes} bytes` };
  const sha256 = crypto.createHash("sha256").update(buffer).digest("hex");
  const mimetype = detectImageType(buffer);
  if (!mimetype) {
    return { status: "invalid-content", reason: "content signature is not an allowed image type", size, sha256 };
  }
  return { status: "ready", size, sha256, mimetype, buffer };
}

async function inventoryUploadReferences({ settings, uploadsDir, maxBytes, connection }) {
  const conn = connection || (await mysql.createConnection(toMysql2Options(settings)));
  const ownsConnection = !connection;
  try {
    // Deterministic ordering; the column set matches the audited Products schema.
    const [rows] = await conn.query("SELECT id, image FROM Products WHERE image LIKE '/uploads/%' ORDER BY id");
    return rows.map((row) => {
      const filePath = resolveUploadRefPath(uploadsDir, row.image);
      if (!filePath) return { productId: row.id, before: row.image, status: "unsafe-reference" };
      const file = classifyImageFile(filePath, maxBytes);
      return { productId: row.id, before: row.image, filePath, ...file };
    });
  } finally {
    if (ownsConnection) await conn.end();
  }
}

// ---------------------------------------------------------------- apply

// Keeps SDK/OS error text out of reports and logs without ever echoing
// credential material.
function sanitizeError(err, env) {
  let msg = String((err && err.message) || err);
  const key = String(env.SUPABASE_SERVICE_ROLE_KEY || "");
  if (key && msg.includes(key)) msg = msg.split(key).join("[redacted]");
  return msg.slice(0, 300);
}

async function applyMigrations({ rows, store, connection, env }) {
  for (const row of rows) {
    if (row.status !== "ready") continue;
    const objectPath = `products/${path.basename(row.before)}`;
    try {
      const sha256Base64 = Buffer.from(row.sha256, "hex").toString("base64");
      await store.uploadBuffer({ objectPath, buffer: row.buffer, contentType: row.mimetype, sha256Base64 });
      // Content-integrity verification: download the stored object and
      // compare its sha-256 with the local source file.
      const downloaded = await store.downloadBuffer({ objectPath });
      const downloadedSha = crypto.createHash("sha256").update(downloaded).digest("hex");
      if (downloadedSha !== row.sha256) {
        if (typeof store.removeImage === "function") await store.removeImage({ path: objectPath });
        row.status = "checksum-mismatch";
        row.error = "stored object does not match the local file (sha-256); object removed, row untouched";
        continue;
      }
      const after = store.publicUrlFor(objectPath);
      try {
        const [result] = await connection.execute("UPDATE Products SET image = ? WHERE id = ? AND image = ?", [
          after,
          row.productId,
          row.before
        ]);
        if (!result.affectedRows) {
          row.status = "skipped-changed";
          row.error = "row changed since inventory; reference NOT overwritten (re-run to re-inventory)";
          continue;
        }
      } catch (err) {
        row.status = "db-update-failed";
        row.error = sanitizeError(err, env);
        continue;
      }
      row.after = after;
      row.status = "migrated";
    } catch (err) {
      row.status = "upload-failed";
      row.error = sanitizeError(err, env);
    }
  }
  return rows;
}

// ---------------------------------------------------------------- report

const REPORTABLE_FIELDS = ["productId", "before", "after", "status", "sha256", "size", "mimetype", "reason", "error"];

function writeReport({ mode, rows, counts, bucket, backupsDir }) {
  const dir = backupsDir || path.join(__dirname, "..", "backups");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:]/g, "-");
  const file = path.join(dir, `storage-migrate-${mode}-${stamp}.json`);
  const cleanRows = rows.map((row) => {
    const out = {};
    for (const field of REPORTABLE_FIELDS) {
      if (row[field] !== undefined) out[field] = row[field];
    }
    return out;
  });
  fs.writeFileSync(
    file,
    JSON.stringify({ generatedAt: new Date().toISOString(), mode, bucket, counts, rows: cleanRows }, null, 2)
  );
  return file;
}

function summarize(rows) {
  const counts = { total: rows.length };
  for (const row of rows) {
    counts[row.status] = (counts[row.status] || 0) + 1;
  }
  counts.failed =
    (counts["upload-failed"] || 0) + (counts["checksum-mismatch"] || 0) + (counts["db-update-failed"] || 0);
  return counts;
}

// ---------------------------------------------------------------- entry

async function runStorageMigration({ flags, values, env = process.env, deps = {}, throwOnRefuse = false } = {}) {
  // ALL guards run before any connection, file read, or SDK construction.
  const guard = guardOrRefuse({ flags, values, env, throwOnRefuse });

  const uploadsDir = path.join(__dirname, "..", "uploads");
  const maxBytes = resolveMaxImageBytes(env);
  const connection = deps.connection || (await mysql.createConnection(toMysql2Options(guard.settings)));
  const ownsConnection = !deps.connection;
  try {
    const rows = await inventoryUploadReferences({
      settings: guard.settings,
      uploadsDir,
      maxBytes,
      connection
    });

    if (guard.apply) {
      // Supabase adapter; the approved --bucket flag is authoritative.
      const store =
        deps.adapter ||
        getImageStore({ ...env, STORAGE_DRIVER: "supabase", SUPABASE_STORAGE_BUCKET: guard.bucket });
      if (store.driver !== "supabase") throw new Error("internal: --apply requires the supabase storage adapter");
      await applyMigrations({ rows, store, connection, env });
    }

    const counts = summarize(rows);
    const reportFile = writeReport({
      mode: guard.apply ? "apply" : "dry-run",
      rows,
      counts,
      bucket: guard.bucket,
      backupsDir: deps.backupsDir
    });

    console.log(`Storage migration ${guard.apply ? "APPLY" : "DRY RUN"} — ${guard.apply ? "" : "no changes made"}`);
    console.log(`  source database : ${guard.sourceDb} (loopback MySQL)`);
    if (guard.apply) console.log(`  target bucket    : ${guard.bucket}`);
    console.log(`  references found : ${counts.total}`);
    console.log(`    ready          : ${counts.ready || 0}`);
    console.log(`    migrated       : ${counts.migrated || 0}`);
    console.log(`    missing file   : ${counts["missing-file"] || 0}`);
    console.log(`    invalid content: ${counts["invalid-content"] || 0}`);
    console.log(`    unsafe ref     : ${counts["unsafe-reference"] || 0}`);
    console.log(`    skipped/changed: ${counts["skipped-changed"] || 0}`);
    console.log(`    failed         : ${counts.failed}`);
    for (const row of rows) {
      if (row.error) console.log(`      - product ${row.productId}: ${row.status} (${row.error})`);
    }
    console.log(`  report           : ${reportFile}`);

    return { counts, rows, reportFile, guard };
  } finally {
    if (ownsConnection) await connection.end();
  }
}

async function main(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    console.error(`   usage: ${USAGE}`);
    process.exit(1);
  }
  const result = await runStorageMigration(parsed);
  if (result.counts.failed > 0) process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("❌ storage-migrate failed:", sanitizeError(err, process.env));
    process.exit(1);
  });
}

module.exports = {
  USAGE,
  APPROVAL_TOKEN,
  StorageMigrateRefusal,
  parseArgs,
  guardOrRefuse,
  detectImageType,
  resolveUploadRefPath,
  classifyImageFile,
  inventoryUploadReferences,
  applyMigrations,
  writeReport,
  summarize,
  runStorageMigration
};
