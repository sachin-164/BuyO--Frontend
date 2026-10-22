// test/variants.test.js — checklist items 20–22.
//
// Real Express + real database (scratch buyoDB_ph2_test, recreated by the
// harness). Covers the full variant lifecycle: admin CRUD/validation, public
// visibility, aggregate stock, cart identity/pricing, guest merge, checkout
// snapshots/decrements, and exactly-once restock on cancellation.
const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");

describe("Product variants (items 20–22)", () => {
  let ctx;
  let admin;
  let buyer;
  let seed = 0;

  const nextSku = (label) => `T${Date.now().toString(36)}-${seed++}-${label}`.toUpperCase();

  async function createProduct(overrides = {}) {
    const res = await helpers.api(ctx.baseUrl, "/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Variant Product ${seed++}`,
        category: "Variant Test",
        description: "variant fixture",
        mrpPrice: 1000,
        sellingPrice: 500,
        stock: 10,
        ...overrides
      }
    });
    assert.equal(res.status, 201, res.text);
    return res.json.product;
  }

  async function addVariant(productId, body, token = admin.token) {
    return helpers.api(ctx.baseUrl, `/api/products/${productId}/variants`, {
      method: "POST",
      token,
      body
    });
  }

  async function addToCart(token, body) {
    return helpers.api(ctx.baseUrl, "/api/cart", { method: "POST", token, body });
  }

  async function createAddress(token) {
    const res = await helpers.api(ctx.baseUrl, "/api/addresses", {
      method: "POST",
      token,
      body: {
        label: "Home",
        fullName: "Variant Buyer",
        phone: "9876543210",
        line1: "1 Variant Road",
        city: "Bengaluru",
        state: "KA",
        pincode: "560001"
      }
    });
    assert.equal(res.status, 201, res.text);
    return res.json.address;
  }

  async function checkout(token, addressId, key) {
    return helpers.api(ctx.baseUrl, "/api/orders", {
      method: "POST",
      token,
      body: { addressId, idempotencyKey: key || `variant-${Date.now()}-${seed++}` }
    });
  }

  async function stockOf(productId) {
    const ProductVariant = require("../models/productVariant");
    const product = await require("../models/product").findByPk(productId);
    const variants = await ProductVariant.findAll({ where: { productId } });
    return {
      productStock: Number(product.stock),
      variants: Object.fromEntries(variants.map((v) => [v.sku, Number(v.stock)]))
    };
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    buyer = await helpers.createVerifiedUser(ctx.baseUrl);
  });

  after(async () => {
    await ctx.close();
  });

  it("admin creates variants; public sees only active ones with resolved prices; aggregate stock is maintained", async () => {
    const product = await createProduct({ sellingPrice: 500, stock: 10 });
    const skuM = nextSku("M");
    const skuL = nextSku("L");
    const skuS = nextSku("S");

    const m = await addVariant(product.id, { size: "M", color: "Black", sku: skuM, stock: 3, priceAdjustment: 50 });
    assert.equal(m.status, 201, m.text);
    assert.equal(m.json.variant.sku, skuM.toUpperCase());
    assert.equal(m.json.variant.unitPrice, 550);

    const l = await addVariant(product.id, { size: "L", sku: skuL, stock: 4, priceAdjustment: -25.5 });
    assert.equal(l.status, 201, l.text);
    const s = await addVariant(product.id, { color: "Red", sku: skuS, stock: 2, isActive: false });
    assert.equal(s.status, 201, s.text);

    // Active variants only: M (3) + L (4); S is inactive.
    assert.deepEqual(await stockOf(product.id), {
      productStock: 7,
      variants: { [skuM]: 3, [skuL]: 4, [skuS]: 2 }
    });

    const detail = await helpers.api(ctx.baseUrl, `/api/products/${product.slug}`);
    assert.equal(detail.status, 200, detail.text);
    assert.equal(detail.json.product.hasVariants, true);
    assert.equal(detail.json.product.stock, 7);
    assert.deepEqual(
      detail.json.product.variants.map((v) => v.sku),
      [skuM, skuL]
    );
    assert.equal(detail.json.product.variants[0].unitPrice, 550);
    assert.equal(detail.json.product.variants[1].unitPrice, 474.5);

    const adminList = await helpers.api(ctx.baseUrl, `/api/products/${product.id}/variants`, {
      token: admin.token
    });
    assert.equal(adminList.status, 200, adminList.text);
    assert.equal(adminList.json.count, 3, "admin list includes inactive variants");
    assert.equal(adminList.json.variants.find((v) => v.sku === skuS).isActive, false);

    // The public catalog list carries the same flags (quick-add must send the
    // shopper to the PDP instead of adding an unconfigured base product).
    const list = await helpers.api(ctx.baseUrl, `/api/products?q=${encodeURIComponent(product.name)}`);
    assert.equal(list.status, 200, list.text);
    assert.equal(list.json.products[0].hasVariants, true);
    assert.equal(list.json.products[0].variants.length, 2);
  });

  it("rejects invalid variants, duplicate SKUs (case-insensitive) and non-admin access", async () => {
    const product = await createProduct();
    const other = await createProduct();

    const missingOption = await addVariant(product.id, { sku: nextSku("NOOPT"), stock: 1 });
    assert.equal(missingOption.status, 400, missingOption.text);
    assert.match(missingOption.json.errors.join(" "), /at least one of size or colour/i);

    const negative = await addVariant(product.id, { size: "M", sku: nextSku("NEG"), stock: -1 });
    assert.equal(negative.status, 400, negative.text);

    const tooNegative = await addVariant(product.id, {
      size: "M",
      sku: nextSku("PRICE"),
      stock: 1,
      priceAdjustment: -500
    });
    assert.equal(tooNegative.status, 400, tooNegative.text);
    assert.match(tooNegative.json.errors.join(" "), /greater than 0/);

    const badSku = await addVariant(product.id, { size: "M", sku: "bad sku!", stock: 1 });
    assert.equal(badSku.status, 400, badSku.text);

    const sku = nextSku("DUP");
    const first = await addVariant(product.id, { size: "M", sku, stock: 1 });
    assert.equal(first.status, 201, first.text);
    const duplicate = await addVariant(other.id, { size: "L", sku: sku.toLowerCase(), stock: 1 });
    assert.equal(duplicate.status, 409, duplicate.text);
    assert.equal(duplicate.json.code, "DUPLICATE_SKU");

    const forbidden = await addVariant(product.id, { size: "S", sku: nextSku("NOPE"), stock: 1 }, buyer.token);
    assert.equal(forbidden.status, 403, forbidden.text);

    const anonymous = await helpers.api(ctx.baseUrl, `/api/products/${product.id}/variants`);
    assert.equal(anonymous.status, 401, anonymous.text);

    // Wrong parent product: variant routes are scoped, so this is a 404.
    const wrongParent = await helpers.api(
      ctx.baseUrl,
      `/api/products/${other.id}/variants/${first.json.variant.id}`,
      { method: "PUT", token: admin.token, body: { stock: 2 } }
    );
    assert.equal(wrongParent.status, 404, wrongParent.text);

    // Mass assignment: productId is not part of the whitelist.
    const mass = await addVariant(product.id, {
      size: "XL",
      sku: nextSku("MASS"),
      stock: 1,
      productId: other.id
    });
    assert.equal(mass.status, 201, mass.text);
    assert.equal(mass.json.variant.productId, product.id);
  });

  it("cart requires a variant, keeps variants as separate lines and prices them independently", async () => {
    const product = await createProduct({ sellingPrice: 300 });
    const skuM = nextSku("M");
    const skuL = nextSku("L");
    const m = await addVariant(product.id, { size: "M", sku: skuM, stock: 2, priceAdjustment: 100 });
    const l = await addVariant(product.id, { size: "L", sku: skuL, stock: 5, priceAdjustment: 0 });
    assert.equal(m.status, 201, m.text);
    assert.equal(l.status, 201, l.text);

    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const noVariant = await addToCart(user.token, { productId: product.id, qty: 1 });
    assert.equal(noVariant.status, 400, noVariant.text);
    assert.match(noVariant.json.errors.join(" "), /select a size or colour/i);

    const foreignVariant = await addToCart(user.token, { productId: product.id, variantId: 999999, qty: 1 });
    assert.equal(foreignVariant.status, 400, foreignVariant.text);

    const addM = await addToCart(user.token, { productId: product.id, variantId: m.json.variant.id, qty: 2 });
    assert.equal(addM.status, 201, addM.text);
    assert.equal(addM.json.items.length, 1);
    assert.equal(addM.json.items[0].variantId, m.json.variant.id);
    assert.equal(addM.json.items[0].variant.sku, skuM);
    assert.equal(addM.json.items[0].price, 400);
    assert.equal(addM.json.items[0].lineTotal, 800);

    const addL = await addToCart(user.token, { productId: product.id, variantId: l.json.variant.id, qty: 1 });
    assert.equal(addL.status, 201, addL.text);
    assert.equal(addL.json.items.length, 2, "each variant is its own line");

    const overM = await addToCart(user.token, { productId: product.id, variantId: m.json.variant.id, qty: 1 });
    assert.equal(overM.status, 400, overM.text);
    assert.match(overM.json.errors.join(" "), /only 2 unit/i);

    const updateToZeroStock = await helpers.api(ctx.baseUrl, `/api/cart/${addL.json.items.find((i) => i.variantId === l.json.variant.id).id}`, {
      method: "PUT",
      token: user.token,
      body: { qty: 6 }
    });
    assert.equal(updateToZeroStock.status, 400, updateToZeroStock.text);

    // Product stock is the aggregate of the two variant lines/products.
    const state = await stockOf(product.id);
    assert.equal(state.productStock, 7);
  });

  it("guest merge preserves variant identity, sums duplicates and skips a stale base line", async () => {
    const product = await createProduct({ sellingPrice: 200 });
    const sku = nextSku("MERGE");
    const variant = await addVariant(product.id, { size: "M", sku, stock: 4 });
    assert.equal(variant.status, 201, variant.text);
    const baseProduct = await createProduct({ sellingPrice: 150, stock: 3 });

    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const merged = await helpers.api(ctx.baseUrl, "/api/cart/merge", {
      method: "POST",
      token: user.token,
      body: {
        items: [
          { productId: product.id, variantId: variant.json.variant.id, qty: 2 },
          { productId: product.id, variantId: variant.json.variant.id, qty: 1 },
          { productId: product.id, qty: 1 },
          { productId: baseProduct.id, qty: 2 }
        ]
      }
    });
    assert.equal(merged.status, 200, merged.text);
    assert.equal(merged.json.merged.length, 2);
    const mergedByProduct = Object.fromEntries(merged.json.merged.map((m) => [m.productId, m]));
    assert.deepEqual(
      { variantId: mergedByProduct[product.id].variantId, qty: mergedByProduct[product.id].qty },
      { variantId: variant.json.variant.id, qty: 3 }
    );
    assert.deepEqual(
      { variantId: mergedByProduct[baseProduct.id].variantId, qty: mergedByProduct[baseProduct.id].qty },
      { variantId: null, qty: 2 }
    );
    assert.ok(merged.json.skipped.some((s) => s.reason === "variant_required"));
    assert.equal(merged.json.items.length, 2);
    assert.equal(merged.json.items.find((i) => i.variantId).price, 200);

    const guest = await helpers.api(ctx.baseUrl, "/api/cart", {
      method: "POST",
      token: user.token,
      body: { productId: product.id, variantId: variant.json.variant.id, qty: 2 }
    });
    assert.equal(guest.status, 400, guest.text, "merge already reached the variant stock ceiling");
    assert.match(guest.text, /only 4 unit/i);
  });

  it("checkout snapshots the variant and decrements variant + aggregate stock", async () => {
    const product = await createProduct({ sellingPrice: 400, stock: 99 });
    const sku = nextSku("BUY");
    const variant = await addVariant(product.id, {
      size: "L",
      color: "Blue",
      sku,
      stock: 3,
      priceAdjustment: 125.5
    });
    assert.equal(variant.status, 201, variant.text);
    const address = await createAddress(buyer.token);

    const cart = await addToCart(buyer.token, {
      productId: product.id,
      variantId: variant.json.variant.id,
      qty: 2
    });
    assert.equal(cart.status, 201, cart.text);

    const order = await checkout(buyer.token, address.id);
    assert.equal(order.status, 201, order.text);
    const item = order.json.order.items[0];
    assert.equal(item.variantId, variant.json.variant.id);
    assert.equal(item.variantSku, sku);
    assert.equal(item.variantSize, "L");
    assert.equal(item.variantColor, "Blue");
    assert.equal(item.variantPriceAdjustment, 125.5);
    assert.equal(item.unitPrice, 525.5);
    assert.equal(order.json.order.items[0].qty, 2);
    assert.equal(order.json.order.grandTotal, 1051);

    assert.deepEqual(await stockOf(product.id), {
      productStock: 1,
      variants: { [sku]: 1 }
    });

    // Cancellation restocks the variant and the aggregate cache exactly once.
    const cancel = await helpers.api(ctx.baseUrl, `/api/orders/${order.json.order.id}/cancel`, {
      method: "POST",
      token: buyer.token
    });
    assert.equal(cancel.status, 200, cancel.text);
    assert.deepEqual(await stockOf(product.id), {
      productStock: 3,
      variants: { [sku]: 3 }
    });

    const again = await helpers.api(ctx.baseUrl, `/api/orders/${order.json.order.id}/cancel`, {
      method: "POST",
      token: buyer.token
    });
    assert.equal(again.status, 409, again.text);
    assert.equal((await stockOf(product.id)).variants[sku], 3, "second cancel must not restock twice");
  });

  it("stale or deactivated variants are blocked at cart and checkout (no partial order)", async () => {
    const product = await createProduct({ sellingPrice: 250 });
    const sku = nextSku("STALE");
    const variant = await addVariant(product.id, { size: "M", sku, stock: 3 });
    assert.equal(variant.status, 201, variant.text);
    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const address = await createAddress(user.token);

    const cart = await addToCart(user.token, { productId: product.id, variantId: variant.json.variant.id, qty: 2 });
    assert.equal(cart.status, 201, cart.text);

    // Stock drops below the cart quantity after the cart was built.
    const updated = await helpers.api(ctx.baseUrl, `/api/products/${product.id}/variants/${variant.json.variant.id}`, {
      method: "PUT",
      token: admin.token,
      body: { stock: 1 }
    });
    assert.equal(updated.status, 200, updated.text);

    const conflict = await checkout(user.token, address.id);
    assert.equal(conflict.status, 409, conflict.text);
    assert.match(conflict.text, /insufficient stock/i);
    assert.equal((await stockOf(product.id)).productStock, 1, "failed checkout must not ship stock");

    // Deactivate: cart shows the line as unavailable, checkout refuses it.
    const deactivated = await helpers.api(ctx.baseUrl, `/api/products/${product.id}/variants/${variant.json.variant.id}`, {
      method: "DELETE",
      token: admin.token
    });
    assert.equal(deactivated.status, 200, deactivated.text);
    assert.equal(deactivated.json.variant.isActive, false);

    const cartView = await helpers.api(ctx.baseUrl, "/api/cart", { token: user.token });
    assert.equal(cartView.status, 200, cartView.text);
    assert.equal(cartView.json.items[0].unavailable, true);
    assert.equal(cartView.json.items[0].unavailableReason, "variant_inactive");
    assert.equal(cartView.json.totals.subtotal, 0);

    const blocked = await checkout(user.token, address.id);
    assert.equal(blocked.status, 409, blocked.text);
    assert.match(blocked.text, /no longer available|selection required/i);

    const detail = await helpers.api(ctx.baseUrl, `/api/products/${product.slug}`);
    assert.equal(detail.json.product.hasVariants, false, "an all-inactive product has no buyable variants");
    assert.equal(detail.json.product.stock, 0);
  });

  it("variant stock edits are the only inventory path; direct product stock edits are refused", async () => {
    const product = await createProduct({ stock: 8 });
    const sku = nextSku("EDIT");
    const variant = await addVariant(product.id, { size: "M", sku, stock: 2 });
    assert.equal(variant.status, 201, variant.text);

    const direct = await helpers.api(ctx.baseUrl, `/api/products/${product.id}`, {
      method: "PUT",
      token: admin.token,
      body: { stock: 99 }
    });
    assert.equal(direct.status, 409, direct.text);
    assert.equal(direct.json.code, "STOCK_MANAGED_BY_VARIANTS");
    assert.equal((await stockOf(product.id)).productStock, 2);

    const variantUpdate = await helpers.api(ctx.baseUrl, `/api/products/${product.id}/variants/${variant.json.variant.id}`, {
      method: "PUT",
      token: admin.token,
      body: { stock: 6, priceAdjustment: -10 }
    });
    assert.equal(variantUpdate.status, 200, variantUpdate.text);
    assert.equal(variantUpdate.json.variant.stock, 6);
    assert.equal(variantUpdate.json.variant.unitPrice, 490);
    assert.equal((await stockOf(product.id)).productStock, 6);

    // A base price cut that would make the adjusted variant price <= 0 is refused.
    const priceCut = await helpers.api(ctx.baseUrl, `/api/products/${product.id}`, {
      method: "PUT",
      token: admin.token,
      body: { sellingPrice: 5, mrpPrice: 1000 }
    });
    assert.equal(priceCut.status, 400, priceCut.text);
    assert.match(priceCut.text, /zero or negative/i);
  });

  it("products without variants keep the original base-stock behaviour", async () => {
    const product = await createProduct({ sellingPrice: 100, stock: 2 });
    const detail = await helpers.api(ctx.baseUrl, `/api/products/${product.slug}`);
    assert.equal(detail.json.product.hasVariants, false);
    assert.deepEqual(detail.json.product.variants, []);

    const user = await helpers.createVerifiedUser(ctx.baseUrl);
    const cart = await addToCart(user.token, { productId: product.id, qty: 2 });
    assert.equal(cart.status, 201, cart.text);
    assert.equal(cart.json.items[0].variantId, null);
    assert.equal(cart.json.items[0].price, 100);

    const address = await createAddress(user.token);
    const order = await checkout(user.token, address.id);
    assert.equal(order.status, 201, order.text);
    assert.equal(order.json.order.items[0].variantId, null);
    assert.equal(order.json.order.items[0].variantSku, null);
    assert.equal(order.json.order.items[0].unitPrice, 100);

    const productRow = await require("../models/product").findByPk(product.id);
    assert.equal(Number(productRow.stock), 0);
  });
});
