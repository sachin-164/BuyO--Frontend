// test/cartMerge.test.js — Phase E (checklist item 16)
//
// POST /api/cart/merge absorbs the browser's localStorage guest cart once the
// shopper signs in. The endpoint must be additive, stock-safe, idempotent, and
// must tell the client exactly what could not be restored.
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test).

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Guest cart merge (Phase E)", () => {
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
    helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      token: admin.token,
      body: { category: "Merge tests", mrpPrice: 500, sellingPrice: 100, ...body }
    });

  const merge = (token, items, method = "POST") =>
    helpers.api(ctx.baseUrl, "/api/cart/merge", { method, token, body: { items } });

  async function product(name, stock) {
    const res = await createProduct({ name: `Merge ${name}`, stock });
    assert.equal(res.status, 201, res.text);
    return res.json.product;
  }

  it("requires authentication", async () => {
    const anonymous = await helpers.api(ctx.baseUrl, "/api/cart/merge", {
      method: "POST",
      body: { items: [{ productId: 1, qty: 1 }] }
    });
    assert.equal(anonymous.status, 401, anonymous.text);
  });

  it("merges guest lines, sums duplicate ids and returns authoritative totals", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const bottle = await product("Bottle", 6);
    const lamp = await product("Lamp", 3);

    const res = await merge(user.token, [
      { productId: bottle.id, qty: 2 },
      { productId: lamp.id, qty: 1 },
      { productId: bottle.id, qty: 1 }
    ]);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.count, 2, "duplicate guest lines collapse to one cart line");
    assert.deepEqual(
      res.json.merged.map((entry) => ({ productId: entry.productId, qty: entry.qty, added: entry.added })),
      [
        { productId: bottle.id, qty: 3, added: 3 },
        { productId: lamp.id, qty: 1, added: 1 }
      ]
    );
    assert.deepEqual(res.json.skipped, []);
    assert.deepEqual(res.json.clamped, []);
    assert.equal(res.json.totals.subtotal, 400);

    const cart = await helpers.api(ctx.baseUrl, "/api/cart", { token: user.token });
    assert.equal(cart.json.count, 2);
    assert.deepEqual(
      cart.json.items.map((item) => [item.productId, item.qty]),
      [
        [bottle.id, 3],
        [lamp.id, 1]
      ]
    );
  });

  it("adds to an existing account cart instead of replacing it", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const mug = await product("Mug", 8);

    const add = await helpers.api(ctx.baseUrl, "/api/cart", {
      method: "POST",
      token: user.token,
      body: { productId: mug.id, qty: 2 }
    });
    assert.equal(add.status, 201, add.text);

    const res = await merge(user.token, [{ productId: mug.id, qty: 3 }]);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.items[0].qty, 5, "existing 2 + guest 3");
    assert.equal(res.json.merged[0].added, 3);
  });

  it("clamps to available stock and reports the clamp", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const limited = await product("Limited", 4);

    const add = await helpers.api(ctx.baseUrl, "/api/cart", {
      method: "POST",
      token: user.token,
      body: { productId: limited.id, qty: 2 }
    });
    assert.equal(add.status, 201, add.text);

    const res = await merge(user.token, [{ productId: limited.id, qty: 10 }]);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.items[0].qty, 4, "never above stock");
    assert.equal(res.json.items[0].stockExceeded, false);
    assert.deepEqual(res.json.clamped, [
      { productId: limited.id, available: 4, requested: 12 }
    ]);
  });

  it("skips deleted and out-of-stock products but keeps the valid lines", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const kept = await product("Kept", 5);
    const removed = await product("Removed", 5);
    const soldOut = await product("Sold Out", 0);

    const deleted = await helpers.api(ctx.baseUrl, `/api/products/${removed.id}`, {
      method: "DELETE",
      token: admin.token
    });
    assert.equal(deleted.status, 200, deleted.text);

    const res = await merge(user.token, [
      { productId: removed.id, qty: 1 },
      { productId: soldOut.id, qty: 2 },
      { productId: kept.id, qty: 2 }
    ]);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.count, 1);
    assert.equal(res.json.items[0].productId, kept.id);
    assert.deepEqual(
      Object.fromEntries(res.json.skipped.map((entry) => [entry.productId, entry.reason])),
      { [removed.id]: "not_found", [soldOut.id]: "out_of_stock" }
    );
  });

  it("is a no-op for an empty guest cart and safe to retry", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const before = await helpers.api(ctx.baseUrl, "/api/cart", { token: user.token });

    for (let attempt = 0; attempt < 2; attempt += 1) {
      const res = await merge(user.token, []);
      assert.equal(res.status, 200, res.text);
      assert.deepEqual(res.json.merged, []);
      assert.equal(res.json.count, 0);
    }

    const duplicate = await merge(user.token, []);
    assert.equal(duplicate.json.totals.subtotal, before.json.totals.subtotal);
  });

  it("never exceeds stock when the same guest cart is submitted twice", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const scarce = await product("Scarce", 2);

    const first = await merge(user.token, [{ productId: scarce.id, qty: 2 }]);
    assert.equal(first.status, 200, first.text);
    assert.equal(first.json.items[0].qty, 2);

    const second = await merge(user.token, [{ productId: scarce.id, qty: 2 }]);
    assert.equal(second.status, 200, second.text);
    assert.equal(second.json.items[0].qty, 2, "a retry cannot double the quantity");
    assert.deepEqual(second.json.merged, []);
    assert.deepEqual(second.json.clamped, [
      { productId: scarce.id, available: 2, requested: 4 }
    ]);
  });

  it("validates the payload without touching the cart", async () => {
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const valid = await product("Validated", 5);

    const cases = [
      { items: "nope", match: /items must be an array/i },
      { items: [null], match: /must be an object/i },
      { items: [{ productId: 0, qty: 1 }], match: /productId must be a positive integer/i },
      { items: [{ productId: valid.id, qty: 0 }], match: /qty must be an integer between 1 and 99/i },
      { items: [{ productId: valid.id, qty: 100 }], match: /qty must be an integer between 1 and 99/i },
      {
        items: Array.from({ length: 51 }, () => ({ productId: valid.id, qty: 1 })),
        match: /at most 50 entries/i
      }
    ];

    for (const testCase of cases) {
      const res = await merge(user.token, testCase.items);
      assert.equal(res.status, 400, `${JSON.stringify(testCase.items)} -> ${res.text}`);
      assert.ok(
        Array.isArray(res.json.errors) && res.json.errors.some((entry) => testCase.match.test(entry)),
        res.text
      );
    }

    const cart = await helpers.api(ctx.baseUrl, "/api/cart", { token: user.token });
    assert.equal(cart.json.count, 0, "rejected merges must write nothing");
  });

  it("is scoped to the authenticated user", async () => {
    const first = await helpers.createVerifiedUser(ctx.baseUrl);
    const second = await helpers.createVerifiedUser(ctx.baseUrl);
    const shared = await product("Scoped", 5);

    const merged = await merge(first.token, [{ productId: shared.id, qty: 2 }]);
    assert.equal(merged.status, 200, merged.text);

    const secondCart = await helpers.api(ctx.baseUrl, "/api/cart", { token: second.token });
    assert.equal(secondCart.json.count, 0, "another shopper's cart is untouched");
  });
});
