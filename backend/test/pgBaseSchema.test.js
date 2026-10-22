// test/pgBaseSchema.test.js
// The EMPTY-database bootstrap path for PostgreSQL, end to end:
//
//   1. A brand-new database initialized by the numbered .pgsql migrations
//      ALONE (000_pg_base_schema + 005/006/007, NO sequelize.sync) — the
//      in-file verify directives must pass and all four files must be
//      recorded, with all nine tables and five enum types physically present.
//   2. That migration-built schema must be catalog-IDENTICAL to a sync-built
//      twin (columns incl. types/defaults/nullability, constraint definitions,
//      index definitions, enum labels, sequences). Column ORDINALS are
//      intentionally excluded: additive ALTERs append columns on an upgraded
//      database while a fresh sync declares them in model order — the physical
//      order is not part of the contract.
//   3. The real application must RUN against the migration-built schema:
//      signup → verify → login → /auth/me, admin catalog writes (Categories,
//      Products), cart double-add collapsing to one line (005), wishlist
//      composite uniqueness (006), case-insensitive email uniqueness enforced
//      at the DATABASE level (007), direct order/item/status writes (enums,
//      JSON columns, FKs, serial id defaults) and enum-value rejection.
//   4. Reruns are no-ops (000 recorded exactly once), and the sync-built
//      twin reports the same four applied files (000 must no-op there).
//
// Exercised ONLY against scratch databases on the embedded loopback
// cluster (pgSuite harness). Real buyoDB and Supabase are never touched.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const path = require("path");

const helpers = require("./helpers");
const { runMigrations } = require("../scripts/migrate");
const { resolvePostgresSettings } = require("../config/dbConnectionOptions");

const execFileAsync = promisify(execFile);
const BACKEND_DIR = path.join(__dirname, "..");
const TWIN_DB = "buyoDB_ph2_sync_twin";

const EXPECTED_MIGRATIONS = [
  "000_pg_base_schema.pgsql",
  "005_pg_cart_items_user_product_unique.pgsql",
  "006_pg_wishlist_items_user_product_unique.pgsql",
  "007_pg_ci_unique_email_and_category.pgsql",
  "008_create_product_images.pgsql",
  "009_categories_parent.pgsql",
  "010_product_variants.pgsql",
  "011_product_reviews.pgsql"
];

const APP_TABLES = [
  "Addresses", "CartItems", "Categories", "OrderItems", "OrderStatusEvents",
  "Orders", "ProductImages", "ProductReviews", "Products", "ProductVariants",
  "Users", "WishlistItems"
];

const APP_ENUMS = [
  "enum_OrderStatusEvents_fromStatus",
  "enum_OrderStatusEvents_toStatus",
  "enum_Orders_paymentMethod",
  "enum_Orders_status",
  "enum_ProductReviews_status",
  "enum_Users_role"
];

// Full physical-schema capture. schema_migrations is EXCLUDED everywhere: its
// rows legitimately differ (appliedAt/executionMs timestamps) and it is
// runner-owned, not application schema.
const CATALOG_SQL = {
  columns: `
    SELECT c.table_name, c.column_name, c.data_type, c.udt_name,
           c.character_maximum_length, c.numeric_precision, c.numeric_scale,
           c.datetime_precision, c.is_nullable, c.column_default
    FROM information_schema.columns c
    WHERE c.table_schema = 'public' AND c.table_name <> 'schema_migrations'
    ORDER BY c.table_name, c.column_name`,
  constraints: `
    SELECT con.conname, con.conrelid::regclass::text AS tbl, con.contype,
           pg_get_constraintdef(con.oid) AS def
    FROM pg_constraint con
    JOIN pg_namespace n ON n.oid = con.connamespace
    WHERE n.nspname = 'public'
      AND con.conrelid IN (SELECT oid FROM pg_class WHERE relname <> 'schema_migrations')
    ORDER BY tbl, con.conname`,
  indexes: `
    SELECT tablename, indexname, indexdef FROM pg_indexes
    WHERE schemaname = 'public' AND tablename <> 'schema_migrations'
    ORDER BY tablename, indexname`,
  enums: `
    SELECT t.typname, e.enumlabel, e.enumsortorder
    FROM pg_type t
    JOIN pg_enum e ON e.enumtypid = t.oid
    JOIN pg_namespace n ON n.oid = t.typnamespace
    WHERE n.nspname = 'public'
    ORDER BY t.typname, e.enumsortorder`,
  sequences: `
    SELECT sequencename, data_type, start_value FROM pg_sequences
    WHERE schemaname = 'public' ORDER BY sequencename`
};

