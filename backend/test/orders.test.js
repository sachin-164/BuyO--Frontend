// test/orders.test.js
// Phase 6: per-user addresses, server-authoritative COD checkout (transactional,
// idempotent, race-safe), owner-restricted customer order history and admin
// order management (validated transitions, exactly-once restock, fail-closed
// admin authorization).
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test), dropped and
// recreated per run. Concurrency tests use Promise.all against one app instance;
// MySQL row locks serialize the transactions, so every race has a deterministic
// invariant to assert (exactly one winner, full rollback for the loser, etc.).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");
const { resolveMysqlSettings } = require("../config/dbConnectionOptions");
const { applyRoleChange } = require("../scripts/admin-role");

describe("Orders & addresses (Phase 6)", () => {
  let ctx;
  let admin;
  let user;
  let otherUser;
  let seedCounter = 0;

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    user = await helpers.createVerifiedUser(ctx.baseUrl);
    otherUser = await helpers.createVerifiedUser(ctx.baseUrl);
  });

  after(async () => {
    await ctx.close();
  });

  // ---------------- API shorthands ----------------
  const api = (path, options) => helpers.api(ctx.baseUrl, path, options);
  const createCategory = (body) => api("/api/categories", { method: "POST", token: admin.token, body });
  const createProduct = (body) => api("/api/products", { method: "POST", token: admin.token, body });
  const updateProduct = (id, body) => api(`/api/products/${id}`, { method: "PUT", token: admin.token, body });
  const deleteProduct = (id) => api(`/api/products/${id}`, { method: "DELETE", token: admin.token });
  const getProduct = (id) => api(`/api/products/${id}`);
  const cartAdd = (token, body) => api("/api/cart", { method: "POST", token, body });
  const cartGet = (token) => api("/api/cart", { token });
  const checkout = (token, body) => api("/api/orders", { method: "POST", token, body });
  const listOrders = (token, qs = "") => api(`/api/orders${qs}`, { token });
  const getOrder = (token, id) => api(`/api/orders/${id}`, { token });
  const addAddress = (token, body) => api("/api/addresses", { method: "POST", token, body });
  const listAddresses = (token) => api("/api/addresses", { token });
  const adminListOrders = (qs = "") => api(`/api/admin/orders${qs}`, { token: admin.token });
  const adminGetOrder = (id) => api(`/api/admin/orders/${id}`, { token: admin.token });
  const adminSetStatus = (id, body) => api(`/api/admin/orders/${id}/status`, { method: "PUT", token: admin.token, body });

  const addressBody = (overrides = {}) => ({
    fullName: "Test Buyer",
    phone: "9876543210",
    line1: "12 Test Street",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400001",
    ...overrides
  });

  const nextTag = () => `p6-${Date.now()}-${(seedCounter += 1)}`;
  const idemKey = (label) => `key-${label}-${Date.now()}-${(seedCounter += 1)}`.toLowerCase();
  const approx = (actual, expected, message) =>
    assert.ok(Math.abs(actual - expected) < 1e-9, `${message || "approx"}: ${actual} != ${expected}`);

  async function clearCart(token) {
    const cart = await cartGet(token);
    for (const item of cart.json.items) {
      const res = await api(`/api/cart/${item.id}`, { method: "DELETE", token });
      assert.equal(res.status, 200, res.text);
    }
  }

  // Creates a fresh category (configured taxRate) + product.
  async function seedProduct({ price = 100, stock = 10, taxRate = 18, tag = nextTag() } = {}) {
    const category = await createCategory({ name: `Cat ${tag}`, taxRate });
    assert.equal(category.status, 201, category.text);
    const product = await createProduct({
      name: `Product ${tag}`,
      category: `Cat ${tag}`,
      mrpPrice: Math.max(price, price * 2),
      sellingPrice: price,
      stock,
      categoryId: category.json.category.id
    });
    assert.equal(product.status, 201, product.text);
    return {
      categoryId: category.json.category.id,
      categoryName: category.json.category.name,
      productId: product.json.product.id
    };
  }

  // Known-state checkout setup: empty cart -> one product line + an address.
  async function seedCheckout({ owner = user, qty = 2, ...rest } = {}) {
    await clearCart(owner.token);
    const seeded = await seedProduct(rest);
    const address = await addAddress(owner.token, addressBody());
    assert.equal(address.status, 201, address.text);
    const added = await cartAdd(owner.token, { productId: seeded.productId, qty });
    assert.equal(added.status, 201, added.text);
    return { ...seeded, addressId: address.json.address.id };
  }

  // ================= addresses =================

  it("address validation rejects bad pincode/phone and missing fields", async () => {
    const badPin = await addAddress(user.token, addressBody({ pincode: "012345" }));
    assert.equal(badPin.status, 400);
    assert.ok(badPin.json.errors.some((e) => /pincode/.test(e)), badPin.text);

    const badPhone = await addAddress(user.token, addressBody({ phone: "12345" }));
    assert.equal(badPhone.status, 400);
    assert.ok(badPhone.json.errors.some((e) => /phone/.test(e)), badPhone.text);

    const missing = await addAddress(user.token, addressBody({ fullName: undefined }));
    assert.equal(missing.status, 400);
    assert.ok(missing.json.errors.some((e) => /fullName/.test(e)), missing.text);

    assert.equal((await api("/api/addresses")).status, 401);
  });

  it("first address becomes default; lists are strictly user-scoped", async () => {
    const a = await addAddress(user.token, addressBody({ line1: "1 Alpha Road" }));
    assert.equal(a.status, 201, a.text);
    assert.equal(a.json.address.isDefault, true, "the first address must be the default");

    const b = await addAddress(user.token, addressBody({ line1: "2 Beta Lane", isDefault: false }));
    assert.equal(b.status, 201, b.text);
    assert.equal(b.json.address.isDefault, false);

    const mine = await listAddresses(user.token);
    assert.equal(mine.json.count, 2);
    assert.deepEqual(mine.json.addresses.filter((x) => x.isDefault).map((x) => x.id), [a.json.address.id]);

    assert.equal((await listAddresses(otherUser.token)).json.count, 0);
  });

  it("foreign addresses cannot be modified (404), owner updates work", async () => {
    const mine = await listAddresses(user.token);
    const foreignId = mine.json.addresses[0].id;

    assert.equal((await api(`/api/addresses/${foreignId}`, { method: "PUT", token: otherUser.token, body: { line1: "Hijack Street" } })).status, 404);
    assert.equal((await api(`/api/addresses/${foreignId}`, { method: "DELETE", token: otherUser.token })).status, 404);
    assert.equal((await api(`/api/addresses/${foreignId}/default`, { method: "PUT", token: otherUser.token })).status, 404);

    const ok = await api(`/api/addresses/${foreignId}`, { method: "PUT", token: user.token, body: { line1: "1 Alpha Road East" } });
    assert.equal(ok.status, 200, ok.text);
    assert.equal(ok.json.address.line1, "1 Alpha Road East");
  });

  it("default management: switch, refuse un-defaulting the default, promote on delete", async () => {
    const list = await listAddresses(user.token);
    const [first, second] = list.json.addresses; // isDefault DESC, id ASC

    const promoted = await api(`/api/addresses/${second.id}/default`, { method: "PUT", token: user.token });
    assert.equal(promoted.status, 200, promoted.text);
    assert.equal(promoted.json.address.isDefault, true);
    const after = await listAddresses(user.token);
    assert.deepEqual(after.json.addresses.filter((x) => x.isDefault).map((x) => x.id), [second.id]);

    const unset = await api(`/api/addresses/${second.id}`, { method: "PUT", token: user.token, body: { isDefault: false } });
    assert.equal(unset.status, 400, "the current default cannot be un-defaulted directly");

    const created = await addAddress(user.token, addressBody({ line1: "3 Gamma Way", isDefault: true }));
    assert.equal(created.status, 201, created.text);
    assert.equal(created.json.address.isDefault, true, "explicit isDefault: true demotes the rest");

    const del = await api(`/api/addresses/${created.json.address.id}`, { method: "DELETE", token: user.token });
    assert.equal(del.status, 200, del.text);
    const finalList = await listAddresses(user.token);
    assert.deepEqual(finalList.json.addresses.filter((x) => x.isDefault).map((x) => x.id), [first.id],
      "deleting the default promotes the next-oldest address");
  });

  // ================= checkout: validation + recalculation =================

  it("checkout validates address/idempotency key and rejects an empty cart", async () => {
    const seeded = await seedCheckout({ qty: 1 });

    assert.equal((await checkout(user.token, { idempotencyKey: idemKey("m1") })).status, 400, "addressId required");

    const otherAddress = await addAddress(otherUser.token, addressBody());
    assert.equal(otherAddress.status, 201, otherAddress.text);
    assert.equal((await checkout(user.token, { addressId: otherAddress.json.address.id, idempotencyKey: idemKey("m2") })).status, 404, "foreign address");

    assert.equal((await checkout(user.token, { addressId: seeded.addressId })).status, 400, "idempotencyKey required");
    assert.equal((await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: "short" })).status, 400, "key too short");
    assert.equal((await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: "bad key!" })).status, 400, "bad key charset");

    const emptyUser = await helpers.createVerifiedUser(ctx.baseUrl);
    const emptyAddress = await addAddress(emptyUser.token, addressBody());
    const empty = await checkout(emptyUser.token, { addressId: emptyAddress.json.address.id, idempotencyKey: idemKey("m3") });
    assert.equal(empty.status, 400);
    assert.ok(empty.json.errors.some((e) => /cart is empty/.test(e)), empty.text);

    const orders = await listOrders(user.token);
    assert.equal(orders.json.orders.length, orders.json.pagination.total, "no order may exist after validation failures");
  });

  it("checkout recomputes prices from the live DB and snapshots totals/tax/address", async () => {
    const seeded = await seedCheckout({ qty: 2 }); // added to cart at price 100
    const repriced = await updateProduct(seeded.productId, { sellingPrice: 150 });
    assert.equal(repriced.status, 200, repriced.text);

    const res = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("recalc") });
    assert.equal(res.status, 201, res.text);
    const order = res.json.order;

    assert.equal(order.items.length, 1);
    assert.equal(order.items[0].unitPrice, 150, "the order must use the current price, not the stale cart line");
    assert.equal(order.subtotal, 300);
    assert.equal(order.taxTotal, 54); // 18% of 300
    assert.equal(order.grandTotal, 354);
    assert.equal(order.items[0].taxAmount, 54);
    assert.equal(order.status, "placed");
    assert.equal(order.paymentMethod, "cod");
    assert.match(order.orderNumber, /^BO-\d{6}-[0-9A-Z]{6}$/);

    assert.equal(order.taxBreakdown.length, 1);
    assert.equal(order.taxBreakdown[0].taxRate, 18);
    assert.equal(order.taxBreakdown[0].taxableAmount, 300);
    assert.equal(order.taxBreakdown[0].taxAmount, 54);
    assert.equal(order.taxBreakdown[0].categoryName, order.items[0].categoryName);

    assert.equal(order.shippingAddress.fullName, "Test Buyer");
    assert.equal(order.shippingAddress.pincode, "400001");
    assert.deepEqual(order.statusEvents.map((e) => e.toStatus), ["placed"]);

    // effects: cart line cleared, stock decremented
    const cart = await cartGet(user.token);
    assert.equal(cart.json.items.filter((i) => i.productId === seeded.productId).length, 0);
    assert.equal((await getProduct(seeded.productId)).json.product.stock, 8);
  });

  it("tax follows per-category rates; per-line taxes always sum to the order total", async () => {
    await clearCart(user.token); // this test adds several lines manually
    // Three 0.07 lines @10%: per-line rounding would be 0.03, the category
    // total is 0.02 — penny allocation must make the items sum to the total.
    const tag = nextTag();
    const category = await createCategory({ name: `Cat ${tag}`, taxRate: 10 });
    assert.equal(category.status, 201, category.text);
    const pennyIds = [];
    for (let i = 1; i <= 3; i += 1) {
      const p = await createProduct({
        name: `Penny ${tag}-${i}`,
        category: `Cat ${tag}`,
        mrpPrice: 0.09,
        sellingPrice: 0.07,
        stock: 5,
        categoryId: category.json.category.id
      });
      assert.equal(p.status, 201, p.text);
      pennyIds.push(p.json.product.id);
      assert.equal((await cartAdd(user.token, { productId: p.json.product.id, qty: 1 })).status, 201);
    }
    // Second category in the same order -> two tax groups
    const other = await seedProduct({ price: 50, taxRate: 5 });
    assert.equal((await cartAdd(user.token, { productId: other.productId, qty: 1 })).status, 201);

    const address = await addAddress(user.token, addressBody());
    const res = await checkout(user.token, { addressId: address.json.address.id, idempotencyKey: idemKey("tax") });
    assert.equal(res.status, 201, res.text);
    const order = res.json.order;

    assert.equal(order.subtotal, 50.21); // 0.21 + 50
    assert.equal(order.taxTotal, 2.52); // 0.02 (0.21 @10%) + 2.50 (50 @5%)
    assert.equal(order.grandTotal, 52.73);
    assert.equal(order.taxBreakdown.length, 2);

    const pennyLines = order.items.filter((item) => pennyIds.includes(item.productId));
    assert.equal(pennyLines.length, 3);
    approx(pennyLines.reduce((sum, item) => sum + item.lineTotal, 0), 0.21, "penny line totals");
    approx(pennyLines.reduce((sum, item) => sum + item.taxAmount, 0), 0.02, "penny line taxes");
    approx(order.items.reduce((sum, item) => sum + item.taxAmount, 0), order.taxTotal, "Σ item tax == order taxTotal");
  });

  it("insufficient stock at checkout is reported as a conflict and changes nothing", async () => {
    const seeded = await seedCheckout({ qty: 5 }); // stock 10
    const reduced = await updateProduct(seeded.productId, { stock: 2 });
    assert.equal(reduced.status, 200, reduced.text);

    const res = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("stock") });
    assert.equal(res.status, 409, res.text);
    const conflict = res.json.errors[0];
    assert.equal(conflict.productId, seeded.productId);
    assert.equal(conflict.requested, 5);
    assert.equal(conflict.available, 2);
    assert.equal(conflict.reason, "insufficient stock");

    const cart = await cartGet(user.token);
    assert.equal(cart.json.count, 1, "the cart must be untouched");
    assert.equal((await getProduct(seeded.productId)).json.product.stock, 2, "stock must be untouched");
    const orders = await listOrders(user.token);
    assert.equal(orders.json.orders.filter((o) => o.items.some((i) => i.productId === seeded.productId)).length, 0);
  });

  it("a product deleted from the catalog blocks checkout as unavailable", async () => {
    const seeded = await seedCheckout({ qty: 1 });
    const del = await deleteProduct(seeded.productId);
    assert.equal(del.status, 200, del.text);

    const res = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("gone") });
    assert.equal(res.status, 409, res.text);
    assert.equal(res.json.errors[0].reason, "no longer available");

    const orders = await listOrders(user.token);
    assert.equal(orders.json.orders.filter((o) => o.items.some((i) => i.productId === seeded.productId)).length, 0);
  });

  // ================= checkout: idempotency + concurrency =================

  it("idempotent replay: same key returns the same order, stock decremented once", async () => {
    const seeded = await seedCheckout({ qty: 2 }); // stock 10
    const key = idemKey("replay");

    const first = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: key });
    assert.equal(first.status, 201, first.text);

    const second = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: key });
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.idempotentReplay, true);
    assert.equal(second.json.order.id, first.json.order.id);
    assert.deepEqual(second.json.order.items.map((i) => i.id), first.json.order.items.map((i) => i.id));

    assert.equal((await getProduct(seeded.productId)).json.product.stock, 8, "the replay must not decrement stock again");
    assert.equal((await cartGet(user.token)).json.items.filter((i) => i.productId === seeded.productId).length, 0);
    const list = await listOrders(user.token);
    assert.equal(list.json.orders.filter((o) => o.orderNumber === first.json.order.orderNumber).length, 1);
  });

  it("concurrent duplicate checkout creates exactly one order", async () => {
    const seeded = await seedCheckout({ qty: 2 }); // stock 10
    const key = idemKey("dupe");

    const [a, b] = await Promise.all([
      checkout(user.token, { addressId: seeded.addressId, idempotencyKey: key }),
      checkout(user.token, { addressId: seeded.addressId, idempotencyKey: key })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 201], `unexpected statuses: ${a.status}/${b.status}`);
    const winner = a.status === 201 ? a : b;
    const loser = a.status === 201 ? b : a;
    assert.equal(loser.json.idempotentReplay, true);
    assert.equal(loser.json.order.id, winner.json.order.id);

    assert.equal((await getProduct(seeded.productId)).json.product.stock, 8, "stock decremented exactly once");
    assert.equal((await cartGet(user.token)).json.items.filter((i) => i.productId === seeded.productId).length, 0);
    const list = await listOrders(user.token);
    assert.equal(list.json.orders.filter((o) => o.orderNumber === winner.json.order.orderNumber).length, 1);
  });

  it("concurrent cart additions during checkout are never lost", async () => {
    const seeded = await seedCheckout({ qty: 1 });
    const extra = await seedProduct({ price: 40, stock: 5 });

    const [orderRes, addRes] = await Promise.all([
      checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("mix") }),
      cartAdd(user.token, { productId: extra.productId, qty: 1 })
    ]);
    assert.equal(orderRes.status, 201, orderRes.text);
    assert.equal(addRes.status, 201, addRes.text);

    // The concurrently added item must exist in exactly one place: order or cart.
    const orderedExtra = orderRes.json.order.items.filter((i) => i.productId === extra.productId).length;
    const cartExtra = (await cartGet(user.token)).json.items.filter((i) => i.productId === extra.productId).length;
    assert.equal(orderedExtra + cartExtra, 1, "the added item must exist in exactly one place");
    assert.equal(orderRes.json.order.items.filter((i) => i.productId === seeded.productId).length, 1);
  });

  it("a lost stock race rolls back the entire losing checkout (no partial decrement)", async () => {
    await clearCart(user.token);
    await clearCart(otherUser.token);
    const tag = nextTag();
    const category = await createCategory({ name: `Cat ${tag}`, taxRate: 0 });
    assert.equal(category.status, 201, category.text);
    const mkProduct = async (label, stock) => {
      const p = await createProduct({
        name: `${label} ${tag}`,
        category: `Cat ${tag}`,
        mrpPrice: 200,
        sellingPrice: 100,
        stock,
        categoryId: category.json.category.id
      });
      assert.equal(p.status, 201, p.text);
      return p.json.product.id;
    };
    const productA = await mkProduct("Shared", 5);
    const productB = await mkProduct("Scarce", 1); // last-unit contention

    const addr1 = await addAddress(user.token, addressBody());
    const addr2 = await addAddress(otherUser.token, addressBody());
    for (const [token, productId] of [[user.token, productA], [user.token, productB], [otherUser.token, productA], [otherUser.token, productB]]) {
      assert.equal((await cartAdd(token, { productId, qty: 1 })).status, 201);
    }

    const [r1, r2] = await Promise.all([
      checkout(user.token, { addressId: addr1.json.address.id, idempotencyKey: idemKey("race1") }),
      checkout(otherUser.token, { addressId: addr2.json.address.id, idempotencyKey: idemKey("race2") })
    ]);
    assert.deepEqual([r1.status, r2.status].sort(), [201, 409], `unexpected statuses: ${r1.status}/${r2.status}`);
    const loser = r1.status === 409 ? r1 : r2;
    assert.ok(loser.json.errors.some((e) => e.productId === productB && e.reason === "insufficient stock"), loser.text);

    // Winner fully committed, loser fully rolled back — A sold once, never twice.
    assert.equal((await getProduct(productA)).json.product.stock, 4, "A: exactly one unit sold");
    assert.equal((await getProduct(productB)).json.product.stock, 0, "B: sold out");

    const loserToken = r1.status === 409 ? user.token : otherUser.token;
    const winnerToken = r1.status === 409 ? otherUser.token : user.token;
    const hasContended = (o) => o.items.some((i) => i.productId === productA || i.productId === productB);
    assert.equal((await listOrders(winnerToken)).json.orders.filter(hasContended).length, 1, "winner: one order");
    assert.equal((await listOrders(loserToken)).json.orders.filter(hasContended).length, 0, "loser: no order");
    assert.equal((await cartGet(loserToken)).json.count, 2, "loser: cart untouched");
    assert.equal((await cartGet(winnerToken)).json.count, 0, "winner: cart cleared");
  });

  // ================= customer order history =================

  it("orders are owner-restricted; list supports pagination and status filters", async () => {
    const mineSeed = await seedCheckout({ qty: 1 });
    const mine = await checkout(user.token, { addressId: mineSeed.addressId, idempotencyKey: idemKey("own") });
    assert.equal(mine.status, 201, mine.text);

    await clearCart(otherUser.token);
    const theirSeed = await seedProduct({ price: 70 });
    const theirAddress = await addAddress(otherUser.token, addressBody());
    assert.equal((await cartAdd(otherUser.token, { productId: theirSeed.productId, qty: 1 })).status, 201);
    const theirs = await checkout(otherUser.token, { addressId: theirAddress.json.address.id, idempotencyKey: idemKey("their") });
    assert.equal(theirs.status, 201, theirs.text);

    const myList = await listOrders(user.token);
    assert.ok(myList.json.orders.some((o) => o.id === mine.json.order.id));
    assert.ok(!myList.json.orders.some((o) => o.id === theirs.json.order.id), "foreign orders must not leak into my list");
    const theirList = await listOrders(otherUser.token);
    assert.ok(theirList.json.orders.some((o) => o.id === theirs.json.order.id));
    assert.ok(!theirList.json.orders.some((o) => o.id === mine.json.order.id));

    // cross-user detail is a plain 404 (no existence disclosure)
    assert.equal((await getOrder(user.token, theirs.json.order.id)).status, 404);
    assert.equal((await getOrder(otherUser.token, mine.json.order.id)).status, 404);
    assert.equal((await getOrder(user.token, mine.json.order.id)).status, 200);
    assert.equal((await getOrder(user.token, 99999999)).status, 404);
    assert.equal((await getOrder(user.token, "abc")).status, 400);
    assert.equal((await listOrders("no-token-here")).status, 401);

    const page1 = await listOrders(user.token, "?page=1&limit=1");
    assert.equal(page1.json.count, 1);
    assert.ok(page1.json.pagination.total >= 2);
    assert.equal(page1.json.pagination.hasNext, true);
    assert.equal(page1.json.pagination.hasPrev, false);

    const placed = await listOrders(user.token, "?status=placed");
    assert.ok(placed.json.count >= 1);
    assert.ok(placed.json.orders.every((o) => o.status === "placed"));
    assert.equal((await listOrders(user.token, "?status=weird")).status, 400);
  });

  // ================= admin management =================

  it("admin order endpoints fail closed (401 anonymous, 403 non-admin, 403 unverified)", async () => {
    assert.equal((await api("/api/admin/orders")).status, 401);
    assert.equal((await api("/api/admin/orders", { token: user.token })).status, 403);

    const settings = { ...resolveMysqlSettings() };
    const originalEmails = process.env.ADMIN_EMAILS;
    try {
      // Baseline: access works through the transitional allowlist (role = customer)
      assert.equal((await adminListOrders()).status, 200);

      // Database-backed role via the audited provisioning script path
      const grant = await applyRoleChange({ settings, email: admin.email, role: "admin" });
      assert.equal(grant.changed, true);
      assert.equal((await adminListOrders()).status, 200);

      // The DB role alone must be sufficient (allowlist removed)
      process.env.ADMIN_EMAILS = "";
      assert.equal((await adminListOrders()).status, 200, "DB-backed role must work without ADMIN_EMAILS");

      // Removing the DB role fails closed even with no allowlist
      await applyRoleChange({ settings, email: admin.email, role: "customer" });
      assert.equal((await adminListOrders()).status, 403, "no role + no allowlist must fail closed");
      await applyRoleChange({ settings, email: admin.email, role: "admin" });

      // Unverified accounts can never reach admin routes, even with role + allowlist
      await ctx.sequelize.models.User.update({ isVerified: false }, { where: { id: admin.user.id } });
      assert.equal((await adminListOrders()).status, 403, "unverified must fail closed");
      await ctx.sequelize.models.User.update({ isVerified: true }, { where: { id: admin.user.id } });
      assert.equal((await adminListOrders()).status, 200);
    } finally {
      process.env.ADMIN_EMAILS = originalEmails;
      await applyRoleChange({ settings, email: admin.email, role: "admin" });
      await ctx.sequelize.models.User.update({ isVerified: true }, { where: { id: admin.user.id } });
    }
  });

  it("valid status transitions append history; invalid ones are refused", async () => {
    const seeded = await seedCheckout({ qty: 1 });
    const placed = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("flow") });
    assert.equal(placed.status, 201, placed.text);
    const id = placed.json.order.id;

    const step = async (status, expected, note) => {
      const res = await adminSetStatus(id, { status, ...(note ? { note } : {}) });
      assert.equal(res.status, expected, res.text);
      return res;
    };
    await step("confirmed", 200);
    await step("shipped", 200, "On the way");
    const delivered = await step("delivered", 200);

    assert.equal(delivered.json.order.status, "delivered");
    assert.deepEqual(delivered.json.order.statusEvents.map((e) => `${e.fromStatus}->${e.toStatus}`), [
      "null->placed",
      "placed->confirmed",
      "confirmed->shipped",
      "shipped->delivered"
    ]);
    assert.equal(delivered.json.order.statusEvents.find((e) => e.toStatus === "shipped").note, "On the way");

    // terminal state and transition skips are refused
    assert.equal((await adminSetStatus(id, { status: "cancelled" })).status, 409);

    const skippedSeed = await seedCheckout({ qty: 1 });
    const skipped = await checkout(user.token, { addressId: skippedSeed.addressId, idempotencyKey: idemKey("skip") });
    assert.equal(skipped.status, 201, skipped.text);
    assert.equal((await adminSetStatus(skipped.json.order.id, { status: "shipped" })).status, 409, "placed->shipped skips a step");

    // bad values / ids
    assert.equal((await adminSetStatus(skipped.json.order.id, { status: "teleported" })).status, 400);
    assert.equal((await adminSetStatus(skipped.json.order.id, {})).status, 400);
    assert.equal((await adminSetStatus(99999999, { status: "confirmed" })).status, 404);
  });

  it("cancellation restocks exactly once and blocks re-cancellation", async () => {
    const seeded = await seedCheckout({ qty: 3 }); // stock 10 -> 7
    const orderRes = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("cancel") });
    assert.equal(orderRes.status, 201, orderRes.text);
    assert.equal((await getProduct(seeded.productId)).json.product.stock, 7);

    const cancelled = await adminSetStatus(orderRes.json.order.id, { status: "cancelled", note: "Customer request" });
    assert.equal(cancelled.status, 200, cancelled.text);
    assert.equal(cancelled.json.order.status, "cancelled");
    assert.equal((await getProduct(seeded.productId)).json.product.stock, 10, "cancellation must restock");
    const event = cancelled.json.order.statusEvents.find((e) => e.toStatus === "cancelled");
    assert.equal(event.fromStatus, "placed");
    assert.equal(event.note, "Customer request");

    // exactly-once: a second cancel is refused and stock does not move again
    const again = await adminSetStatus(orderRes.json.order.id, { status: "cancelled" });
    assert.equal(again.status, 409);
    assert.match(again.json.message, /Cannot change order status from 'cancelled' to 'cancelled'/);
    assert.equal((await getProduct(seeded.productId)).json.product.stock, 10, "no double restock");

    // admin detail carries the buyer identity and the purchase snapshots
    const adminDetail = await adminGetOrder(orderRes.json.order.id);
    assert.equal(adminDetail.status, 200, adminDetail.text);
    assert.equal(adminDetail.json.order.user.email, user.email);
    assert.equal(adminDetail.json.order.items.length, 1);
    assert.equal(adminDetail.json.order.shippingAddress.pincode, "400001");
  });

  it("concurrent cancellations restock exactly once (locked order row)", async () => {
    const seeded = await seedCheckout({ qty: 2 }); // stock 10 -> 8
    const orderRes = await checkout(user.token, { addressId: seeded.addressId, idempotencyKey: idemKey("dcancel") });
    assert.equal(orderRes.status, 201, orderRes.text);
    const id = orderRes.json.order.id;
    const stockBefore = (await getProduct(seeded.productId)).json.product.stock;

    const [a, b] = await Promise.all([
      adminSetStatus(id, { status: "cancelled" }),
      adminSetStatus(id, { status: "cancelled" })
    ]);
    assert.deepEqual([a.status, b.status].sort(), [200, 409], `unexpected statuses: ${a.status}/${b.status}`);
    assert.equal((await getProduct(seeded.productId)).json.product.stock, stockBefore + 2, "stock restored exactly once");

    const detail = await adminGetOrder(id);
    assert.equal(detail.json.order.statusEvents.filter((e) => e.toStatus === "cancelled").length, 1, "exactly one cancel event");
  });

  it("admin list exposes every buyer's orders with status filter and pagination", async () => {
    const res = await adminListOrders("?status=cancelled&limit=1");
    assert.equal(res.status, 200, res.text);
    assert.ok(res.json.count >= 1);
    assert.ok(res.json.orders.every((o) => o.status === "cancelled"));
    assert.equal(res.json.pagination.limit, 1);
    assert.ok(res.json.pagination.total >= res.json.count);
    assert.ok(res.json.orders[0].user && res.json.orders[0].user.email, "admin rows must carry the buyer");

    const all = await adminListOrders("?limit=100");
    assert.ok(all.json.pagination.total >= 4, "admin sees orders from every user");
    assert.equal((await api("/api/admin/orders", { token: otherUser.token })).status, 403);
  });
});
