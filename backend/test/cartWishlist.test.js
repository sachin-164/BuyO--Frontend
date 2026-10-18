// test/cartWishlist.test.js
// Phase 5: server-authoritative cart + wishlist.
// Covers: authentication, normal operations, invalid products, stock limits,
// duplicate requests (dedup), user isolation, authoritative pricing and
// category-tax previews, and wishlist membership/toggle semantics.
//
// SAFETY: uses the shared harness (test DB only, dropped + recreated).
// Totals-sensitive tests create a fresh user per test for full isolation.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Cart & Wishlist APIs (Phase 5)", () => {
  let ctx;
  let admin;

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
  });

  after(async () => {
    await ctx.close();
  });

  const createProduct = (body) =>
    helpers.api(ctx.baseUrl, "/api/products", { method: "POST", token: admin.token, body });
  const updateProduct = (id, body) =>
    helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "PUT", token: admin.token, body });
  const deleteProduct = (id) =>
    helpers.api(ctx.baseUrl, `/api/products/${id}`, { method: "DELETE", token: admin.token });
  const createCategory = (body) =>
    helpers.api(ctx.baseUrl, "/api/categories", { method: "POST", token: admin.token, body });

  // Simple product with no category link (tax = 0) unless overridden.
  const simpleProduct = (name, overrides = {}) =>
    createProduct({ name, category: `NoCat-${name}`, mrpPrice: 500, sellingPrice: 100, ...overrides });

  const cartGet = (token) => helpers.api(ctx.baseUrl, "/api/cart", { token });
  const cartAdd = (token, body) => helpers.api(ctx.baseUrl, "/api/cart", { method: "POST", token, body });
  const cartPut = (token, id, body) => helpers.api(ctx.baseUrl, `/api/cart/${id}`, { method: "PUT", token, body });
  const cartDel = (token, id) => helpers.api(ctx.baseUrl, `/api/cart/${id}`, { method: "DELETE", token });

  const wishGet = (token) => helpers.api(ctx.baseUrl, "/api/wishlist", { token });
  const wishAdd = (token, body) => helpers.api(ctx.baseUrl, "/api/wishlist", { method: "POST", token, body });
  const wishToggle = (token, body) => helpers.api(ctx.baseUrl, "/api/wishlist/toggle", { method: "POST", token, body });
  const wishDel = (token, productId) => helpers.api(ctx.baseUrl, `/api/wishlist/${productId}`, { method: "DELETE", token });
  const wishCheck = (token, productId) => helpers.api(ctx.baseUrl, `/api/wishlist/products/${productId}`, { token });

  // ------------------------------------------------------------ authentication

  it("all cart and wishlist routes require authentication", async () => {
    assert.equal((await cartGet(undefined)).status, 401);
    assert.equal((await cartAdd(undefined, { productId: 1 })).status, 401);
    assert.equal((await cartPut(undefined, 1, { qty: 2 })).status, 401);
    assert.equal((await cartDel(undefined, 1)).status, 401);

    assert.equal((await wishGet(undefined)).status, 401);
    assert.equal((await wishAdd(undefined, { productId: 1 })).status, 401);
    assert.equal((await wishToggle(undefined, { productId: 1 })).status, 401);
    assert.equal((await wishCheck(undefined, 1)).status, 401);
    assert.equal((await wishDel(undefined, 1)).status, 401);
  });

  // --------------------------------------------------------------------- cart

  it("adding a product creates one line with authoritative totals", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Cart Basic", { stock: 5 });
    assert.equal(p.status, 201);

    const add = await cartAdd(user.token, { productId: p.json.product.id, qty: 2 });
    assert.equal(add.status, 201);
    assert.equal(add.json.count, 1);
    assert.equal(add.json.item.qty, 2);
    assert.equal(add.json.totals.subtotal, 200);
    assert.equal(add.json.totals.tax.total, 0);
    assert.equal(add.json.totals.tax.preview, true);
    assert.equal(add.json.totals.grandTotal, 200);
    assert.equal(typeof add.json.totalsNotice, "string");

    const list = await cartGet(user.token);
    assert.equal(list.status, 200);
    assert.equal(list.json.count, 1);
    assert.equal(list.json.items[0].productId, p.json.product.id);
    assert.equal(list.json.items[0].lineTotal, 200);
  });

  it("cart add validates productId and qty", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Cart Validation", { stock: 10 });

    assert.equal((await cartAdd(user.token, {})).status, 400);            // missing productId
    assert.equal((await cartAdd(user.token, { productId: p.json.product.id, qty: 0 })).status, 400);
    assert.equal((await cartAdd(user.token, { productId: p.json.product.id, qty: 2.5 })).status, 400);
    assert.equal((await cartAdd(user.token, { productId: p.json.product.id, qty: 100 })).status, 400); // > MAX_LINE_QTY
    assert.equal((await cartAdd(user.token, { productId: 999999 })).status, 400); // missing product
    assert.equal((await cartAdd(user.token, { productId: -1 })).status, 400);

    const list = await cartGet(user.token);
    assert.equal(list.json.count, 0); // nothing slipped through
  });

  it("duplicate adds increment the same line instead of duplicating rows", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Cart Dup", { stock: 10 });

    assert.equal((await cartAdd(user.token, { productId: p.json.product.id })).status, 201);
    const second = await cartAdd(user.token, { productId: p.json.product.id, qty: 2 });
    assert.equal(second.status, 201);
    assert.equal(second.json.count, 1);
    assert.equal(second.json.items[0].qty, 3);
    assert.equal(second.json.items[0].lineTotal, 300);
  });

  it("stock limits are enforced on add and on quantity update", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Cart Stock", { stock: 3 });
    const id = p.json.product.id;

    assert.equal((await cartAdd(user.token, { productId: id, qty: 2 })).status, 201);

    // Adding more than the remaining stock fails with the safe stock message
    const overAdd = await cartAdd(user.token, { productId: id, qty: 2 });
    assert.equal(overAdd.status, 400);
    assert.ok(overAdd.json.errors.some((e) => e.includes("Only 3")));

    assert.equal((await cartAdd(user.token, { productId: id, qty: 1 })).status, 201); // exactly at stock
    const cart = await cartGet(user.token);
    const itemId = cart.json.items[0].id;

    assert.equal((await cartPut(user.token, itemId, { qty: 4 })).status, 400);        // above stock
    const ok = await cartPut(user.token, itemId, { qty: 3 });
    assert.equal(ok.status, 200);
    assert.equal(ok.json.items[0].qty, 3);
    assert.equal(ok.json.items[0].stockExceeded, false);

    const outOfStock = await simpleProduct("Cart OutOfStock", { stock: 0 });
    const oos = await cartAdd(user.token, { productId: outOfStock.json.product.id });
    assert.equal(oos.status, 400);
    assert.ok(oos.json.errors.some((e) => e.includes("out of stock")));
  });

  it("cart lines are isolated per user: others get 404, never data", async () => {
    const owner = await helpers.createVerifiedUser(ctx.baseUrl);
    const other = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Cart Isolation", { stock: 5 });

    const add = await cartAdd(owner.token, { productId: p.json.product.id });
    const ownerId = add.json.item.id;

    // The other user sees an empty cart and cannot update/remove foreign lines
    assert.equal((await cartGet(other.token)).json.count, 0);
    assert.equal((await cartPut(other.token, ownerId, { qty: 5 })).status, 404);
    assert.equal((await cartDel(other.token, ownerId)).status, 404);

    // Owner can update and remove
    assert.equal((await cartPut(owner.token, ownerId, { qty: 4 })).status, 200);
    const removed = await cartDel(owner.token, ownerId);
    assert.equal(removed.status, 200);
    assert.equal(removed.json.count, 0);

    // Repeat removal and malformed ids
    assert.equal((await cartDel(owner.token, ownerId)).status, 404);
    assert.equal((await cartPut(owner.token, "abc", { qty: 2 })).status, 400);
    assert.equal((await cartPut(owner.token, 999999, { qty: 2 })).status, 404);
    assert.equal((await cartPut(owner.token, ownerId, {})).status, 400); // qty required
  });

  it("totals follow the database: price changes and product deletion are reflected", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Cart Authoritative", { stock: 10, sellingPrice: 100 });

    await cartAdd(user.token, { productId: p.json.product.id, qty: 2 });
    assert.equal((await cartGet(user.token)).json.totals.subtotal, 200);

    // Admin repricing is picked up immediately (server-authoritative)
    assert.equal((await updateProduct(p.json.product.id, { sellingPrice: 150 })).status, 200);
    const repriced = await cartGet(user.token);
    assert.equal(repriced.json.items[0].price, 150);
    assert.equal(repriced.json.totals.subtotal, 300);

    // Deleting the product leaves the line visible but excluded from totals
    assert.equal((await deleteProduct(p.json.product.id)).status, 200);
    const orphaned = await cartGet(user.token);
    assert.equal(orphaned.json.items[0].unavailable, true);
    assert.equal(orphaned.json.items[0].price, null);
    assert.equal(orphaned.json.items[0].lineTotal, 0);
    assert.equal(orphaned.json.totals.subtotal, 0);
    assert.equal(orphaned.json.totals.grandTotal, 0);
  });

  it("category tax preview applies the configured taxRate per category", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const cat = await createCategory({ name: "GST Probe", slug: "gst-probe", taxRate: 18 });
    assert.equal(cat.status, 201);
    const p = await createProduct({
      name: "Cart Taxed",
      category: "GST Probe",
      categoryId: cat.json.category.id,
      mrpPrice: 500,
      sellingPrice: 100,
      stock: 10
    });

    const add = await cartAdd(user.token, { productId: p.json.product.id, qty: 2 });
    assert.equal(add.status, 201);
    const totals = add.json.totals;
    assert.equal(totals.subtotal, 200);
    assert.equal(totals.tax.total, 36); // 18% of 200
    assert.equal(totals.grandTotal, 236);
    assert.equal(totals.tax.preview, true);

    const group = totals.tax.byCategory.find((g) => g.categoryId === cat.json.category.id);
    assert.ok(group);
    assert.equal(group.categoryName, "GST Probe");
    assert.equal(group.taxRate, 18);
    assert.equal(group.taxableAmount, 200);
    assert.equal(group.taxAmount, 36);
  });

  it("tax preview handles mixed categories, untaxed lines and rounding", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const cat = await createCategory({ name: "Mixed Probe", slug: "mixed-probe", taxRate: 12.5 });

    const a = await createProduct({ name: "Mixed A", category: "Mixed Probe", categoryId: cat.json.category.id, mrpPrice: 90, sellingPrice: 50, stock: 5 });
    const b = await createProduct({ name: "Mixed B", category: "Mixed Probe", categoryId: cat.json.category.id, mrpPrice: 90, sellingPrice: 50, stock: 5 });
    const c = await simpleProduct("Mixed C", { mrpPrice: 90, sellingPrice: 30, stock: 5 });
    const r = await createCategory({ name: "Round Probe", slug: "round-probe", taxRate: 7.5 });
    const d = await createProduct({ name: "Mixed D", category: "Round Probe", categoryId: r.json.category.id, mrpPrice: 99.99, sellingPrice: 33.33, stock: 5 });

    await cartAdd(user.token, { productId: a.json.product.id });
    await cartAdd(user.token, { productId: b.json.product.id });
    await cartAdd(user.token, { productId: c.json.product.id });
    await cartAdd(user.token, { productId: d.json.product.id });

    const cartRes = await cartGet(user.token);
    const totals = cartRes.json.totals;
    assert.equal(totals.subtotal, 163.33); // 50 + 50 + 30 + 33.33
    assert.equal(totals.tax.total, 15);    // 12.5% of 100 = 12.50, 7.5% of 33.33 = 2.50 (rounded), untaxed 0

    const mixed = totals.tax.byCategory.find((g) => g.categoryId === cat.json.category.id);
    assert.equal(mixed.taxableAmount, 100);
    assert.equal(mixed.taxAmount, 12.5);

    const untaxed = totals.tax.byCategory.find((g) => g.categoryId === null);
    assert.equal(untaxed.taxRate, 0);
    assert.equal(untaxed.taxAmount, 0);

    const rounded = totals.tax.byCategory.find((g) => g.categoryId === r.json.category.id);
    assert.equal(rounded.taxAmount, 2.5); // 2.49975 rounds to 2.50
    assert.equal(totals.grandTotal, 178.33);
  });

  // ----------------------------------------------------------------- wishlist

  it("wishlist add is idempotent and supports membership checks", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Wish Basic", { stock: 4 });

    const first = await wishAdd(user.token, { productId: p.json.product.id });
    assert.equal(first.status, 201);
    assert.equal(first.json.inWishlist, true);

    // Duplicate request: no second row, plain 200
    const second = await wishAdd(user.token, { productId: p.json.product.id });
    assert.equal(second.status, 200);
    assert.equal(second.json.message, "Already in wishlist");

    const list = await wishGet(user.token);
    assert.equal(list.json.count, 1);

    const yes = await wishCheck(user.token, p.json.product.id);
    assert.equal(yes.json.inWishlist, true);
    const no = await wishCheck(user.token, p.json.product.id + 1000);
    assert.equal(no.json.inWishlist, false);
  });

  it("wishlist validates productId everywhere", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);

    assert.equal((await wishAdd(user.token, {})).status, 400);
    assert.equal((await wishAdd(user.token, { productId: 999999 })).status, 400);
    assert.equal((await wishToggle(user.token, { productId: 999999 })).status, 400);
    assert.equal((await wishDel(user.token, "abc")).status, 400);
    assert.equal((await wishCheck(user.token, "-5")).status, 400);
  });

  it("wishlist toggle adds then removes, with accurate counts", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Wish Toggle", { stock: 2 });

    const on = await wishToggle(user.token, { productId: p.json.product.id });
    assert.equal(on.status, 200);
    assert.equal(on.json.inWishlist, true);
    assert.equal(on.json.count, 1);

    const off = await wishToggle(user.token, { productId: p.json.product.id });
    assert.equal(off.status, 200);
    assert.equal(off.json.inWishlist, false);
    assert.equal(off.json.count, 0);
  });

  it("wishlist lines are isolated per user and removable by product id", async () => {
    const owner = await helpers.createVerifiedUser(ctx.baseUrl);
    const other = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Wish Isolation", { stock: 3 });

    await wishAdd(owner.token, { productId: p.json.product.id });
    assert.equal((await wishGet(other.token)).json.count, 0);
    assert.equal((await wishCheck(other.token, p.json.product.id)).json.inWishlist, false);

    // Other users cannot remove foreign wishlist lines
    assert.equal((await wishDel(other.token, p.json.product.id)).status, 404);

    // Owner removes; repeat removal 404s
    assert.equal((await wishDel(owner.token, p.json.product.id)).status, 200);
    assert.equal((await wishDel(owner.token, p.json.product.id)).status, 404);
  });

  it("wishlist shows live product data (price updates, deleted products flagged)", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const p = await simpleProduct("Wish Live", { stock: 1, sellingPrice: 100 });

    await wishAdd(user.token, { productId: p.json.product.id });
    let list = await wishGet(user.token);
    assert.equal(list.json.items[0].price, 100);
    assert.equal(list.json.items[0].inStock, true);

    await updateProduct(p.json.product.id, { sellingPrice: 120 });
    list = await wishGet(user.token);
    assert.equal(list.json.items[0].price, 120);

    await deleteProduct(p.json.product.id);
    list = await wishGet(user.token);
    assert.equal(list.json.items[0].unavailable, true);
    assert.equal(list.json.items[0].price, null);
  });
});
