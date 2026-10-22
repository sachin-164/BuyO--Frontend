// test/dataMigration.test.js — Phase 11: MySQL → PostgreSQL data-migration
// rehearsal against DISPOSABLE local fixtures only.
//
//   - Source fixtures: buyoDB_ph11_src / buyoDB_ph11_src_dup (synthetic rows,
//     dropped and recreated here — the real buyoDB is never touched).
//   - Target: buyoDB_ph11_import on the embedded PostgreSQL harness (this
//     file runs under test/pgSuite.js: DB_DIALECT=postgres, loopback PG_*).
//   - Proves: schema validation on a fresh scratch (sync + numbered .pgsql),
//     guard refusals BEFORE any connection, violation refusal with ids and
//     zero writes, credential-free summaries, id/relationship/count/sequence
//     preservation, previously-imported refusal, and that the migration
//     runner still refuses hosted targets.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("path");
const mysql = require("mysql2/promise");
const { Client } = require("pg");
const bcrypt = require("bcryptjs");

require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });
process.env.NODE_ENV = "test";

const {
  resolveMysqlSettings,
  resolvePostgresSettings,
  toMysql2Options
} = require("../config/dbConnectionOptions");
const { pgClientOptions } = require("../scripts/lib/pgClientOptions");

const execFileAsync = promisify(execFile);
const BACKEND = path.join(__dirname, "..");

const SRC_DB = "buyoDB_ph11_src";
const DUP_DB = "buyoDB_ph11_src_dup";
const TARGET_DB = "buyoDB_ph11_import";
const NOTALLOWED_DB = "buyoDB_ph11_notallowed"; // never created (refused pre-connect)

const HASH = bcrypt.hashSync("fixture-only", 4);

// Expected happy-fixture rows (synthetic, deterministic).
const EXPECTED = {
  Users: 3,
  Categories: 2,
  Addresses: 2,
  Products: 3,
  Orders: 2,
  OrderItems: 3,
  OrderStatusEvents: 3,
  CartItems: 2,
  WishlistItems: 2
};

// ------------------------------------------------------------------ plumbing

async function mysqlAdmin(fn) {
  const conn = await mysql.createConnection(toMysql2Options(resolveMysqlSettings(), { includeDatabase: false }));
  try { return await fn(conn); } finally { await conn.end(); }
}
const dropMysqlDb = (name) => mysqlAdmin((c) => c.query(`DROP DATABASE IF EXISTS \`${name}\``));
const createMysqlDb = (name) => mysqlAdmin((c) => c.query(`CREATE DATABASE \`${name}\` DEFAULT CHARSET utf8mb4`));

async function eachMysql(db, statements) {
  const conn = await mysql.createConnection(toMysql2Options({ ...resolveMysqlSettings(), database: db }));
  try {
    for (const sql of statements) await conn.query(sql);
  } finally {
    await conn.end();
  }
}

async function pgAdmin(fn) {
  const client = new Client({ ...pgClientOptions(resolvePostgresSettings()), database: "postgres" });
  await client.connect();
  try { return await fn(client); } finally { await client.end(); }
}
const dropPgDb = (name) => pgAdmin((c) => c.query(`DROP DATABASE IF EXISTS "${name}"`));
const createPgDb = (name) => pgAdmin((c) => c.query(`CREATE DATABASE "${name}"`));

function run(script, args, envOverrides = {}) {
  const env = { ...process.env, DB_DIALECT: "postgres", ...envOverrides };
  return execFileAsync(process.execPath, [path.join(BACKEND, script), ...args], {
    cwd: BACKEND, env, encoding: "utf8", timeout: 60000
  }).then(
    (res) => ({ code: 0, stdout: res.stdout, stderr: res.stderr }),
    (err) => ({ code: err.code === undefined ? 1 : err.code, stdout: err.stdout || "", stderr: err.stderr || "" })
  );
}

const CONNECT_ATTEMPT = /ECONNREFUSED|getaddrinfo|ENOTFOUND|EPIPE|ETIMEDOUT/i;
function assertRefusedWithoutConnecting(res, pattern) {
  assert.equal(res.code, 1, `expected refusal exit 1:\n${res.stdout}${res.stderr}`);
  assert.match(res.stderr, /REFUSED/);
  if (pattern) assert.match(res.stderr, pattern);
  assert.ok(!CONNECT_ATTEMPT.test(res.stderr), `refusal must happen before any connection:\n${res.stderr}`);
}
function assertCredentialFree(res) {
  const blob = res.stdout + res.stderr;
  assert.ok(!/@buyotest\.local/i.test(blob), `no emails may appear in output:\n${blob}`);
  assert.ok(!/\$2[aby]\$\d\d\$/.test(blob), `no password hashes may appear in output`);
  assert.ok(!/fixture-only/.test(blob), `no password values may appear in output`);
}

