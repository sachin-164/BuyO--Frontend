// test/pgTooling.test.js
// Migration Phase 7: database TOOLING on PostgreSQL — admin-role, db:sync,
// db:backup and db:restore — exercised ONLY against the disposable
// buyoDB_ph2_test scratch database and a disposable buyoDB_ph7_restore target
// (pgSuite harness, embedded loopback PostgreSQL). Real buyoDB, Supabase and
// any remote host are never touched.
//
// Coverage:
//   1. admin:role CLI guards on the PG path (flag / allowlist / loopback) —
//      refusals happen before any connection.
//   2. admin:role CLI end-to-end: grant → audit line → list → revoke.
//   3. admin:role library semantics: grant/noop/revoke/not-found/invalid-role,
//      and the PG explicit-settings refusal (PG_* env is the only target).
//   4. db:sync keeps every guard on PG (--confirm-local, --alter disabled) and
//      a confirmed plain sync is a no-op on rows and bookkeeping.
//   5. db:backup writes a buyo-pg-backup/1 dump: catalog DDL, sequences,
//      constraints, FKs, raw indexes, enum types — and NO credentials or
//      plaintext passwords. The CLI refuses a non-loopback PG host.
//   6. db:restore refusals: cross-dialect format, source-database overwrite,
//      non-scratch target, missing --confirm-local, explicit settings.
//   7. A REAL backup → restore round trip into a fresh scratch database:
//      every row count matches, spot rows are identical, PK/unique/FK/index
//      constraints exist, enum types and JSON columns round-trip, the
//      sequence accepts a DEFAULT insert, and the target is then dropped.
//
// Destructive operations run ONLY against buyoDB_ph7_restore (scratch
// pattern), which this suite creates and drops itself.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fsp = require("node:fs/promises");
const path = require("path");

const helpers = require("./helpers");
const bcrypt = require("bcryptjs");
const { resolvePostgresSettings } = require("../config/dbConnectionOptions");
const { runMigrations } = require("../scripts/migrate");
const { createBackup } = require("../scripts/db-backup");
const { runRestore } = require("../scripts/db-restore");
const { applyRoleChange, listAdmins } = require("../scripts/admin-role");

// Models are required INSIDE before() (after startTestApp recreates the
// scratch DB): config/db.js probes the connection at module load.

const execFileAsync = promisify(execFile);
const BACKEND_DIR = path.join(__dirname, "..");
const TEST_BACKUPS_DIR = path.join(BACKEND_DIR, "backups", "ph7-test");
const RESTORE_TARGET = "buyoDB_ph7_restore";

const PG_MIGRATIONS = [
  "000_pg_base_schema.pgsql",
  "005_pg_cart_items_user_product_unique.pgsql",
  "006_pg_wishlist_items_user_product_unique.pgsql",
  "007_pg_ci_unique_email_and_category.pgsql",
  "008_create_product_images.pgsql",
  "009_categories_parent.pgsql",
  "010_product_variants.pgsql",
  "011_product_reviews.pgsql",
  "012_durable_upload_authorizations.pgsql"
];

const CANDIDATE = "admin.candidate@buyotest.local";
const BUYER = "tool.user@buyotest.local";

async function runCli(script, args, extraEnv = {}) {
  try {
    const { stdout, stderr } = await execFileAsync(process.execPath, [path.join(BACKEND_DIR, script), ...args], {
      cwd: BACKEND_DIR,
      env: { ...process.env, ...extraEnv },
      timeout: 30000
    });
    return { code: 0, stdout, stderr };
  } catch (err) {
    return { code: err.code ?? 1, stdout: err.stdout || "", stderr: err.stderr || "" };
  }
}

// Direct connection to an arbitrary database on the same loopback scratch
// cluster (used to inspect the RESTORED database — the harness connection
// always points at buyoDB_ph2_test).
async function queryDb(database, sql) {
  const s = resolvePostgresSettings();
  const { Client } = require("pg");
  const client = new Client({ host: s.host, port: s.port, user: s.username, password: s.password, database });
  await client.connect();
  try {
    const { rows } = await client.query(sql);
    return rows;
  } finally {
    await client.end();
  }
}

