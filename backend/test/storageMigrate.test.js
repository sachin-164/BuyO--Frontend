// test/storageMigrate.test.js — Phase 12: guarded /uploads/ -> storage migration tool.
//
// Scratch MySQL database: buyoDB_ph12_storage (created and dropped by this
// file; the tool's default allowlist covers it). The remote side is MOCKED
// through the REAL supabase adapter running over the MOCK SDK client — no SDK
// construction, no network, no Supabase project. Nothing here touches buyoDB
// or any real data.
const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const mysql = require("mysql2/promise");
const { resolveMysqlSettings, toMysql2Options } = require("../config/dbConnectionOptions");
const imageStore = require("../lib/imageStore");
const { createMockSupabase } = require("./mockSupabaseStorage");
const migrate = require("../scripts/storage-migrate");

const TEST_DB = "buyoDB_ph12_storage";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47]);
const TOKEN = "phase-cutover-approval";
const SUPABASE_ENV = {
  STORAGE_MIGRATION_APPROVED: TOKEN,
  SUPABASE_URL: "https://unit-test-project.supabase.invalid",
  SUPABASE_SERVICE_ROLE_KEY: "mock-service-key-not-a-secret"
};

const STAMP = `${process.pid}`;
const OK_FILE = `migtest-${STAMP}-ok.png`;
const BAD_FILE = `migtest-${STAMP}-bad.png`;
const MISSING_FILE = `migtest-${STAMP}-missing.png`;
const uploadsDir = path.join(__dirname, "..", "uploads");

let conn;
let backupsDir;
let rowIds = {}; // ok / bad / missing -> product ids

async function seed() {
  const settings = { ...resolveMysqlSettings() };
  const bootstrap = await mysql.createConnection(toMysql2Options(settings));
  await bootstrap.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await bootstrap.query(`CREATE DATABASE \`${TEST_DB}\``);
  await bootstrap.query(`USE \`${TEST_DB}\``);
  await bootstrap.query(
    "CREATE TABLE Products (id INT AUTO_INCREMENT PRIMARY KEY, image VARCHAR(500) NOT NULL)"
  );

  fs.writeFileSync(path.join(uploadsDir, OK_FILE), PNG);
  fs.writeFileSync(path.join(uploadsDir, BAD_FILE), Buffer.from("<html>not an image</html>"));
  // MISSING_FILE intentionally not written.

  for (const [key, image] of [
    ["ok", `/uploads/${OK_FILE}`],
    ["missing", `/uploads/${MISSING_FILE}`],
    ["bad", `/uploads/${BAD_FILE}`]
  ]) {
    const [result] = await bootstrap.query("INSERT INTO Products (image) VALUES (?)", [image]);
    rowIds[key] = result.insertId;
  }
  await bootstrap.end();
  conn = await mysql.createConnection(toMysql2Options({ ...settings, database: TEST_DB }));
}

function flags(...list) {
  return new Set(list);
}

function buildAdapter(env) {
  // REAL supabase adapter over the MOCK SDK client (adapter logic tested,
  // remote behavior still MOCKED).
  imageStore.__resetImageStoreForTests();
  const mock = createMockSupabase();
  imageStore.__setSupabaseClientForTests(mock.client);
  const adapter = imageStore.getImageStore({
    ...env,
    STORAGE_DRIVER: "supabase",
    SUPABASE_STORAGE_BUCKET: "product-images"
  });
  return { adapter, mock };
}

async function imageValue(id) {
  const [rows] = await conn.query("SELECT image FROM Products WHERE id = ?", [id]);
  return rows[0].image;
}

before(async () => {
  imageStore.__resetImageStoreForTests();
  backupsDir = fs.mkdtempSync(path.join(os.tmpdir(), "buyo-storage-migrate-"));
  await seed();
});