// Faithful source schema (subset of the real buyoDB audit: column types, PKs,
// uniques and FKs; non-unique indexes omitted — they do not affect migration).
function sourceSchemaSql({ caseDupEmails = false } = {}) {
  const emailType = caseDupEmails
    ? "`email` VARCHAR(255) COLLATE utf8mb4_bin NOT NULL" // staging device: lets
    : "`email` VARCHAR(255) NOT NULL";                    // a case-dup EXIST in source
  return [
    `CREATE TABLE \`users\` (\`id\` INT NOT NULL AUTO_INCREMENT, \`name\` VARCHAR(255) NOT NULL, ${emailType}, \`password\` VARCHAR(255) NOT NULL, \`isVerified\` TINYINT(1) NULL DEFAULT 0, \`role\` ENUM('customer','admin') NOT NULL DEFAULT 'customer', \`createdAt\` DATETIME NOT NULL, \`updatedAt\` DATETIME NOT NULL, PRIMARY KEY (\`id\`), UNIQUE KEY \`email\` (\`email\`)) DEFAULT CHARSET=utf8mb4`,
    "CREATE TABLE `categories` (`id` INT NOT NULL AUTO_INCREMENT, `name` VARCHAR(100) NOT NULL, `slug` VARCHAR(160) NOT NULL, `description` TEXT NULL, `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 0.00, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_categories_name` (`name`), UNIQUE KEY `uq_categories_slug` (`slug`)) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `addresses` (`id` INT NOT NULL AUTO_INCREMENT, `userId` INT NOT NULL, `label` VARCHAR(50) NULL, `fullName` VARCHAR(100) NOT NULL, `phone` VARCHAR(15) NOT NULL, `line1` VARCHAR(255) NOT NULL, `line2` VARCHAR(255) NULL, `city` VARCHAR(100) NOT NULL, `state` VARCHAR(100) NOT NULL, `pincode` VARCHAR(10) NOT NULL, `isDefault` TINYINT(1) NOT NULL DEFAULT 0, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), KEY `idx_addresses_user` (`userId`), CONSTRAINT `fk_addresses_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `products` (`id` INT NOT NULL AUTO_INCREMENT, `name` VARCHAR(255) NOT NULL, `category` VARCHAR(255) NOT NULL, `description` TEXT NULL, `mrpPrice` FLOAT NOT NULL, `sellingPrice` FLOAT NOT NULL, `image` VARCHAR(255) NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, `slug` VARCHAR(160) NOT NULL, `stock` INT NOT NULL DEFAULT 0, `imageMeta` JSON NULL, `categoryId` INT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_products_slug` (`slug`), KEY `fk_products_category` (`categoryId`), CONSTRAINT `fk_products_category` FOREIGN KEY (`categoryId`) REFERENCES `categories` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `orders` (`id` INT NOT NULL AUTO_INCREMENT, `userId` INT NOT NULL, `orderNumber` VARCHAR(20) NOT NULL, `idempotencyKey` VARCHAR(64) NOT NULL, `status` ENUM('placed','confirmed','shipped','delivered','cancelled') NOT NULL DEFAULT 'placed', `paymentMethod` ENUM('cod') NOT NULL DEFAULT 'cod', `subtotal` DECIMAL(12,2) NOT NULL, `taxTotal` DECIMAL(12,2) NOT NULL DEFAULT 0.00, `grandTotal` DECIMAL(12,2) NOT NULL, `taxBreakdown` JSON NULL, `shippingAddress` JSON NOT NULL, `addressId` INT NULL, `notes` VARCHAR(500) NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), UNIQUE KEY `uq_orders_number` (`orderNumber`), UNIQUE KEY `uq_orders_user_idem` (`userId`,`idempotencyKey`), KEY `idx_orders_user` (`userId`,`createdAt`), KEY `idx_orders_status` (`status`), KEY `idx_orders_address` (`addressId`), CONSTRAINT `fk_orders_user` FOREIGN KEY (`userId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT `fk_orders_address` FOREIGN KEY (`addressId`) REFERENCES `addresses` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `orderitems` (`id` INT NOT NULL AUTO_INCREMENT, `orderId` INT NOT NULL, `productId` INT NULL, `name` VARCHAR(200) NOT NULL, `image` VARCHAR(500) NULL, `unitPrice` DECIMAL(10,2) NOT NULL, `qty` INT NOT NULL, `lineTotal` DECIMAL(12,2) NOT NULL, `taxRate` DECIMAL(5,2) NOT NULL DEFAULT 0.00, `taxAmount` DECIMAL(12,2) NOT NULL DEFAULT 0.00, `categoryName` VARCHAR(100) NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), KEY `idx_order_items_order` (`orderId`), KEY `idx_order_items_product` (`productId`), CONSTRAINT `fk_order_items_order` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE, CONSTRAINT `fk_order_items_product` FOREIGN KEY (`productId`) REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `orderstatusevents` (`id` INT NOT NULL AUTO_INCREMENT, `orderId` INT NOT NULL, `fromStatus` ENUM('placed','confirmed','shipped','delivered','cancelled') NULL, `toStatus` ENUM('placed','confirmed','shipped','delivered','cancelled') NOT NULL, `note` VARCHAR(500) NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, PRIMARY KEY (`id`), KEY `idx_status_events_order` (`orderId`,`createdAt`), CONSTRAINT `fk_status_events_order` FOREIGN KEY (`orderId`) REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `cartitems` (`id` INT NOT NULL AUTO_INCREMENT, `productId` INT NULL, `name` VARCHAR(255) NOT NULL, `price` FLOAT NULL DEFAULT 0, `image` VARCHAR(255) NULL, `qty` INT NULL DEFAULT 1, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, `UserId` INT NOT NULL, PRIMARY KEY (`id`), KEY `UserId` (`UserId`), CONSTRAINT `cartitems_ibfk_1` FOREIGN KEY (`UserId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4",
    "CREATE TABLE `wishlistitems` (`id` INT NOT NULL AUTO_INCREMENT, `productId` INT NULL, `name` VARCHAR(255) NOT NULL, `price` FLOAT NULL DEFAULT 0, `image` VARCHAR(255) NULL, `createdAt` DATETIME NOT NULL, `updatedAt` DATETIME NOT NULL, `UserId` INT NOT NULL, PRIMARY KEY (`id`), KEY `UserId` (`UserId`), CONSTRAINT `wishlistitems_ibfk_1` FOREIGN KEY (`UserId`) REFERENCES `users` (`id`) ON DELETE CASCADE ON UPDATE CASCADE) DEFAULT CHARSET=utf8mb4"
  ];
}

