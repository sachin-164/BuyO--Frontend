// test/pgSchemaFor.js — Phase 11: builds the full schema (sequelize.sync +
// the numbered .pgsql migrations) on a GIVEN, ALREADY-EXISTING local
// PostgreSQL scratch database. Used by test/dataMigration.test.js and as the
// §5 evidence path for "fresh scratch receives numbered migrations".
//
// usage: node test/pgSchemaFor.js <dbName>     (DB_DIALECT=postgres, loopback PG_* env)
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { isLoopbackHost } = require("../config/dbConnectionOptions");

const dbName = process.argv[2];
if (!dbName) {
  console.error("usage: node test/pgSchemaFor.js <dbName>");
  process.exit(1);
}
if (String(process.env.DB_DIALECT || "").trim().toLowerCase() !== "postgres") {
  console.error("REFUSED: schema setup requires DB_DIALECT=postgres");
  process.exit(1);
}
if (!isLoopbackHost(process.env.PG_HOST)) {
  console.error("REFUSED: schema setup is loopback-only (embedded/local harness)");
  process.exit(1);
}

process.env.PG_DB = dbName; // BEFORE config/db is required (models bind it)

(async () => {
  require("../models/user");
  require("../models/category");
  require("../models/address");
  require("../models/product");
  require("../models/order"); // pulls orderItem + orderStatusEvent
  require("../models/cart");
  require("../models/wishlist");
  require("../models/productReview");
  require("../models/uploadAuthorization");
  const sequelize = require("../config/db");

  // Migration-first: exact 000 verifies on the EMPTY database, then sync must
  // be a no-op against the migration-built schema. A sync-first database has
  // later additive columns, which the exact historical 000 by design rejects.
  const { runMigrations } = require("../scripts/migrate");
  const result = await runMigrations({ quiet: true });
  const applied = result && Array.isArray(result.applied) ? result.applied.length : -1;

  await sequelize.sync(); // must not alter the migration-built schema

  await sequelize.close();
  console.log(`SCHEMA_OK ${dbName} applied_pgsql=${applied}`);
  process.exit(0);
})().catch((err) => {
  console.error("SCHEMA_FAILED:", err.message);
  process.exit(1);
});