after(async () => {
  if (conn) await conn.end();
  const settings = { ...resolveMysqlSettings() };
  const bootstrap = await mysql.createConnection(toMysql2Options(settings));
  await bootstrap.query(`DROP DATABASE IF EXISTS \`${TEST_DB}\``);
  await bootstrap.end();
  for (const name of [OK_FILE, BAD_FILE, MISSING_FILE]) {
    fs.rmSync(path.join(uploadsDir, name), { force: true });
  }
  fs.rmSync(backupsDir, { recursive: true, force: true });
  imageStore.__resetImageStoreForTests();
});

test("refusal: --apply without explicit approval fails before any SDK construction or write", async () => {
  await assert.rejects(
    () =>
      migrate.runStorageMigration({
        flags: flags("--apply", "--confirm-remote", "--confirm-local"),
        values: { "--source-db": TEST_DB, "--bucket": "product-images" },
        env: { SUPABASE_URL: "https://x.supabase.invalid", SUPABASE_SERVICE_ROLE_KEY: "k" }, // no approval token
        deps: { connection: conn, backupsDir },
        throwOnRefuse: true
      }),
    (err) => {
      assert.ok(err instanceof migrate.StorageMigrateRefusal);
      assert.ok(err.lines.some((l) => /STORAGE_MIGRATION_APPROVED/.test(l)), "refusal must name the approval token");
      return true;
    }
  );
  assert.equal(imageStore.__getSdkCreationCountForTests(), 0, "refusal must precede any SDK client construction");
  assert.match(await imageValue(rowIds.ok), /^\/uploads\//, "database must be untouched");
});

test("refusal: --apply trips on DATABASE_URL presence (same posture as the remote DB gate)", async () => {
  await assert.rejects(
    () =>
      migrate.runStorageMigration({
        flags: flags("--apply", "--confirm-remote", "--confirm-local"),
        values: { "--source-db": TEST_DB, "--bucket": "product-images" },
        env: { ...SUPABASE_ENV, DATABASE_URL: "postgres://should-not-be-here/db" },
        deps: { connection: conn, backupsDir },
        throwOnRefuse: true
      }),
    (err) => err.lines.some((l) => /DATABASE_URL must be unset/.test(l))
  );
  assert.equal(imageStore.__getSdkCreationCountForTests(), 0);
});

test("dry-run: classifies references, touches nothing, builds no SDK client (MOCK-free)", async () => {
  const result = await migrate.runStorageMigration({
    flags: flags("--dry-run", "--confirm-local"),
    values: { "--source-db": TEST_DB },
    env: {},
    deps: { connection: conn, backupsDir },
    throwOnRefuse: true
  });

  assert.equal(result.counts.total, 3);
  assert.equal(result.counts.ready, 1, "only the readable, valid PNG file is ready");
  assert.equal(result.counts["missing-file"], 1);
  assert.equal(result.counts["invalid-content"], 1);
  assert.equal(imageStore.__getSdkCreationCountForTests(), 0, "dry-run must not construct any storage client");

  assert.match(await imageValue(rowIds.ok), /^\/uploads\//, "dry-run must not modify the database");
  assert.match(await imageValue(rowIds.bad), /^\/uploads\//);

  const report = JSON.parse(fs.readFileSync(result.reportFile, "utf8"));
  assert.equal(report.mode, "dry-run");
  assert.equal(report.rows.length, 3);
  for (const row of report.rows) {
    assert.ok(!("buffer" in row) && !("filePath" in row), "report must not include buffers or local paths");
  }
  assert.ok(report.rows.some((r) => r.status === "missing-file"));
  assert.ok(report.rows.some((r) => r.status === "invalid-content"));
});

test("apply (MOCKED SDK): uploads ready rows only, verifies checksums, updates DB after upload", async () => {
  const { adapter, mock } = buildAdapter(SUPABASE_ENV);
  const result = await migrate.runStorageMigration({
    flags: flags("--apply", "--confirm-remote", "--confirm-local"),
    values: { "--source-db": TEST_DB, "--bucket": "product-images" },
    env: SUPABASE_ENV,
    deps: { connection: conn, backupsDir, adapter },
    throwOnRefuse: true
  });

  assert.equal(result.counts.migrated, 1, JSON.stringify(result.counts));
  assert.equal(mock.calls.uploads.length, 1, "only the ready file may be uploaded");

  const stored = await imageValue(rowIds.ok);
  assert.ok(
    stored.startsWith(`${SUPABASE_ENV.SUPABASE_URL}/storage/v1/object/public/product-images/products/`),
    `DB reference must point at the approved bucket: ${stored}`
  );
  assert.ok(stored.endsWith(OK_FILE));

  assert.match(await imageValue(rowIds.missing), /^\/uploads\//, "missing files are reported, never invented");
  assert.match(await imageValue(rowIds.bad), /^\/uploads\//, "invalid content is reported, never uploaded");

  assert.ok(fs.existsSync(path.join(uploadsDir, OK_FILE)), "source files are never deleted (recovery guarantee)");

  const report = JSON.parse(fs.readFileSync(result.reportFile, "utf8"));
  const migratedRow = report.rows.find((r) => r.status === "migrated");
  assert.equal(migratedRow.before, `/uploads/${OK_FILE}`, "report must record the old value for recovery");
  assert.equal(migratedRow.after, stored);
  assert.ok(/^[0-9a-f]{64}$/.test(migratedRow.sha256), "report must record content checksums");
});

test("apply (MOCKED SDK): checksum mismatch -> object removed, row NOT updated", async () => {
  // Reset the previously migrated row back to its local reference (fresh run).
  await conn.query("UPDATE Products SET image = ? WHERE id = ?", [`/uploads/${OK_FILE}`, rowIds.ok]);

  const { adapter, mock } = buildAdapter(SUPABASE_ENV);
  mock.setDownloadOverride(() => Buffer.from("corrupted-bytes-different-from-source")); // tampered download
  const result = await migrate.runStorageMigration({
    flags: flags("--apply", "--confirm-remote", "--confirm-local"),
    values: { "--source-db": TEST_DB, "--bucket": "product-images" },
    env: SUPABASE_ENV,
    deps: { connection: conn, backupsDir, adapter },
    throwOnRefuse: true
  });

  assert.equal(result.counts["checksum-mismatch"], 1);
  assert.equal(result.counts.migrated || 0, 0);
  assert.match(await imageValue(rowIds.ok), /^\/uploads\//, "row must stay untouched until integrity is proven");
  assert.ok(
    mock.calls.removed.includes(`products/${OK_FILE}`),
    "the mismatched object must be removed (no uncontrolled orphan)"
  );

  const report = JSON.parse(fs.readFileSync(result.reportFile, "utf8"));
  const mismatch = report.rows.find((r) => r.status === "checksum-mismatch");
  assert.ok(mismatch && /sha-256/.test(mismatch.error), "report must explain the refusal");
  mock.setDownloadOverride(null);
});

test("CLI wiring: missing --confirm-local refuses with exit 1 and prints usage", () => {
  const run = spawnSync(process.execPath, [path.join(__dirname, "..", "scripts", "storage-migrate.js"), "--dry-run", "--source-db", TEST_DB], {
    env: { ...process.env },
    encoding: "utf8"
  });
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /REFUSED/);
  assert.match(run.stderr, /--confirm-local/);
});

test("CLI wiring: --apply without the approval token refuses before anything else", async () => {
  const env = { ...process.env, STORAGE_MIGRATION_APPROVED: "" };
  delete env.STORAGE_MIGRATION_APPROVED;
  const run = spawnSync(
    process.execPath,
    [
      path.join(__dirname, "..", "scripts", "storage-migrate.js"),
      "--apply",
      "--bucket",
      "product-images",
      "--confirm-remote",
      "--confirm-local",
      "--source-db",
      TEST_DB
    ],
    { env, encoding: "utf8" }
  );
  assert.equal(run.status, 1, run.stderr);
  assert.match(run.stderr, /REFUSED/);
  assert.match(run.stderr, /STORAGE_MIGRATION_APPROVED/);
  assert.match(await imageValue(rowIds.ok), /^\/uploads\//, "CLI refusal must leave the database untouched");
});