const HAPPY_ROWS = [
  // users (non-contiguous ids; mixed-case email must PASS lower(email) uniqueness)
  `INSERT INTO \`users\` (\`id\`,\`name\`,\`email\`,\`password\`,\`isVerified\`,\`role\`,\`createdAt\`,\`updatedAt\`) VALUES (2,'Alice Alpha','Alice@Buyotest.local','${HASH}',1,'admin',NOW(),NOW()),(5,'Beta Buyer','beta@buyotest.local','${HASH}',0,'customer',NOW(),NOW()),(42,'Gamma Buyer','gamma@buyotest.local','${HASH}',1,'customer',NOW(),NOW())`,
  `INSERT INTO \`categories\` (\`id\`,\`name\`,\`slug\`,\`description\`,\`taxRate\`,\`createdAt\`,\`updatedAt\`) VALUES (3,'Lamps','lamps','Lighting','18.00',NOW(),NOW()),(7,'Gadgets','gadgets','Widgets','5.00',NOW(),NOW())`,
  `INSERT INTO \`addresses\` (\`id\`,\`userId\`,\`label\`,\`fullName\`,\`phone\`,\`line1\`,\`line2\`,\`city\`,\`state\`,\`pincode\`,\`isDefault\`,\`createdAt\`,\`updatedAt\`) VALUES (4,2,'Home','Alice Alpha','9999999999','12 Moon Rd','Apt 2','Pune','MH','411001',1,NOW(),NOW()),(9,5,'Work','Beta Buyer','8888888888','4 Star Ave',NULL,'Bengaluru','KA','560001',0,NOW(),NOW())`,
  `INSERT INTO \`products\` (\`id\`,\`name\`,\`category\`,\`description\`,\`mrpPrice\`,\`sellingPrice\`,\`image\`,\`createdAt\`,\`updatedAt\`,\`slug\`,\`stock\`,\`imageMeta\`,\`categoryId\`) VALUES (1,'Desk Lamp','Lamps','Warm desk lamp',1299.50,999.00,'/uploads/desk-1.jpg',NOW(),NOW(),'desk-lamp',7,'{\"alt\":\"desk lamp\",\"width\":800}',3),(6,'Gadget Pro','Gadgets','Shiny',499.00,449.00,NULL,NOW(),NOW(),'gadget-pro',3,NULL,7),(11,'Legacy Bulb','Legacy Lamps','No categoryId',99.00,79.00,'/uploads/legacy-11.jpg',NOW(),NOW(),'legacy-bulb',0,NULL,NULL)`,
  `INSERT INTO \`orders\` (\`id\`,\`userId\`,\`orderNumber\`,\`idempotencyKey\`,\`status\`,\`paymentMethod\`,\`subtotal\`,\`taxTotal\`,\`grandTotal\`,\`taxBreakdown\`,\`shippingAddress\`,\`addressId\`,\`notes\`,\`createdAt\`,\`updatedAt\`) VALUES (3,2,'ORD-1001','idem-aaa','shipped','cod','1999.00','180.00','2179.00','{\"gst\":180.00}','{\"city\":\"Pune\",\"pincode\":\"411001\"}',4,NULL,NOW(),NOW()),(8,5,'ORD-1002','idem-bbb','placed','cod','499.00','0.00','499.00',NULL,'{\"city\":\"Bengaluru\",\"pincode\":\"560001\"}',NULL,'gift wrap',NOW(),NOW())`,
  `INSERT INTO \`orderitems\` (\`id\`,\`orderId\`,\`productId\`,\`name\`,\`image\`,\`unitPrice\`,\`qty\`,\`lineTotal\`,\`taxRate\`,\`taxAmount\`,\`categoryName\`,\`createdAt\`,\`updatedAt\`) VALUES (5,3,1,'Desk Lamp','/uploads/desk-1.jpg','999.50',2,'1999.00','9.00','179.91','Lamps',NOW(),NOW()),(10,3,6,'Gadget Pro',NULL,'50.00',1,'50.00','0.00','0.00','Gadgets',NOW(),NOW()),(15,8,NULL,'Deleted SKU',NULL,'499.00',1,'499.00','0.00','0.00','Gadgets',NOW(),NOW())`,
  `INSERT INTO \`orderstatusevents\` (\`id\`,\`orderId\`,\`fromStatus\`,\`toStatus\`,\`note\`,\`createdAt\`,\`updatedAt\`) VALUES (6,3,'placed','confirmed',NULL,NOW(),NOW()),(7,3,'confirmed','shipped',NULL,NOW(),NOW()),(11,8,NULL,'placed',NULL,NOW(),NOW())`,
  // cart: productId 101 has no product row (legal: no FK on productId, NULL allowed too)
  `INSERT INTO \`cartitems\` (\`id\`,\`productId\`,\`name\`,\`price\`,\`image\`,\`qty\`,\`createdAt\`,\`updatedAt\`,\`UserId\`) VALUES (6,101,'Ghost Product',9.99,'/uploads/g1.jpg',2,NOW(),NOW(),2),(9,6,'Gadget Pro',449,NULL,1,NOW(),NOW(),2)`,
  `INSERT INTO \`wishlistitems\` (\`id\`,\`productId\`,\`name\`,\`price\`,\`image\`,\`createdAt\`,\`updatedAt\`,\`UserId\`) VALUES (5,6,'Gadget Pro',449,NULL,NOW(),NOW(),5),(8,101,'Ghost Product',12.50,'/uploads/w2.jpg',NOW(),NOW(),5)`
];