async function pgAdmin(database, fn) {
  const s = resolvePostgresSettings();
  const { Client } = require("pg");
  const client = new Client({ host: s.host, port: s.port, user: s.username, password: s.password, database });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end().catch(() => {});
  }
}

async function dropCreateDb(name) {
  await pgAdmin("postgres", async (c) => {
    await c.query(`DROP DATABASE IF EXISTS "${name}"`);
    await c.query(`CREATE DATABASE "${name}"`);
  });
}

async function snapshot(database) {
  const out = {};
  await pgAdmin(database, async (c) => {
    for (const [key, sql] of Object.entries(CATALOG_SQL)) out[key] = (await c.query(sql)).rows;
  });
  return out;
}

// Returns a readable failure string for the first mismatching row, else "".
function firstMismatch(a, b) {
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) {
    if (JSON.stringify(a[i]) !== JSON.stringify(b[i])) {
      return `first mismatch #${i}\n    migration-built: ${JSON.stringify(a[i])}\n    sync-built:      ${JSON.stringify(b[i])}`;
    }
  }
  return "";
}

describe("Base schema bootstrap: empty database via migrations alone (000)", () => {
  let ctx; // { baseUrl, sequelize, close } — boot WITHOUT sequelize.sync
  let server;
  let emptyResult;
  let twinStdout = "";

  before(async () => {
    // 1. Fresh EMPTY scratch database — no sync has ever touched it.
    await dropCreateDb(helpers.TEST_DB_NAME);
    emptyResult = await runMigrations({ quiet: true });

    // 2. Sync-built twin via the existing child helper (sequelize.sync +
    //    the same numbered .pgsql files) for the catalog-identity proof.
    await dropCreateDb(TWIN_DB);
    const { stdout } = await execFileAsync(
      process.execPath,
      [path.join(BACKEND_DIR, "test", "pgSchemaFor.js"), TWIN_DB],
      {
        cwd: BACKEND_DIR,
        env: { ...process.env, DB_DIALECT: "postgres", PG_DB: TWIN_DB },
        timeout: 120000
      }
    );
    twinStdout = stdout;

    // 3. Boot the REAL application against the migration-built schema.
    //    Same shape as helpers.startTestApp, minus the sequelize.sync call.
    const { createApp } = require("../app");
    const sequelize = require("../config/db");
    require("../models/user");
    require("../models/product");
    require("../models/cart");
    require("../models/wishlist");
    require("../models/address");
    require("../models/order"); // pulls in orderItem + orderStatusEvent
    require("../models/productReview");

    const app = createApp();
    server = app.listen(0);
    await new Promise((resolve) => server.once("listening", resolve));

    ctx = {
      baseUrl: `http://127.0.0.1:${server.address().port}`,
      sequelize,
      close: async () => {
        await new Promise((resolve) => {
          server.closeIdleConnections?.();
          server.close(() => resolve());
        });
        await sequelize.close();
      }
    };
  });

  after(async () => {
    if (ctx) await ctx.close().catch(() => {});
    await pgAdmin("postgres", (c) => c.query(`DROP DATABASE IF EXISTS "${TWIN_DB}"`)).catch(() => {});
  });

  const query = async (sql) => {
    const [rows] = await ctx.sequelize.query(sql);
    return rows;
  };

  // ------------------------------------------------------------------ tests

  it("migrations alone initialize an empty database (000, 005–011)", async () => {
    assert.deepEqual(emptyResult.applied, EXPECTED_MIGRATIONS, "all eight files must apply in order on an empty DB");

    const bookkeeping = (await query(`SELECT id FROM "schema_migrations" ORDER BY id`)).map((r) => r.id);
    assert.deepEqual(bookkeeping, [...EXPECTED_MIGRATIONS].sort(), "bookkeeping must record exactly the eight files");

    // External proof (independent of the in-file verify directives): every
    // application table and enum type physically exists.
    const tables = (
      await query(
        `SELECT c.relname FROM pg_class c
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE n.nspname = current_schema() AND c.relkind = 'r'`
      )
    ).map((r) => r.relname).sort();
    assert.deepEqual(tables, [...APP_TABLES, "schema_migrations"].sort(), "exactly the twelve app tables + bookkeeping");

    const enums = (
      await query(
        `SELECT t.typname FROM pg_type t
         JOIN pg_namespace n ON n.oid = t.typnamespace
         WHERE n.nspname = current_schema() AND t.typtype = 'e'`
      )
    ).map((r) => r.typname).sort();
    assert.deepEqual(enums, [...APP_ENUMS].sort(), "exactly the six enum types");
  });

  it("migration-built schema is catalog-identical to a sync-built twin", async () => {
    const built = await snapshot(helpers.TEST_DB_NAME);
    const sync = await snapshot(TWIN_DB);
    for (const key of Object.keys(CATALOG_SQL)) {
      const a = JSON.stringify(built[key], null, 1);
      const b = JSON.stringify(sync[key], null, 1);
      if (a !== b) {
        assert.fail(
          `catalog differs in ${key} (${built[key].length} rows vs ${sync[key].length} rows)\n  ${firstMismatch(built[key], sync[key])}`
        );
      }
    }
  });

  it("application runs on the migration-built schema (auth, catalog, cart, wishlist, orders)", async () => {
    // ---- signup → verify → login → /auth/me (Users + 007 email index) ----
    const buyer = await helpers.createVerifiedUser(ctx.baseUrl);
    assert.ok(buyer.token, "login must return a token");
    const me = await helpers.api(ctx.baseUrl, "/api/auth/me", { token: buyer.token });
    assert.equal(me.status, 200, me.text);
    assert.equal(me.json.user.email, buyer.email);

    // ---- admin catalog writes (Categories + Products, incl. FK column) ----
    const admin = await helpers.createAdminUser(ctx.baseUrl);
    const category = await helpers.api(ctx.baseUrl, "/api/categories", {
      method: "POST",
      token: admin.token,
      body: { name: "Base Schema Cat", slug: "base-schema-cat", taxRate: 0.18 }
    });
    assert.equal(category.status, 201, category.text);
    const product = await helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: "Base Schema Lamp",
        category: "Base Schema Cat",
        mrpPrice: 500,
        sellingPrice: 100,
        stock: 5
      }
    });
    assert.equal(product.status, 201, product.text);
    const productId = Number(product.json.product.id);
    assert.ok(productId > 0, "serial id default must produce a real id");

    // ---- product gallery (008): rows, ordering, first-is-primary sync ----
    const galleryOne = await helpers.api(ctx.baseUrl, `/api/products/${productId}/images`, {
      method: "POST",
      token: admin.token,
      body: { url: "https://cdn.example.test/base/one.png", alt: "Base one" }
    });
    assert.equal(galleryOne.status, 201, galleryOne.text);
    const galleryTwo = await helpers.api(ctx.baseUrl, `/api/products/${productId}/images`, {
      method: "POST",
      token: admin.token,
      body: { url: "https://cdn.example.test/base/two.png" }
    });
    assert.equal(galleryTwo.status, 201, galleryTwo.text);
    assert.deepEqual(
      galleryTwo.json.product.images.map((image) => image.position),
      [0, 1]
    );
    assert.equal(galleryTwo.json.product.image, "https://cdn.example.test/base/one.png");
    // ON DELETE CASCADE is a database rule, not an application rule.
    const galleryRows = await query(`SELECT COUNT(*)::int AS c FROM "ProductImages" WHERE "productId" = ${productId}`);
    assert.equal(galleryRows[0].c, 2);

    // ---- cart double-add collapses to ONE line (005 composite unique) ----
    for (let i = 0; i < 2; i++) {
      const add = await helpers.api(ctx.baseUrl, "/api/cart", {
        method: "POST",
        token: buyer.token,
        body: { productId, qty: 1 }
      });
      assert.equal(add.status, 201, add.text);
    }
    const buyerId = Number((await query(`SELECT id FROM "Users" WHERE email = '${buyer.email}'`))[0].id);
    const cartLines = await query(
      `SELECT qty FROM "CartItems" WHERE "UserId" = ${buyerId} AND "productId" = ${productId}`
    );
    assert.equal(cartLines.length, 1, "composite unique index must coexist with the app's dedup");
    assert.equal(Number(cartLines[0].qty), 2);

    // ---- wishlist composite uniqueness at the DATABASE level (006) ----
    const WishlistItem = require("../models/wishlist");
    await WishlistItem.create({ UserId: buyerId, productId: 777, name: "Base Wish", price: 10 });
    let wishErr = null;
    try {
      await WishlistItem.create({ UserId: buyerId, productId: 777, name: "Base Wish Dup", price: 10 });
    } catch (err) {
      wishErr = err;
    }
    assert.ok(wishErr, "duplicate wishlist row must be rejected");
    assert.match(
      [wishErr.message, wishErr.original && wishErr.original.message].filter(Boolean).join(" | "),
      /uq_wishlistitems_user_product/
    );

    // ---- variant SKU uniqueness at the DATABASE level (010) ----
    const ProductVariant = require("../models/productVariant");
    const reviewVariantSku = `PG-SCHEMA-${productId}`;
    await ProductVariant.create({
      productId,
      sku: reviewVariantSku,
      size: "M",
      stock: 2,
      priceAdjustment: 0
    });
    let skuErr = null;
    try {
      await ProductVariant.create({
        productId,
        sku: reviewVariantSku,
        size: "L",
        stock: 1,
        priceAdjustment: 0
      });
    } catch (err) {
      skuErr = err;
    }
    assert.ok(skuErr, "duplicate variant SKU must be rejected by the database");
    assert.match(
      [skuErr.message, skuErr.original && skuErr.original.message].filter(Boolean).join(" | "),
      /ProductVariants_sku_key/
    );

    // ---- one review per customer/product + pending default (011) ----
    const ProductReview = require("../models/productReview");
    const ReviewUser = require("../models/user");
    const reviewAuthor = await ReviewUser.create({
      name: "PG Schema Reviewer",
      email: `pg.reviewer.${productId}@buyotest.local`,
      password: "fixture-only",
      isVerified: true
    });
    await ProductReview.create({
      productId,
      userId: reviewAuthor.id,
      rating: 5,
      body: "PostgreSQL review body long enough"
    });
    const storedReview = await query(
      `SELECT status FROM "ProductReviews" WHERE "productId" = ${productId} AND "userId" = ${reviewAuthor.id}`
    );
    assert.equal(storedReview[0].status, "pending", "new reviews default to pending in the DB");
    let reviewErr = null;
    try {
      await ProductReview.create({
        productId,
        userId: reviewAuthor.id,
        rating: 4,
        body: "A second review must be rejected"
      });
    } catch (err) {
      reviewErr = err;
    }
    assert.ok(reviewErr, "one review per customer/product must be enforced by the database");
    assert.match(
      [reviewErr.message, reviewErr.original && reviewErr.original.message].filter(Boolean).join(" | "),
      /uq_product_reviews_user_product/
    );

    // ---- case-insensitive duplicate email rejected by the DATABASE (007) ----
    const User = require("../models/user");
    let dupErr = null;
    try {
      await User.create({ name: "CI Dup", email: buyer.email.toUpperCase(), password: "fixture-only" });
    } catch (err) {
      dupErr = err;
    }
    assert.ok(dupErr, "case-differing duplicate email must be rejected");
    assert.match(
      [dupErr.message, dupErr.original && dupErr.original.message].filter(Boolean).join(" | "),
      /uq_users_email_lower/
    );

    // ---- direct order writes: serial default, enums, JSON, FKs ----
    const [orderRows] = await ctx.sequelize.query(
      `INSERT INTO "Orders"
         ("orderNumber", "idempotencyKey", "status", "paymentMethod", "subtotal", "taxTotal",
          "grandTotal", "taxBreakdown", "shippingAddress", "userId", "createdAt", "updatedAt")
       VALUES
         ('BASE-SCHEMA-1', 'base-idem-1', 'placed', 'cod', 100.00, 18.00, 118.00,
          '{"total":18}'::json, '{"fullName":"Base Buyer","city":"Bengaluru"}'::json,
          ${buyerId}, NOW(), NOW())
       RETURNING "id"`
    );
    const orderId = Number(orderRows[0].id);
    assert.ok(orderId > 0, "Orders.id must default from its sequence");

    await ctx.sequelize.query(
      `INSERT INTO "OrderItems"
         ("productId", "name", "unitPrice", "qty", "lineTotal", "taxRate", "taxAmount",
          "categoryName", "orderId", "createdAt", "updatedAt")
       VALUES
         (${productId}, 'Base Schema Lamp', 100.00, 1, 100.00, 18.00, 18.00,
          'Base Schema Cat', ${orderId}, NOW(), NOW())`
    );
    await ctx.sequelize.query(
      `INSERT INTO "OrderStatusEvents"
         ("fromStatus", "toStatus", "note", "orderId", "createdAt", "updatedAt")
       VALUES
         (NULL, 'placed', 'created on migration-built schema', ${orderId}, NOW(), NOW())`
    );

    // JSON columns must come back parsed, enum value must be stored as-is.
    const [orderCheck] = await ctx.sequelize.query(
      `SELECT status, "taxBreakdown", "shippingAddress" FROM "Orders" WHERE "id" = ${orderId}`
    );
    assert.equal(orderCheck[0].status, "placed");
    assert.equal(orderCheck[0].taxBreakdown.total, 18, "taxBreakdown JSON must round-trip as an object");
    assert.equal(orderCheck[0].shippingAddress.city, "Bengaluru");

    // The status column is a REAL enum — an unknown label must be rejected.
    let enumErr = null;
    try {
      await ctx.sequelize.query(
        `INSERT INTO "Orders"
           ("orderNumber", "idempotencyKey", "status", "paymentMethod", "subtotal",
            "grandTotal", "shippingAddress", "userId", "createdAt", "updatedAt")
         VALUES
           ('BASE-SCHEMA-2', 'base-idem-2', 'bogus-status', 'cod', 1, 1,
            '{}'::json, ${buyerId}, NOW(), NOW())`
      );
    } catch (err) {
      enumErr = err;
    }
    assert.ok(enumErr, "enum column must reject an unknown label");
    assert.match(enumErr.message, /enum_Orders_status|invalid input value for enum/);
  });

  it("rerun is a no-op and the sync-built twin applied the same files", async () => {
    const again = await runMigrations({ quiet: true });
    assert.deepEqual(again.applied, []);
    assert.equal(again.upToDate, true);

    const bookkeeping = (await query(`SELECT id FROM "schema_migrations" ORDER BY id`)).map((r) => r.id);
    assert.deepEqual(bookkeeping, [...EXPECTED_MIGRATIONS].sort(), "000 must be recorded exactly once");

    // The twin child ran sync FIRST, then the same migrations — 000 and every
    // additive migration must no-op there, and all eight files are recorded.
    assert.match(twinStdout, new RegExp(`SCHEMA_OK ${TWIN_DB}`));
    assert.match(twinStdout, /applied_pgsql=8/);
  });
});