async function dropDatabasePg(name) {
  const s = resolvePostgresSettings();
  const { Client } = require("pg");
  const client = new Client({ host: s.host, port: s.port, user: s.username, password: s.password, database: "postgres" });
  await client.connect();
  try {
    await client.query(`DROP DATABASE IF EXISTS "${String(name).replace(/"/g, '""')}"`);
  } finally {
    await client.end().catch(() => {});
  }
}

describe("PostgreSQL database tooling (Phase 7)", () => {
  let ctx;
  let backupPath = "";
  let User;
  let Category;
  let CartItem;

  before(async () => {
    // Deterministic restore-allowlist for this suite (a value in backend/.env
    // must never widen what the refusal tests expect).
    process.env.DB_RESTORE_ALLOWED_DATABASES = "";

    ctx = await helpers.startTestApp({ migrateFirst: true });
    User = require("../models/user");
    Category = require("../models/category");
    CartItem = require("../models/cart");

    // Synthetic baseline data (test-owned). Passwords are stored as bcrypt
    // hashes — exactly what the signup controller writes into production
    // rows (the model itself never hashes), so the backup must contain NO
    // plaintext password, and the hash must round-trip byte-identically.
    const buyer = await User.create({ name: "Phase7 Buyer", email: BUYER, password: bcrypt.hashSync("fixture-only", 10) });
    await User.create({ name: "Phase7 Candidate", email: CANDIDATE, password: bcrypt.hashSync("fixture-only", 10) });
    await Category.create({ name: "Tooling Cat", slug: "tooling-cat", taxRate: 5 });
    await CartItem.create({ UserId: buyer.id, productId: 501, name: "Tooling Cart Line", price: 42 });

    // A real schema row with JSON columns (Orders.taxBreakdown/shippingAddress)
    // so the round trip proves JSON round-trips on PostgreSQL too.
    await ctx.sequelize.query(
      `INSERT INTO "Orders" ("userId","orderNumber","idempotencyKey","status","paymentMethod","subtotal","taxTotal","grandTotal","taxBreakdown","shippingAddress","createdAt","updatedAt")
       VALUES ($1,$2,$3,'placed','cod',100,5,105,$4,$5,NOW(),NOW())`,
      {
        bind: [
          1,
          "BO-P7-1",
          "p7-idem-1",
          JSON.stringify({ total: 5, byCategory: [{ categoryId: 1, taxAmount: 5 }] }),
          JSON.stringify({ fullName: 'Café "Owner" #7', city: "Bengaluru", pincode: "560038" })
        ]
      }
    );

    // The harness already built this scratch DB with the .pgsql migrations
    // (exact 000 verifies only on an empty database). Rerun must be a no-op,
    // and the backup below still contains the migration-created indexes and
    // schema_migrations bookkeeping (both must round-trip).
    const rerun = await runMigrations({ quiet: true });
    assert.deepEqual(rerun.applied, []);

    await dropDatabasePg(RESTORE_TARGET).catch(() => {}); // leftover from an aborted run
  });

  after(async () => {
    if (ctx) await ctx.close().catch(() => {});
    await dropDatabasePg(RESTORE_TARGET).catch(() => {});
    await fsp.rm(TEST_BACKUPS_DIR, { recursive: true, force: true });
  });

  const query = async (sql, bind) => {
    const [rows] = await ctx.sequelize.query(sql, bind ? { bind } : {});
    return rows;
  };

  // ------------------------------------------------------------------ tests

  it("admin:role CLI guards apply to the PostgreSQL path (flag, allowlist, remote gate)", async () => {
    const noFlag = await runCli("scripts/admin-role.js", ["--list"], {
      DB_ADMIN_ALLOWED_DATABASES: helpers.TEST_DB_NAME
    });
    assert.equal(noFlag.code, 1);
    assert.match(noFlag.stderr, /missing --confirm-local flag/);

    const notAllowed = await runCli("scripts/admin-role.js", ["--list", "--confirm-local"], {
      DB_ADMIN_ALLOWED_DATABASES: "some_other_database"
    });
    assert.equal(notAllowed.code, 1);
    assert.match(notAllowed.stderr, /is not in DB_ADMIN_ALLOWED_DATABASES/);

    // Phase 10: a non-loopback host now refuses through the REMOTE APPROVAL
    // GATE (strict superset of the old "not loopback" refusal) — still before
    // any connection is attempted.
    const remote = await runCli("scripts/admin-role.js", ["--list", "--confirm-local"], {
      DB_ADMIN_ALLOWED_DATABASES: helpers.TEST_DB_NAME,
      PG_HOST: "10.255.255.1"
    });
    assert.equal(remote.code, 1);
    assert.match(remote.stderr, /REFUSED:/);
    assert.match(remote.stderr, /PG_REMOTE_MIGRATION_APPROVED/);
    assert.match(remote.stderr, /migration-remote\.md/);
    assert.doesNotMatch(
      remote.stderr,
      /ECONNREFUSED|getaddrinfo|ENOTFOUND|timed out/i,
      "refusal must happen before any connection attempt"
    );
  });

  it("admin:role CLI grants, lists and revokes end-to-end on PostgreSQL (audit line)", async () => {
    const grant = await runCli(
      "scripts/admin-role.js",
      ["--email", CANDIDATE, "--role", "admin", "--confirm-local"],
      { DB_ADMIN_ALLOWED_DATABASES: helpers.TEST_DB_NAME }
    );
    assert.equal(grant.code, 0, grant.stderr);
    assert.match(grant.stdout, /ADMIN ROLE CHANGE \[/);
    assert.match(grant.stdout, /customer -> admin/);
    assert.match(grant.stdout, new RegExp(helpers.TEST_DB_NAME));

    const list = await runCli("scripts/admin-role.js", ["--list", "--confirm-local"], {
      DB_ADMIN_ALLOWED_DATABASES: helpers.TEST_DB_NAME
    });
    assert.equal(list.code, 0, list.stderr);
    assert.match(list.stdout, /admin\.candidate@buyotest\.local/);
    assert.match(list.stdout, /not verified/, "the unverified-admin warning must still print");

    const revoke = await runCli(
      "scripts/admin-role.js",
      ["--email", CANDIDATE, "--role", "customer", "--confirm-local"],
      { DB_ADMIN_ALLOWED_DATABASES: helpers.TEST_DB_NAME }
    );
    assert.equal(revoke.code, 0, revoke.stderr);
    assert.match(revoke.stdout, /admin -> customer/);
  });

  it("admin:role library keeps grant/noop/revoke/fail-closed semantics on PostgreSQL", async () => {
    const grant = await applyRoleChange({ email: CANDIDATE, role: "admin" });
    assert.equal(grant.before, "customer");
    assert.equal(grant.after, "admin");
    assert.equal(grant.changed, true);

    const admins = await listAdmins();
    assert.deepEqual(admins.map((a) => a.email), [CANDIDATE]);

    const noop = await applyRoleChange({ email: CANDIDATE, role: "admin" });
    assert.equal(noop.changed, false);

    const revoke = await applyRoleChange({ email: CANDIDATE, role: "customer" });
    assert.equal(revoke.changed, true);
    assert.deepEqual(await listAdmins(), []);

    await assert.rejects(applyRoleChange({ email: "nobody@buyotest.local", role: "admin" }), /No user found/);
    await assert.rejects(applyRoleChange({ email: CANDIDATE, role: "superadmin" }), /Invalid role/);

    // PG path: explicit settings are refused (PG_* env is the only target).
    await assert.rejects(
      applyRoleChange({
        settings: { host: "127.0.0.1", port: 5432, database: helpers.TEST_DB_NAME, username: "x", password: "x" },
        email: CANDIDATE,
        role: "admin"
      }),
      /PG_\* environment variables only/
    );
    await assert.rejects(
      createBackup({ settings: { host: "127.0.0.1", port: 5432, database: helpers.TEST_DB_NAME, username: "x", password: "x" } }),
      /PG_\* environment variables only/
    );
  });

  it("db:sync keeps every guard on PostgreSQL; a confirmed sync is a no-op", async () => {
    const noFlag = await runCli("scripts/db-sync.js", [], { DB_SYNC_ALLOWED_DATABASES: helpers.TEST_DB_NAME });
    assert.equal(noFlag.code, 1);
    assert.match(noFlag.stderr, /db:sync only runs against an explicitly confirmed LOCAL dev database/);

    const alter = await runCli("scripts/db-sync.js", ["--confirm-local", "--alter"], {
      DB_SYNC_ALLOWED_DATABASES: helpers.TEST_DB_NAME
    });
    assert.equal(alter.code, 1);
    assert.match(alter.stderr, /--alter is disabled/);
    assert.match(alter.stderr, /npm run db:migrate/);

    const usersBefore = await query(`SELECT COUNT(*) AS n FROM "Users"`);
    const ok = await runCli("scripts/db-sync.js", ["--confirm-local"], {
      DB_SYNC_ALLOWED_DATABASES: helpers.TEST_DB_NAME
    });
    assert.equal(ok.code, 0, ok.stderr);
    assert.match(ok.stdout, /sync complete/);

    // Plain sync: creates missing tables only — rows and bookkeeping untouched.
    const usersAfter = await query(`SELECT COUNT(*) AS n FROM "Users"`);
    assert.equal(usersAfter[0].n, usersBefore[0].n, "db:sync must not touch rows");
    const bookkeeping = await query(`SELECT id FROM "schema_migrations" ORDER BY id`);
    assert.deepEqual(bookkeeping.map((r) => r.id), PG_MIGRATIONS, "db:sync must not touch bookkeeping");
  });

  it("db:backup writes a buyo-pg-backup/1 dump with catalog DDL and no credentials", async () => {
    const result = await createBackup({ outDir: TEST_BACKUPS_DIR });
    backupPath = result.outPath;
    const dump = result.dump;

    assert.equal(dump.format, "buyo-pg-backup/1");
    assert.equal(dump.database, helpers.TEST_DB_NAME);

    // Enum types captured for the restore's CREATE TYPE step.
    assert.ok(Object.keys(dump.enumTypes).length >= 3, "role/status enums must be captured");
    assert.deepEqual(dump.enumTypes.enum_Users_role, ["customer", "admin"]);

    // Representative tables: rows, serial sequences, catalog-built CREATE TABLE.
    assert.equal(dump.tables.Users.rowCount, 2);
    assert.equal(dump.tables.schema_migrations.rowCount, 9, "applied .pgsql migrations must be in the backup");
    assert.equal(dump.tables.Products.rowCount, 0, "empty tables are backed up too");
    assert.match(dump.tables.Users.createSql, /DEFAULT nextval\('"Users_id_seq"'::regclass\)/);
    assert.ok(
      dump.tables.Users.sequences.some((s) => s.column === "id"),
      "the serial sequence must be listed for restore"
    );

    // Constraints vs raw indexes: email unique is a constraint; the Phase 6
    // functional/composite indexes are raw CREATE INDEX statements.
    assert.ok(
      dump.tables.Users.constraintSqls.some((sql) => /ADD CONSTRAINT .* UNIQUE/.test(sql)),
      "unique email constraint must be captured"
    );
    assert.ok(
      dump.tables.Users.indexSqls.some((sql) => sql.includes("uq_users_email_lower")),
      "the functional LOWER(email) index must be captured as a raw index"
    );
    assert.ok(
      dump.tables.CartItems.indexSqls.some((sql) => sql.includes("uq_cartitems_user_product_variant")),
      "the composite cart index must be captured as a raw index"
    );
    assert.ok(
      dump.tables.CartItems.fkSqls.some((sql) => /FOREIGN KEY \("UserId"\) REFERENCES "Users"/.test(sql)),
      "CartItems -> Users FK must be captured"
    );
    assert.match(dump.tables.Orders.createSql, /DEFAULT nextval/, "Orders keeps its serial default");

    // Security: the file stores bcrypt hashes only — never plaintext fixture
    // passwords and never the connection password of the scratch cluster.
    const raw = await fsp.readFile(backupPath, "utf8");
    assert.ok(!raw.includes("fixture-only"), "backup must not contain plaintext passwords");
    assert.ok(!raw.includes("pg-suite-local"), "backup must not contain connection credentials");
  });

  it("db:backup CLI refuses a non-loopback PostgreSQL host without --allow-remote", async () => {
    const res = await runCli("scripts/db-backup.js", [], { PG_HOST: "10.255.255.1" });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not loopback/);
    assert.match(res.stderr, /--allow-remote/);
  });

  it("db:restore refuses wrong formats, source overwrite, non-scratch targets, missing flags and explicit settings", async () => {
    assert.ok(backupPath, "the backup from the earlier test is required");

    // Cross-dialect format (a MySQL dump must never restore on the PG path).
    const wrongFormat = path.join(TEST_BACKUPS_DIR, "wrong-format.json");
    await fsp.writeFile(wrongFormat, JSON.stringify({ format: "buyo-mysql-backup/1", tables: {} }), "utf8");
    await assert.rejects(runRestore({ backupPath: wrongFormat, targetDatabase: RESTORE_TARGET }), /Unsupported backup format/);

    // Never restore over the database the backup came from.
    await assert.rejects(
      runRestore({ backupPath, targetDatabase: helpers.TEST_DB_NAME }),
      /the database the backup was taken from/
    );

    // Only buyoDB_* scratch targets (or explicit allowlist entries).
    await assert.rejects(runRestore({ backupPath, targetDatabase: "buyoprod" }), /buyoDB_\* scratch/);

    // Explicit settings are refused on the PG path (after guards, before any connection).
    await assert.rejects(
      runRestore({
        backupPath,
        targetDatabase: RESTORE_TARGET,
        settings: { host: "127.0.0.1", port: 5432, database: helpers.TEST_DB_NAME, username: "x", password: "x" }
      }),
      /PG_\* environment variables only/
    );

    // CLI guard refusal: no connection is attempted without --confirm-local.
    const noFlag = await runCli("scripts/db-restore.js", ["--target", "buyoDB_ph7_cli"], {});
    assert.equal(noFlag.code, 1);
    assert.match(noFlag.stderr, /missing --confirm-local flag/);
  });

  it("real backup → restore round trip on PostgreSQL (counts, rows, constraints, JSON, sequence)", async () => {
    assert.ok(backupPath, "the backup from the earlier test is required");

    const result = await runRestore({ backupPath, targetDatabase: RESTORE_TARGET, log: () => {} });
    assert.equal(result.database, RESTORE_TARGET);

    // 1. Every row count matches the backup metadata.
    const backupJson = JSON.parse(await fsp.readFile(backupPath, "utf8"));
    assert.deepEqual(Object.keys(result.tables).sort(), Object.keys(backupJson.tables).sort());
    for (const [table, info] of Object.entries(backupJson.tables)) {
      assert.equal(result.tables[table], info.rowCount, `${table} row count must match the backup`);
    }

    // 2. Spot-check the restored rows (including the bcrypt hash) against the source.
    const srcUsers = await query(
      `SELECT email, password, role, "isVerified" FROM "Users" ORDER BY email`
    );
    const dstUsers = await queryDb(
      RESTORE_TARGET,
      `SELECT email, password, role, "isVerified" FROM "Users" ORDER BY email`
    );
    assert.deepEqual(dstUsers, srcUsers, "user rows (hashes included) must be byte-identical");
    assert.deepEqual(
      dstUsers.map((u) => u.email),
      [CANDIDATE, BUYER].sort()
    );

    const srcOrder = await query(
      `SELECT id, "orderNumber", status, "paymentMethod", subtotal, "taxTotal", "grandTotal", "taxBreakdown", "shippingAddress"
       FROM "Orders" ORDER BY id`
    );
    const dstOrder = await queryDb(
      RESTORE_TARGET,
      `SELECT id, "orderNumber", status, "paymentMethod", subtotal, "taxTotal", "grandTotal", "taxBreakdown", "shippingAddress"
       FROM "Orders" ORDER BY id`
    );
    assert.deepEqual(dstOrder, srcOrder, "the Orders row incl. JSON columns must round-trip");
    assert.equal(dstOrder[0].taxBreakdown.total, 5, "JSON object must stay a parsed object");
    assert.equal(dstOrder[0].shippingAddress.fullName, 'Café "Owner" #7');

    // 3. Bookkeeping round-trips: the restored DB knows the migrations applied.
    const bookkeeping = await queryDb(RESTORE_TARGET, `SELECT id FROM "schema_migrations" ORDER BY id`);
    assert.deepEqual(bookkeeping.map((r) => r.id), PG_MIGRATIONS);

    // 4. Constraints and indexes rebuilt in the fresh database.
    const indexes = await queryDb(
      RESTORE_TARGET,
      `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = current_schema()`
    );
    const byName = Object.fromEntries(indexes.map((i) => [i.indexname, i.indexdef]));
    assert.match(byName.Users_pkey, /USING btree \(id\)/, "primary key index must exist");
    assert.match(byName.Users_email_key, /USING btree \(email\)/, "unique email constraint must exist");
    assert.match(byName.uq_users_email_lower, /lower\(.*email/i, "functional index must exist");
    assert.match(
      byName.uq_cartitems_user_product_variant,
      /USING btree \("UserId", "productId", COALESCE\("variantId", 0\)\)/,
      "composite cart index must exist"
    );
    assert.ok(byName.Orders_number_key || byName.uq_orders_number, "orders unique must exist");

    const fks = await queryDb(
      RESTORE_TARGET,
      `SELECT con.conname, pg_get_constraintdef(con.oid) AS def
       FROM pg_constraint con
       JOIN pg_class c ON c.oid = con.conrelid
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = current_schema() AND c.relname = 'CartItems' AND con.contype = 'f'`
    );
    assert.equal(fks.length, 2, "both CartItems FKs must be restored");
    const cartFkDefs = fks.map((fk) => fk.def).join("\n");
    assert.match(cartFkDefs, /FOREIGN KEY \("UserId"\) REFERENCES "Users"\(id\)/);
    assert.match(cartFkDefs, /FOREIGN KEY \("variantId"\) REFERENCES "ProductVariants"\(id\)/);

    // 5. Enum types restored with their labels; enum values are readable.
    const roleLabels = await queryDb(
      RESTORE_TARGET,
      `SELECT e.enumlabel FROM pg_type t JOIN pg_enum e ON e.enumtypid = t.oid
       WHERE t.typname = 'enum_Users_role' ORDER BY e.enumsortorder`
    );
    assert.deepEqual(roleLabels.map((r) => r.enumlabel), ["customer", "admin"]);

    // 6. Sequences advanced past the restored ids: a DEFAULT insert succeeds
    //    (this is what a MySQL AUTO_INCREMENT gets for free after a restore).
    const inserted = await queryDb(
      RESTORE_TARGET,
      `INSERT INTO "Users" (name, email, password, "isVerified", role, "createdAt", "updatedAt")
       VALUES ('Seq Probe', 'seq.probe@buyotest.local', 'x', false, 'customer', NOW(), NOW())
       RETURNING id`
    );
    assert.ok(Number(inserted[0].id) > 0, "the identity/serial sequence must accept a new DEFAULT id");
    const probe = await queryDb(
      RESTORE_TARGET,
      `SELECT COUNT(*)::int AS n FROM "Users" WHERE email = 'seq.probe@buyotest.local'`
    );
    assert.equal(probe[0].n, 1);

    // 7. Restoring over an existing target is refused.
    await assert.rejects(
      runRestore({ backupPath, targetDatabase: RESTORE_TARGET, log: () => {} }),
      /already exists/
    );
  });
});