const DUP_ROWS = [
  // case-variant emails (ids 1,2) — blocked by PG lower(email) uniques
  `INSERT INTO \`users\` (\`id\`,\`name\`,\`email\`,\`password\`,\`isVerified\`,\`role\`,\`createdAt\`,\`updatedAt\`) VALUES (1,'Dup One','Case-Dup@buyotest.local','${HASH}',0,'customer',NOW(),NOW()),(2,'Dup Two','case-dup@buyotest.local','${HASH}',0,'customer',NOW(),NOW())`,
  // exact duplicate cart line (ids 1,2) + FK violation (id 3, UserId 999 missing)
  "SET FOREIGN_KEY_CHECKS=0",
  "INSERT INTO `cartitems` (`id`,`productId`,`name`,`price`,`image`,`qty`,`createdAt`,`updatedAt`,`UserId`) VALUES (1,101,'Ghost',9.99,NULL,1,NOW(),NOW(),1),(2,101,'Ghost',9.99,NULL,1,NOW(),NOW(),1),(3,101,'Orphan',9.99,NULL,1,NOW(),NOW(),999)",
  "SET FOREIGN_KEY_CHECKS=1"
];

// ------------------------------------------------------------------ suite

describe("Phase 11: MySQL → PostgreSQL data migration rehearsal (local only)", () => {
  let targetTables = {}; // lowercased source key -> exact PG name
  let sourceSums = {};

  before(async () => {
    // Source fixtures (synthetic; real buyoDB untouched)
    await dropMysqlDb(SRC_DB);
    await createMysqlDb(SRC_DB);
    await eachMysql(SRC_DB, [...sourceSchemaSql(), ...HAPPY_ROWS]);

    await dropMysqlDb(DUP_DB);
    await createMysqlDb(DUP_DB);
    await eachMysql(DUP_DB, [...sourceSchemaSql({ caseDupEmails: true }), ...DUP_ROWS]);

    // Fresh target + full schema (models sync + numbered .pgsql migrations)
    await dropPgDb(TARGET_DB);
    await createPgDb(TARGET_DB);
    const schema = await run("test/pgSchemaFor.js", [TARGET_DB]);
    assert.equal(schema.code, 0, `schema setup failed:\n${schema.stdout}${schema.stderr}`);
    assert.match(schema.stdout, new RegExp(`SCHEMA_OK ${TARGET_DB}`));
    assert.match(schema.stdout, /applied_pgsql=5/); // 000, 005, 006, 007, 008
  });

  after(async () => {
    await dropMysqlDb(SRC_DB).catch(() => {});
    await dropMysqlDb(DUP_DB).catch(() => {});
    await dropPgDb(TARGET_DB).catch(() => {});
  });

  // ------------------------------------------------------------ §5 schema

  it("fresh scratch target: all tables, migration indexes, 9 FKs and key types", async (t) => {
    const client = new Client(pgClientOptions({ ...resolvePostgresSettings(), database: TARGET_DB }));
    await client.connect();
    try {
      const tablesRes = await client.query(
        `SELECT table_name FROM information_schema.tables WHERE table_schema='public' AND table_type='BASE TABLE'`
      );
      const pgNames = tablesRes.rows.map((r) => r.table_name);
      // Map by case-insensitive lookup (physical casing recorded for later tests)
      const expectedKeys = Object.keys(EXPECTED);
      for (const key of expectedKeys) {
        const found = pgNames.find((n) => n.toLowerCase() === key.toLowerCase());
        assert.ok(found, `missing target table ${key} (have: ${pgNames.join(", ")})`);
        targetTables[found] = found;
      }
      assert.ok(pgNames.includes("schema_migrations"), "bookkeeping table exists");
      const bookkeeping = await client.query(`SELECT count(*)::int AS n FROM "schema_migrations"`);
      assert.equal(bookkeeping.rows[0].n, 5, "numbered .pgsql migrations recorded");

      const idx = await client.query(
        `SELECT indexname FROM pg_indexes WHERE schemaname='public'`
      );
      const idxNames = idx.rows.map((r) => r.indexname);
      for (const name of [
        "uq_cartitems_user_product",
        "uq_wishlistitems_user_product",
        "uq_users_email_lower",
        "uq_categories_name_lower"
      ]) {
        assert.ok(idxNames.includes(name), `missing migration index ${name}`);
      }
      for (const name of ["idx_orders_user", "idx_status_events_order", "idx_addresses_user"]) {
        assert.ok(idxNames.includes(name), `missing model index ${name}`);
      }

      const fks = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE contype='f' AND connamespace='public'::regnamespace`
      );
      assert.equal(fks.rows[0].n, 9, "exactly 9 foreign keys");

      const types = await client.query(
        `SELECT table_name, column_name, data_type, udt_name FROM information_schema.columns
         WHERE table_schema='public' ORDER BY table_name, ordinal_position`
      );
      const typeOf = (t2, c) => types.rows.find((r) => r.table_name === t2 && r.column_name === c);
      const userType = typeOf("Users", "role");
      assert.equal(userType.data_type, "USER-DEFINED");
      assert.match(userType.udt_name, /^enum_/);
      assert.equal(typeOf("Users", "isVerified").data_type, "boolean");
      assert.equal(typeOf("Orders", "subtotal").data_type, "numeric");
      assert.equal(typeOf("Orders", "createdAt").data_type, "timestamp with time zone");
      assert.ok(["json", "jsonb"].includes(typeOf("Orders", "shippingAddress").data_type));
      assert.ok(["json", "jsonb"].includes(typeOf("Products", "imageMeta").data_type));

      // Evidence line for the phase report: the actual PG type mapping.
      const interesting = types.rows
        .filter((r) =>
          ["USER-DEFINED", "boolean", "numeric", "real", "double precision", "json", "jsonb",
           "timestamp with time zone", "text", "integer", "character varying"].includes(r.data_type)
        )
        .map((r) => `${r.table_name}.${r.column_name}=${r.data_type}${r.data_type === "USER-DEFINED" ? `(${r.udt_name})` : ""}`);
      t.diagnostic(`TYPEMAP ${interesting.join(" ")}`);
    } finally {
      await client.end();
    }
  });

  // ------------------------------------------------------------ §4 guards

  it("guard refusals happen before any connection (flags, allowlist, production, dialect, remote source/target)", async () => {
    const src = ["--source-db", SRC_DB, "--target-db", TARGET_DB, "--confirm-local"];

    const noFlags = await run("scripts/migrate-data.js", []);
    assertRefusedWithoutConnecting(noFlags, /--source-db <mysql-db>/);

    const noConfirm = await run("scripts/migrate-data.js", ["--source-db", SRC_DB, "--target-db", TARGET_DB]);
    assertRefusedWithoutConnecting(noConfirm, /missing --confirm-local flag/);

    const notAllowed = await run("scripts/migrate-data.js", [
      "--source-db", SRC_DB, "--target-db", NOTALLOWED_DB, "--confirm-local"
    ]);
    assertRefusedWithoutConnecting(notAllowed, /is not in DB_DATA_MIGRATE_ALLOWED_DATABASES/);

    const production = await run("scripts/migrate-data.js", src, { NODE_ENV: "production" });
    assertRefusedWithoutConnecting(production, /NODE_ENV=production/);

    const wrongDialect = await run("scripts/migrate-data.js", src, { DB_DIALECT: "mysql" });
    assertRefusedWithoutConnecting(wrongDialect, /target is PostgreSQL/);

    const remoteSource = await run("scripts/migrate-data.js", src, { MYSQL_HOST: "10.255.255.1" });
    assertRefusedWithoutConnecting(remoteSource, /remote MySQL sources are not supported/);

    const remoteTarget = await run("scripts/migrate-data.js", [
      "--source-db", SRC_DB, "--target-db", "buyo_sandbox", "--confirm-remote"
    ], { PG_HOST: "10.255.255.1" });
    assertRefusedWithoutConnecting(remoteTarget, /PG_REMOTE_MIGRATION_APPROVED/);
    assertCredentialFree(remoteTarget);
  });

  // ------------------------------------------------- §4 violation refusal

  it("violations are refused with row ids (no emails printed) and NOTHING is written", async () => {
    const res = await run("scripts/migrate-data.js", [
      "--source-db", DUP_DB, "--target-db", TARGET_DB, "--confirm-local"
    ]);
    assert.equal(res.code, 1, `expected refusal:\n${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /REFUSED/);
    assert.match(res.stderr, /NO rows were written/);
    assert.match(res.stderr, /case-insensitive unique lower\(email\)/);
    assert.match(res.stderr, /ids: 1, 2/);
    assert.match(res.stderr, /unique \(UserId, productId\)/);
    assert.match(res.stderr, /FK UserId -> Users \(parent row missing\)/);
    assert.match(res.stderr, /ids: 3/);
    assertCredentialFree(res);
    assert.ok(!CONNECT_ATTEMPT.test(res.stderr), "no connection-level errors expected");

    // target untouched: every business table still empty
    const client = new Client(pgClientOptions({ ...resolvePostgresSettings(), database: TARGET_DB }));
    await client.connect();
    try {
      for (const name of Object.values(targetTables)) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${name}"`);
        assert.equal(rows[0].n, 0, `${name} must be empty after a refused run`);
      }
    } finally {
      await client.end();
    }
  });

  it("dry-run validates fully and writes nothing", async () => {
    const res = await run("scripts/migrate-data.js", [
      "--source-db", SRC_DB, "--target-db", TARGET_DB, "--confirm-local", "--dry-run"
    ]);
    assert.equal(res.code, 0, `dry-run should pass:\n${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /DRY RUN — validation passed; nothing was written/);
    assertCredentialFree(res);

    const client = new Client(pgClientOptions({ ...resolvePostgresSettings(), database: TARGET_DB }));
    await client.connect();
    try {
      for (const name of Object.values(targetTables)) {
        const { rows } = await client.query(`SELECT count(*)::int AS n FROM "${name}"`);
        assert.equal(rows[0].n, 0, `${name} must still be empty after dry-run`);
      }
    } finally {
      await client.end();
    }
  });

  // ------------------------------------------------------- §4 real import

  it("import preserves ids, relationships and rows; summary is credential-free", async () => {
    const res = await run("scripts/migrate-data.js", [
      "--source-db", SRC_DB, "--target-db", TARGET_DB, "--confirm-local"
    ]);
    assert.equal(res.code, 0, `import failed:\n${res.stdout}${res.stderr}`);
    assert.match(res.stdout, /counts MATCH, ids preserved: YES/);
    assert.match(res.stdout, /FK orphan check: 0 issues/);
    assert.match(res.stdout, /sequences reset: 9\/9 verified/);
    assert.match(res.stdout, /✅ migrate:data complete/);
    assertCredentialFree(res);
  });

  it("row-count and relationship verification: source vs target compared independently", async () => {
    const src = await mysql.createConnection(toMysql2Options({ ...resolveMysqlSettings(), database: SRC_DB }));
    const tgt = new Client(pgClientOptions({ ...resolvePostgresSettings(), database: TARGET_DB }));
    await tgt.connect();
    try {
      for (const [srcTable, expCount] of Object.entries({
        users: EXPECTED.Users,
        categories: EXPECTED.Categories,
        addresses: EXPECTED.Addresses,
        products: EXPECTED.Products,
        orders: EXPECTED.Orders,
        orderitems: EXPECTED.OrderItems,
        orderstatusevents: EXPECTED.OrderStatusEvents,
        cartitems: EXPECTED.CartItems,
        wishlistitems: EXPECTED.WishlistItems
      })) {
        const [srcRows] = await src.query(`SELECT id FROM \`${srcTable}\` ORDER BY id`);
        const pgName = Object.values(targetTables).find((n) => n.toLowerCase() === srcTable);
        const tgtRows = await tgt.query(`SELECT "id" FROM "${pgName}" ORDER BY "id"`);
        const srcIds = srcRows.map((r) => Number(r.id));
        const tgtIds = tgtRows.rows.map((r) => Number(r.id));
        assert.equal(srcIds.length, expCount, `${srcTable} fixture count`);
        assert.deepEqual(tgtIds, srcIds, `${srcTable}: target ids must equal source ids, ordered`);
        sourceSums[srcTable] = srcIds.reduce((a, b) => a + b, 0);
      }

      // FK relationship evidence (9 joins)
      const fkChecks = [
        [`SELECT count(*)::int n FROM "Addresses" c JOIN "Users" p ON p.id=c."userId"`, EXPECTED.Addresses],
        [`SELECT count(*)::int n FROM "CartItems" c JOIN "Users" p ON p.id=c."UserId"`, EXPECTED.CartItems],
        [`SELECT count(*)::int n FROM "WishlistItems" c JOIN "Users" p ON p.id=c."UserId"`, EXPECTED.WishlistItems],
        [`SELECT count(*)::int n FROM "Orders" c JOIN "Users" p ON p.id=c."userId"`, EXPECTED.Orders],
        [`SELECT count(*)::int n FROM "Orders" c JOIN "Addresses" p ON p.id=c."addressId"`, 1], // one NULL addressId
        [`SELECT count(*)::int n FROM "OrderItems" c JOIN "Orders" p ON p.id=c."orderId"`, EXPECTED.OrderItems],
        [`SELECT count(*)::int n FROM "OrderItems" c JOIN "Products" p ON p.id=c."productId"`, 2], // one NULL productId
        [`SELECT count(*)::int n FROM "OrderStatusEvents" c JOIN "Orders" p ON p.id=c."orderId"`, EXPECTED.OrderStatusEvents],
        [`SELECT count(*)::int n FROM "Products" c JOIN "Categories" p ON p.id=c."categoryId"`, 2] // one NULL categoryId
      ];
      for (const [sql, want] of fkChecks) {
        const { rows } = await tgt.query(sql);
        assert.equal(rows[0].n, want, `FK join count mismatch: ${sql}`);
      }
      // orphan-but-legal rows survived (no FK on CartItems/WishlistItems.productId)
      const ghost = await tgt.query(`SELECT count(*)::int n FROM "CartItems" WHERE "productId" = 101`);
      assert.equal(ghost.rows[0].n, 1, "product-less cart row preserved as-is");

      // type/value evidence: booleans, decimals, enums, json all landed
      const bools = await tgt.query(`SELECT count(*)::int n FROM "Users" WHERE "isVerified" = true`);
      assert.equal(bools.rows[0].n, 2);
      const subtotal = await tgt.query(`SELECT "subtotal"::text v FROM "Orders" WHERE id = 3`);
      assert.equal(subtotal.rows[0].v, "1999.00", "decimal precision preserved");
      const status = await tgt.query(`SELECT count(*)::int n FROM "Orders" WHERE "status" = 'shipped'`);
      assert.equal(status.rows[0].n, 1, "enum value preserved");
      const json = await tgt.query(`SELECT count(*)::int n FROM "Orders" WHERE "shippingAddress" IS NOT NULL`);
      assert.equal(json.rows[0].n, 2, "JSON documents preserved");
      const timestamps = await tgt.query(
        `SELECT count(*)::int n FROM "Users" WHERE "createdAt" <= "updatedAt"`
      );
      assert.equal(timestamps.rows[0].n, EXPECTED.Users, "timestamps preserved in order");

      // sequence state: last_value == MAX(id) for a populated table
      const seqRel = await seqNameFor(tgt, "Users");
      const seq = await tgt.query(`SELECT last_value::bigint v FROM ${seqRel}`);
      const maxUser = await tgt.query(`SELECT max(id)::bigint m FROM "Users"`);
      assert.equal(Number(seq.rows[0].v), Number(maxUser.rows[0].m), "sequence reset to MAX(id)");
    } finally {
      await src.end();
      await tgt.end();
    }
  });

  it("application models read migrated rows and write with id = MAX(id)+1", async () => {
    const res = await run("test/pgModelRw.js", [
      TARGET_DB,
      String(EXPECTED.Users),
      String(EXPECTED.Products),
      String(EXPECTED.Categories),
      String(EXPECTED.Orders)
    ]);
    assert.equal(res.code, 0, `model read/write failed:\n${res.stdout}${res.stderr}`);
    const line = res.stdout.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    const report = JSON.parse(line);
    assert.equal(report.countsOk, true, `counts: ${JSON.stringify(report)}`);
    assert.equal(report.sequenceOk, true, `sequence: ${JSON.stringify(report)}`);
    assert.equal(report.roleDefault, "customer");
    assertCredentialFree(res);
  });

  it("rerun against a previously imported target is explicitly refused; counts unchanged", async () => {
    const res = await run("scripts/migrate-data.js", [
      "--source-db", SRC_DB, "--target-db", TARGET_DB, "--confirm-local"
    ]);
    assert.equal(res.code, 1, `rerun must refuse:\n${res.stdout}${res.stderr}`);
    assert.match(res.stderr, /already contains imported rows/);
    assert.match(res.stderr, /previously imported target/);
    assertCredentialFree(res);

    const client = new Client(pgClientOptions({ ...resolvePostgresSettings(), database: TARGET_DB }));
    await client.connect();
    try {
      const { rows } = await client.query(`SELECT count(*)::int n FROM "Users"`);
      assert.equal(rows[0].n, EXPECTED.Users, "probe row from the model-write test must be gone; fixture intact");
    } finally {
      await client.end();
    }
  });

  it("the numbered migration runner still refuses hosted targets (approval contract intact)", async () => {
    const res = await run("scripts/migrate.js", ["--confirm-remote"], { PG_HOST: "10.255.255.1" });
    assertRefusedWithoutConnecting(res, /PG_REMOTE_MIGRATION_APPROVED/);
    assertCredentialFree(res);
  });
});

// helper: resolve a table's id sequence name safely
async function seqNameFor(client, table) {
  const { rows } = await client.query(
    `SELECT pg_catalog.pg_get_serial_sequence('"${table}"', 'id')::regclass::text AS seq`
  );
  return rows[0].seq;
}
