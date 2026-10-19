// test/pgSmoke.test.js
// Migration Phase 1: opt-in PostgreSQL smoke test.
//
// This test is SKIPPED unless PG_TESTS=1 is set (use `npm run test:pg`).
// It is intentionally NOT part of `npm test`.
//
// What it does:
//   1. Starts a local embedded PostgreSQL server (devDependency) with its data
//      directory in the OS temp dir — OUTSIDE the repository and OneDrive.
//   2. Creates a scratch database named buyoDB_ph2_test (same _test safety rule
//      as the MySQL harness) after dropping it if present.
//   3. Boots the app's real Sequelize config with DB_DIALECT=postgres, syncs
//      the full schema, and does a Category row round-trip.
//   4. Stops the server and leaves no persistent data behind.
//
// BOUNDARIES:
//   - Loopback only; never connects to Supabase or any remote host.
//   - DATABASE_URL is never read by the resolution code under test.
//   - If embedded PostgreSQL fails to initialise/start on this machine, the
//     test FAILS loudly (no silent fallback to another harness).

const { test, after } = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const os = require("os");
const fs = require("fs");

const RUN_PG = /^(1|true|yes)$/i.test(String(process.env.PG_TESTS || "").trim());
const TEST_DB_NAME = "buyoDB_ph2_test";
const PG_PORT = Number(process.env.PG_SMOKE_PORT || 5433);
const PG_USER = "postgres";
const PG_PASSWORD = "pg-smoke-local";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DATA_DIR = path.join(os.tmpdir(), "buyo", "pg-smoke", "pgdata");

let embedded = null;

// Safety: the PG data directory must never live inside the repo/OneDrive tree.
function assertDataDirOutsideRepo() {
  const rel = path.relative(REPO_ROOT, DATA_DIR);
  assert.ok(
    rel === "" || rel.startsWith("..") || path.isAbsolute(rel),
    `PG data dir must be outside the repo, got: ${DATA_DIR}`
  );
  assert.ok(!DATA_DIR.toLowerCase().includes("onedrive") || !DATA_DIR.toLowerCase().includes("buyo--frontend"),
    "PG data dir must not be inside the OneDrive project folder");
}

test("PostgreSQL smoke (opt-in via PG_TESTS=1)", {
  skip: RUN_PG ? false : "set PG_TESTS=1 (npm run test:pg) to run"
}, async (t) => {
  assertDataDirOutsideRepo();

  // Wipe any leftover data dir from a previous run.
  fs.rmSync(DATA_DIR, { recursive: true, force: true });
  fs.mkdirSync(DATA_DIR, { recursive: true });

  const EmbeddedPostgres = require("embedded-postgres").default;
  embedded = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: PG_USER,
    password: PG_PASSWORD,
    port: PG_PORT,
    persistent: false
  });

  await t.test("initialise and start embedded PostgreSQL", async () => {
    await embedded.initialise();
    await embedded.start();
  });

  await t.test("create the scratch database (same _test safety name)", async () => {
    assert.match(TEST_DB_NAME, /_test$/, "scratch DB name must end with _test");
    await embedded.createDatabase(TEST_DB_NAME);
  });

  // Configure the app to use the scratch PostgreSQL BEFORE loading app modules
  // (config/db resolves settings at require time).
  process.env.DB_DIALECT = "postgres";
  process.env.PG_HOST = "127.0.0.1";
  process.env.PG_PORT = String(PG_PORT);
  process.env.PG_DB = TEST_DB_NAME;
  process.env.PG_USER = PG_USER;
  process.env.PG_PASS = PG_PASSWORD;
  process.env.NODE_ENV = "test";
  process.env.MAIL_TRANSPORT = "json"; // never send real mail from tests

  const sequelize = require("../config/db");

  await t.test("scratch database round-trip through Sequelize", async () => {
    // Load every model so sync() builds the FULL schema on PostgreSQL.
    require("../models/user");
    require("../models/category");
    require("../models/product");
    require("../models/cart");
    require("../models/wishlist");
    require("../models/address");
    require("../models/order");

    await sequelize.sync({ force: true });

    const Category = require("../models/category");
    const created = await Category.create({
      name: "PG Smoke Category",
      slug: "pg-smoke-category",
      description: "created by pgSmoke.test.js",
      taxRate: 18.0
    });
    assert.ok(created.id, "Category row should be persisted with an id");

    const found = await Category.findOne({ where: { slug: "pg-smoke-category" } });
    assert.ok(found, "Category row should be readable back");
    assert.equal(found.name, "PG Smoke Category");
    assert.equal(Number(found.taxRate), 18);

    await found.destroy();
    const gone = await Category.findOne({ where: { slug: "pg-smoke-category" } });
    assert.equal(gone, null, "Category row should be gone after destroy");

    await sequelize.close();
  });

  await t.test("stop embedded PostgreSQL and clean up", async () => {
    await embedded.stop();
    embedded = null;
    // persistent:false already removes the data dir; remove the wrapper dir too.
    fs.rmSync(path.dirname(DATA_DIR), { recursive: true, force: true });
  });
});

// Safety net: if a sub-test throws before stopping the server, stop it here so
// the port is not left occupied.
after(async () => {
  if (embedded) {
    try { await embedded.stop(); } catch { /* already stopped */ }
  }
});
