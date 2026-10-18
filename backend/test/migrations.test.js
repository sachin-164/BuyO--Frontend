// test/migrations.test.js
// Phase 3 tests: guard refusals, realistic legacy-schema migration, idempotency,
// constraints, checksum protection, backup/restore recovery rehearsal and admin
// provisioning — against scratch LOCAL databases ONLY. The real dev database is
// never touched (enforced: every target name starts with buyoDB_ph3_).
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const fsp = require("node:fs/promises");
const path = require("node:path");
const mysql = require("mysql2/promise");
const bcrypt = require("bcryptjs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

// Point any app-side (Sequelize) connection at a scratch DB before loading modules.
process.env.NODE_ENV = "test";
process.env.MYSQL_DB = "buyoDB_ph3_sync";

const { resolveMysqlSettings, toMysql2Options } = require("../config/dbConnectionOptions");
const { runMigrations, computeChecksum } = require("../scripts/migrate");
const { createBackup } = require("../scripts/db-backup");
const { runRestore } = require("../scripts/db-restore");
const { applyRoleChange, listAdmins } = require("../scripts/admin-role");

const execFileAsync = promisify(execFile);
const BACKEND_DIR = path.join(__dirname, "..");
const MIGRATIONS_DIR = path.join(BACKEND_DIR, "migrations");
const TEST_BACKUPS_DIR = path.join(BACKEND_DIR, "backups", "ph3-test");

const GUARD_DB = "buyoDB_ph3_test";
const SYNC_DB = "buyoDB_ph3_sync";
const LEGACY_DB = "buyoDB_ph3_legacy";
const RECOVERED_DB = "buyoDB_ph3_recovered";
const ALL_SCRATCH = [GUARD_DB, SYNC_DB, LEGACY_DB, RECOVERED_DB];

function settingsFor(database) {
  return { ...resolveMysqlSettings(), database };
}

async function withAdminConnection(fn) {
  const connection = await mysql.createConnection(
    toMysql2Options(resolveMysqlSettings(), { includeDatabase: false })
  );
  try {
    return await fn(connection);
  } finally {
    await connection.end();
  }
}

const dropDatabase = (name) => withAdminConnection((c) => c.query(`DROP DATABASE IF EXISTS \`${name}\``));
const createDatabase = (name) => withAdminConnection((c) => c.query(`CREATE DATABASE \`${name}\``));

async function queryDb(database, sql, params = []) {
  const connection = await mysql.createConnection(toMysql2Options(settingsFor(database)));
  try {
    const [rows] = await connection.query(sql, params);
    return rows;
  } finally {
    await connection.end();
  }
}

async function tableNames(database) {
  const rows = await queryDb(
    database,
    "SELECT TABLE_NAME AS t FROM information_schema.TABLES WHERE TABLE_SCHEMA = ? ORDER BY TABLE_NAME",
    [database]
  );
  return rows.map((row) => row.t);
}

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

// Normalizes the information_schema shape so a Sequelize-sync-built schema can
// be compared with a migration-built one (column order and index names differ).
async function fetchSchemaShape(database) {
  const rows = await queryDb(
    database,
    `SELECT TABLE_NAME AS t, COLUMN_NAME AS c, COLUMN_TYPE AS ct, IS_NULLABLE AS nul, COLUMN_DEFAULT AS def
     FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = ? AND TABLE_NAME <> 'schema_migrations'
     ORDER BY TABLE_NAME, COLUMN_NAME`,
    [database]
  );
  const shape = {};
  for (const row of rows) {
    const def = row.def === null ? "<null>" : String(row.def);
    (shape[row.t] ??= []).push(`${row.c}|${String(row.ct).toLowerCase()}|${row.nul}|${def}`);
  }
  for (const key of Object.keys(shape)) shape[key].sort();
  return shape;
}

// ---------- realistic legacy fixture (matches the pre-Phase-3 real schema) ----------

const LEGACY_DDL = [
  `CREATE TABLE \`Users\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`name\` varchar(255) NOT NULL,
    \`email\` varchar(255) NOT NULL,
    \`password\` varchar(255) NOT NULL,
    \`isVerified\` tinyint(1) DEFAULT '0',
    \`createdAt\` datetime NOT NULL,
    \`updatedAt\` datetime NOT NULL,
    PRIMARY KEY (\`id\`),
    UNIQUE KEY \`email\` (\`email\`),
    UNIQUE KEY \`email_2\` (\`email\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE \`Products\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`name\` varchar(255) NOT NULL,
    \`category\` varchar(255) NOT NULL,
    \`description\` text,
    \`mrpPrice\` float NOT NULL,
    \`sellingPrice\` float NOT NULL,
    \`image\` varchar(255) DEFAULT NULL,
    \`createdAt\` datetime NOT NULL,
    \`updatedAt\` datetime NOT NULL,
    PRIMARY KEY (\`id\`)
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE \`CartItems\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`productId\` int DEFAULT NULL,
    \`name\` varchar(255) NOT NULL,
    \`price\` float DEFAULT '0',
    \`image\` varchar(255) DEFAULT NULL,
    \`qty\` int DEFAULT '1',
    \`createdAt\` datetime NOT NULL,
    \`updatedAt\` datetime NOT NULL,
    \`UserId\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`UserId\` (\`UserId\`),
    CONSTRAINT \`cartitems_ibfk_1\` FOREIGN KEY (\`UserId\`) REFERENCES \`Users\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`,
  `CREATE TABLE \`WishlistItems\` (
    \`id\` int NOT NULL AUTO_INCREMENT,
    \`productId\` int DEFAULT NULL,
    \`name\` varchar(255) NOT NULL,
    \`price\` float DEFAULT '0',
    \`image\` varchar(255) DEFAULT NULL,
    \`createdAt\` datetime NOT NULL,
    \`updatedAt\` datetime NOT NULL,
    \`UserId\` int NOT NULL,
    PRIMARY KEY (\`id\`),
    KEY \`UserId\` (\`UserId\`),
    CONSTRAINT \`wishlistitems_ibfk_1\` FOREIGN KEY (\`UserId\`) REFERENCES \`Users\` (\`id\`) ON DELETE CASCADE
  ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4`
];

async function buildLegacyDatabase(database) {
  await dropDatabase(database);
  await createDatabase(database);
  const connection = await mysql.createConnection(toMysql2Options(settingsFor(database)));
  try {
    for (const ddl of LEGACY_DDL) await connection.query(ddl);
    const hash = bcrypt.hashSync("legacy-password", 10);
    await connection.query(
      "INSERT INTO `Users` (`id`,`name`,`email`,`password`,`isVerified`,`createdAt`,`updatedAt`) VALUES " +
        "(1,'Sachin Legacy','legacy.user@buyotest.local',?,1,NOW(),NOW())," +
        "(2,'Legacy Admin','legacy.admin@buyotest.local',?,1,NOW(),NOW())",
      [hash, hash]
    );
    await connection.query(
      "INSERT INTO `Products` (`id`,`name`,`category`,`description`,`mrpPrice`,`sellingPrice`,`image`,`createdAt`,`updatedAt`) VALUES " +
        "(1,'Gold Table Lamp','Electronics','Warm lamp',4999,2999,'/uploads/legacy-1.jpg',NOW(),NOW())," +
        "(2,'Smart Bulb','Electronics',NULL,999,599,NULL,NOW(),NOW())," +
        "(3,?,'  Home Décor ',NULL,1299,999,NULL,NOW(),NOW())",
      ['Café "Lamp" #3']
    );
    await connection.query(
      "INSERT INTO `CartItems` (`id`,`productId`,`name`,`price`,`image`,`qty`,`createdAt`,`updatedAt`,`UserId`) VALUES " +
        "(1,1,'Gold Table Lamp',2999,NULL,2,NOW(),NOW(),1)"
    );
    await connection.query(
      "INSERT INTO `WishlistItems` (`id`,`productId`,`name`,`price`,`image`,`createdAt`,`updatedAt`,`UserId`) VALUES " +
        "(1,2,'Smart Bulb',599,NULL,NOW(),NOW(),1)"
    );
  } finally {
    await connection.end();
  }
}

describe("Phase 3 migrations + tooling (scratch DBs only)", () => {
  let backupPath = "";
  let sequelize = null;

  before(async () => {
    for (const name of ALL_SCRATCH) await dropDatabase(name);
    await createDatabase(GUARD_DB);
    await buildLegacyDatabase(LEGACY_DB);
    const backup = await createBackup({ settings: settingsFor(LEGACY_DB), outDir: TEST_BACKUPS_DIR });
    backupPath = backup.outPath;
    assert.equal(backup.dump.tables.products.rowCount, 3);
  });

  after(async () => {
    if (sequelize) await sequelize.close().catch(() => {});
    for (const name of ALL_SCRATCH) await dropDatabase(name).catch(() => {});
    await fsp.rm(TEST_BACKUPS_DIR, { recursive: true, force: true });
  });

  it("migrate CLI refuses without --confirm-local and touches nothing", async () => {
    const res = await runCli("scripts/migrate.js", [], {
      MYSQL_DB: GUARD_DB,
      DB_MIGRATE_ALLOWED_DATABASES: GUARD_DB
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /missing --confirm-local flag/);
    assert.deepEqual(await tableNames(GUARD_DB), [], "a refused run must not touch the database");
  });

  it("migrate CLI refuses NODE_ENV=production", async () => {
    const res = await runCli("scripts/migrate.js", ["--confirm-local"], {
      MYSQL_DB: GUARD_DB,
      DB_MIGRATE_ALLOWED_DATABASES: GUARD_DB,
      NODE_ENV: "production"
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /NODE_ENV=production is set/);
  });

  it("migrate CLI refuses non-loopback hosts before any connection", async () => {
    const res = await runCli("scripts/migrate.js", ["--confirm-local"], {
      MYSQL_DB: GUARD_DB,
      DB_MIGRATE_ALLOWED_DATABASES: GUARD_DB,
      MYSQL_HOST: "10.255.255.1"
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /not loopback/);
  });

  it("migrate CLI refuses databases outside the allowlist", async () => {
    const res = await runCli("scripts/migrate.js", ["--confirm-local"], {
      MYSQL_DB: GUARD_DB,
      DB_MIGRATE_ALLOWED_DATABASES: "some_other_database"
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /is not in DB_MIGRATE_ALLOWED_DATABASES/);
    assert.deepEqual(await tableNames(GUARD_DB), []);
  });

  it("db:sync still refuses without --confirm-local (guard regression)", async () => {
    const res = await runCli("scripts/db-sync.js", [], {
      MYSQL_DB: GUARD_DB,
      DB_SYNC_ALLOWED_DATABASES: GUARD_DB
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /db:sync only runs against an explicitly confirmed LOCAL dev database/);
  });

  it("db:sync --alter is refused and points at migrations", async () => {
    const res = await runCli("scripts/db-sync.js", ["--confirm-local", "--alter"], {
      MYSQL_DB: GUARD_DB,
      DB_SYNC_ALLOWED_DATABASES: GUARD_DB
    });
    assert.equal(res.code, 1);
    assert.match(res.stderr, /--alter is disabled/);
    assert.match(res.stderr, /npm run db:migrate/);
    assert.deepEqual(await tableNames(GUARD_DB), []);
  });

  it("legacy schema migrates to v1: roles, categories, catalog fields, backfills", async () => {
    const result = await runMigrations({ settings: settingsFor(LEGACY_DB), quiet: true });
    assert.deepEqual(result.applied, [
      "001_add_users_role.sql",
      "002_create_categories.sql",
      "003_products_catalog_fields.sql"
    ]);

    // role column: additive; existing users default to customer (admins keep the allowlist fallback)
    const users = await queryDb(LEGACY_DB, "SELECT id, email, role FROM `Users` ORDER BY id");
    assert.equal(users.length, 2);
    assert.deepEqual(users.map((u) => u.role), ["customer", "customer"]);

    // Categories built from distinct legacy category strings (trimmed), configurable tax rate
    const categories = await queryDb(LEGACY_DB, "SELECT id, name, slug, taxRate FROM `Categories` ORDER BY id");
    assert.deepEqual(categories.map((c) => c.name), ["Electronics", "Home Décor"]);
    assert.deepEqual(categories.map((c) => c.slug), ["electronics-c1", "home-d-cor-c3"]);
    assert.deepEqual(categories.map((c) => String(c.taxRate)), ["0.00", "0.00"]);

    // Products: new fields populated; legacy `category` strings untouched
    const products = await queryDb(
      LEGACY_DB,
      "SELECT id, category, slug, stock, imageMeta, categoryId FROM `Products` ORDER BY id"
    );
    assert.deepEqual(products.map((p) => p.category), ["Electronics", "Electronics", "  Home Décor "]);
    assert.deepEqual(products.map((p) => p.slug), ["gold-table-lamp-p1", "smart-bulb-p2", "caf-lamp-3-p3"]);
    assert.deepEqual(products.map((p) => p.stock), [0, 0, 0]);
    assert.deepEqual(products.map((p) => p.imageMeta), [null, null, null]);
    assert.deepEqual(products.map((p) => p.categoryId), [1, 1, 2]);

    const applied = await queryDb(LEGACY_DB, "SELECT id FROM `schema_migrations` ORDER BY id");
    assert.equal(applied.length, 3);
  });

  it("constraints are enforced (unique, FK set-null, enum, NOT NULL)", async () => {
    await assert.rejects(
      queryDb(
        LEGACY_DB,
        "INSERT INTO `Products` (`name`,`category`,`mrpPrice`,`sellingPrice`,`slug`,`stock`,`createdAt`,`updatedAt`) VALUES ('Dup','x',1,1,'gold-table-lamp-p1',0,NOW(),NOW())"
      ),
      /Duplicate entry/
    );
    await assert.rejects(
      queryDb(
        LEGACY_DB,
        "INSERT INTO `Categories` (`name`,`slug`,`taxRate`,`createdAt`,`updatedAt`) VALUES ('Electronics','another-slug',0,NOW(),NOW())"
      ),
      /Duplicate entry/
    );
    await assert.rejects(
      queryDb(
        LEGACY_DB,
        "INSERT INTO `Products` (`name`,`category`,`mrpPrice`,`sellingPrice`,`stock`,`createdAt`,`updatedAt`) VALUES ('No Slug','x',1,1,0,NOW(),NOW())"
      ),
      /doesn't have a default value|cannot be null/
    );
    await assert.rejects(
      queryDb(LEGACY_DB, "UPDATE `Users` SET `role` = 'superadmin' WHERE `id` = 1"),
      /Data truncated|Incorrect enum/i
    );
    await assert.rejects(
      queryDb(LEGACY_DB, "UPDATE `Products` SET `categoryId` = 99999 WHERE `id` = 1"),
      /foreign key constraint/i
    );

    // ON DELETE SET NULL: product survives, link clears, legacy string preserved
    await queryDb(LEGACY_DB, "DELETE FROM `Categories` WHERE `name` = 'Home Décor'");
    const product3 = await queryDb(LEGACY_DB, "SELECT categoryId, category FROM `Products` WHERE id = 3");
    assert.equal(product3[0].categoryId, null);
    assert.equal(product3[0].category, "  Home Décor ");
  });

  it("migration runner is idempotent (second run applies nothing)", async () => {
    const again = await runMigrations({ settings: settingsFor(LEGACY_DB), quiet: true });
    assert.equal(again.applied.length, 0);
    assert.equal(again.upToDate, true);

    const status = await runMigrations({ settings: settingsFor(LEGACY_DB), quiet: true, statusOnly: true });
    assert.equal(status.pending.length, 0);
    assert.equal(status.upToDate, true);
  });

  it("re-running a guarded migration after a simulated partial failure completes safely", async () => {
    await queryDb(LEGACY_DB, "DELETE FROM `schema_migrations` WHERE `id` = '003_products_catalog_fields.sql'");
    const rerun = await runMigrations({ settings: settingsFor(LEGACY_DB), quiet: true });
    assert.deepEqual(rerun.applied, ["003_products_catalog_fields.sql"]);
    const again = await runMigrations({ settings: settingsFor(LEGACY_DB), quiet: true });
    assert.equal(again.applied.length, 0);
  });

  it("checksum protection refuses when an applied migration file changed", async () => {
    await queryDb(
      LEGACY_DB,
      "UPDATE `schema_migrations` SET `checksum` = REPEAT('0', 64) WHERE `id` = '001_add_users_role.sql'"
    );
    try {
      await assert.rejects(
        runMigrations({ settings: settingsFor(LEGACY_DB), quiet: true }),
        /already-applied migration file\(s\) changed/
      );
    } finally {
      const content = await fsp.readFile(path.join(MIGRATIONS_DIR, "001_add_users_role.sql"), "utf8");
      await queryDb(
        LEGACY_DB,
        "UPDATE `schema_migrations` SET `checksum` = ? WHERE `id` = '001_add_users_role.sql'",
        [computeChecksum(content)]
      );
    }
  });

  it("recovery rehearsal: the pre-migration backup restores into a scratch DB", async () => {
    const result = await runRestore({
      backupPath,
      targetDatabase: RECOVERED_DB,
      settings: settingsFor(RECOVERED_DB),
      log: () => {}
    });

    const names = Object.keys(result.tables).map((n) => n.toLowerCase()).sort();
    assert.deepEqual(names, ["cartitems", "products", "users", "wishlistitems"], "backup predates Categories");
    const total = Object.values(result.tables).reduce((a, b) => a + b, 0);
    assert.equal(total, 2 + 3 + 1 + 1);

    const cols = await queryDb(
      RECOVERED_DB,
      "SELECT COLUMN_NAME AS c FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = ? AND TABLE_NAME = 'Users'",
      [RECOVERED_DB]
    );
    assert.ok(!cols.map((r) => r.c).includes("role"), "recovered pre-migration DB must not have role");

    const recoveredUsers = await queryDb(RECOVERED_DB, "SELECT id, name, email FROM `Users` ORDER BY id");
    assert.equal(recoveredUsers[0].email, "legacy.user@buyotest.local");
    const recoveredProducts = await queryDb(RECOVERED_DB, "SELECT id, name, category FROM `Products` ORDER BY id");
    assert.equal(recoveredProducts.length, 3);
    assert.equal(recoveredProducts[2].name, 'Café "Lamp" #3');

    // Refusals: existing target / source database / bad format
    await assert.rejects(
      runRestore({ backupPath, targetDatabase: RECOVERED_DB, settings: settingsFor(RECOVERED_DB), log: () => {} }),
      /already exists/
    );
    await assert.rejects(
      runRestore({ backupPath, targetDatabase: LEGACY_DB, settings: settingsFor(LEGACY_DB), log: () => {} }),
      /the database the backup was taken from/
    );
  });

  it("sync-built schema (fresh dev DB) matches the migrated schema", async () => {
    await createDatabase(SYNC_DB);

    const seq = require("../config/db");
    require("../models/user");
    require("../models/category");
    require("../models/product");
    require("../models/cart");
    require("../models/wishlist");
    await seq.sync();
    sequelize = seq;

    // Fresh sync-built DB: migrations find every change already present, record them
    const first = await runMigrations({ settings: settingsFor(SYNC_DB), quiet: true });
    assert.deepEqual(first.applied, [
      "001_add_users_role.sql",
      "002_create_categories.sql",
      "003_products_catalog_fields.sql"
    ]);
    const second = await runMigrations({ settings: settingsFor(SYNC_DB), quiet: true });
    assert.equal(second.applied.length, 0);

    const migratedShape = await fetchSchemaShape(LEGACY_DB);
    const syncedShape = await fetchSchemaShape(SYNC_DB);
    assert.deepEqual(syncedShape, migratedShape, "Sequelize-sync schema must match the migration-built schema");
  });

  it("admin provisioning: grant/revoke/list via the audited script path", async () => {
    const settings = settingsFor(LEGACY_DB);

    const grant = await applyRoleChange({ settings, email: "legacy.admin@buyotest.local", role: "admin" });
    assert.equal(grant.before, "customer");
    assert.equal(grant.after, "admin");
    assert.equal(grant.changed, true);

    const admins = await listAdmins({ settings });
    assert.deepEqual(admins.map((a) => a.email), ["legacy.admin@buyotest.local"]);

    const noop = await applyRoleChange({ settings, email: "legacy.admin@buyotest.local", role: "admin" });
    assert.equal(noop.changed, false);

    const revoke = await applyRoleChange({ settings, email: "legacy.admin@buyotest.local", role: "customer" });
    assert.equal(revoke.changed, true);
    assert.deepEqual(await listAdmins({ settings }), []);

    await assert.rejects(
      applyRoleChange({ settings, email: "nobody@buyotest.local", role: "admin" }),
      /No user found/
    );
    await assert.rejects(
      applyRoleChange({ settings, email: "legacy.admin@buyotest.local", role: "superadmin" }),
      /Invalid role/
    );
  });
});
