// test/pgModelRw.js — Phase 11: proves the (possibly data-migrated) schema
// works with the real application models — READ (counts) and WRITE (an insert
// whose id must be MAX(id)+1, proving sequences were reset correctly after
// preserving source ids), then cleans the probe row up.
//
// usage: node test/pgModelRw.js <dbName> <expUsers> <expProducts> <expCategories> <expOrders>
// Prints one JSON line (no emails, no credentials).
const path = require("path");
require("dotenv").config({ path: path.join(__dirname, "..", ".env"), quiet: true });

const { isLoopbackHost } = require("../config/dbConnectionOptions");

const [dbName, expUsers, expProducts, expCategories, expOrders] = process.argv.slice(2);
if (!dbName) {
  console.error("usage: node test/pgModelRw.js <dbName> <expUsers> <expProducts> <expCategories> <expOrders>");
  process.exit(1);
}
if (String(process.env.DB_DIALECT || "").trim().toLowerCase() !== "postgres") {
  console.error("REFUSED: requires DB_DIALECT=postgres");
  process.exit(1);
}
if (!isLoopbackHost(process.env.PG_HOST)) {
  console.error("REFUSED: loopback-only (embedded/local harness)");
  process.exit(1);
}
process.env.PG_DB = dbName;

(async () => {
  const User = require("../models/user");
  const Category = require("../models/category");
  const Product = require("../models/product");
  const Order = require("../models/order");
  require("../models/address");
  require("../models/cart");
  require("../models/wishlist");

  const users = await User.count();
  const products = await Product.count();
  const categories = await Category.count();
  const orders = await Order.count();

  const maxId = Number(await User.max("id")) || 0;
  const created = await User.create({
    name: "Phase11 RW Probe",
    email: `ph11-rw-${Date.now()}@buyotest.local`,
    password: "fixture-only"
  });
  const sequenceOk = Number(created.id) === maxId + 1;
  await created.destroy(); // hard delete (not paranoid) → counts restored

  const result = {
    countsOk:
      users === Number(expUsers) &&
      products === Number(expProducts) &&
      categories === Number(expCategories) &&
      orders === Number(expOrders),
    sequenceOk,
    users,
    products,
    categories,
    orders,
    maxIdBeforeWrite: maxId,
    createdId: Number(created.id),
    roleDefault: created.role
  };
  console.log(JSON.stringify(result));
  await require("../config/db").close();
  process.exit(result.countsOk && result.sequenceOk ? 0 : 1);
})().catch((err) => {
  console.error("MODEL_RW_FAILED:", err.message);
  process.exit(1);
});
