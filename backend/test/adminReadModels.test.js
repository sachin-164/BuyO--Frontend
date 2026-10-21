// test/adminReadModels.test.js — Phase A (checklist items 1, 3, 5)
//
// Covers the new admin read models that replaced capped client-side
// aggregation:
//   GET /api/admin/customers          — directory + per-customer order stats
//   GET /api/admin/customers/:id      — detail (addresses + recent orders)
//   GET /api/admin/analytics/summary  — server-side dashboard aggregates
//   GET /api/admin/orders?q=          — free-text order search
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test), dropped and
// recreated per run. Never targets a real database.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");
const Order = require("../models/order");
const OrderItem = require("../models/orderItem");
const Product = require("../models/product");
const { Op } = require("sequelize");

describe("Admin read models (Phase A)", () => {
  let ctx;
  let admin;
  let customerA;
  let customerB;
  let product;
  let orderA;
  let orderB;
  let seed = 0;

  const api = (path, options) => helpers.api(ctx.baseUrl, path, options);
  const adminGet = (path) => api(path, { token: admin.token });
  const tag = () => `phA-${Date.now()}-${(seed += 1)}`;

  async function createAddress(token, overrides = {}) {
    const res = await api("/api/addresses", {
      method: "POST",
      token,
      body: {
        fullName: "Phase A Buyer",
        phone: "9876543210",
        line1: "1 Test Road",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001",
        ...overrides
      }
    });
    assert.equal(res.status, 201, res.text);
    return res.json.address;
  }

  async function placeOrder(customer, qty, key) {
    const address = await createAddress(customer.token);
    const add = await api("/api/cart", {
      method: "POST",
      token: customer.token,
      body: { productId: product.id, qty }
    });
    assert.equal(add.status, 201, add.text);
    const res = await api("/api/orders", {
      method: "POST",
      token: customer.token,
      body: { addressId: address.id, idempotencyKey: key }
    });
    assert.equal(res.status, 201, res.text);
    return res.json.order;
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    customerA = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Asha Verma" });
    customerB = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Bilal Khan" });

    const unique = tag();
    const category = await api("/api/categories", {
      method: "POST",
      token: admin.token,
      body: { name: `Cat ${unique}`, taxRate: 0 }
    });
    assert.equal(category.status, 201, category.text);

    const created = await api("/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Widget ${unique}`,
        category: `Cat ${unique}`,
        mrpPrice: 200,
        sellingPrice: 100,
        stock: 50,
        categoryId: category.json.category.id
      }
    });
    assert.equal(created.status, 201, created.text);
    product = created.json.product;

    orderA = await placeOrder(customerA, 2, `phase-a-a-${Date.now()}`);
    orderB = await placeOrder(customerB, 1, `phase-a-b-${Date.now()}`);
  });

  after(async () => {
    await ctx.close();
  });

  // ---------- authorization ----------
  it("rejects unauthenticated and non-admin access to every new admin endpoint", async () => {
    for (const path of ["/api/admin/customers", "/api/admin/analytics/summary"]) {
      const anonymous = await api(path);
      assert.equal(anonymous.status, 401, `${path} anonymous`);

      const asCustomer = await api(path, { token: customerA.token });
      assert.equal(asCustomer.status, 403, `${path} as customer`);
    }

    const detail = await api(`/api/admin/customers/${customerA.user.id}`, { token: customerB.token });
    assert.equal(detail.status, 403, "customer detail as non-admin");
  });

  // ---------- customers ----------
  it("lists customers with aggregated order count and non-cancelled spend", async () => {
    const res = await adminGet("/api/admin/customers?limit=100");
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.success, true);
    assert.ok(res.json.pagination.total >= 2);

    const asha = res.json.customers.find((row) => row.email === customerA.email);
    assert.ok(asha, "customer A missing from directory");
    assert.equal(asha.orderCount, 1);
    assert.equal(asha.totalSpend, 200); // 2 x 100, no tax
    assert.equal(asha.role, "customer");
    assert.ok(asha.lastOrderAt, "lastOrderAt should be populated");

    // No credential material may be exposed, ever.
    assert.equal(Object.prototype.hasOwnProperty.call(asha, "password"), false);

    // Admin accounts are not customers.
    assert.equal(
      res.json.customers.some((row) => row.email === admin.email),
      false
    );
  });

  it("searches customers by name and email, case-insensitively", async () => {
    const byName = await adminGet("/api/admin/customers?q=asha%20ver");
    assert.equal(byName.status, 200, byName.text);
    assert.equal(byName.json.customers.length, 1);
    assert.equal(byName.json.customers[0].email, customerA.email);

    const byEmail = await adminGet(`/api/admin/customers?q=${encodeURIComponent(customerB.email.toUpperCase())}`);
    assert.equal(byEmail.status, 200, byEmail.text);
    assert.equal(byEmail.json.customers.length, 1);
    assert.equal(byEmail.json.customers[0].email, customerB.email);

    // A wildcard-only query must not match everything.
    const wildcard = await adminGet("/api/admin/customers?q=%25%25%25");
    assert.equal(wildcard.status, 200, wildcard.text);
    assert.equal(wildcard.json.customers.length, 0);
  });

  it("returns a customer detail with addresses and recent orders", async () => {
    const res = await adminGet(`/api/admin/customers/${customerA.user.id}`);
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.customer.id, customerA.user.id);
    assert.equal(res.json.customer.orderCount, 1);
    assert.ok(Array.isArray(res.json.customer.addresses));
    assert.ok(res.json.customer.addresses.length >= 1);
    assert.equal(res.json.orders.length, 1);
    assert.equal(res.json.orders[0].orderNumber, orderA.orderNumber);
    assert.equal(res.json.orders[0].itemCount, 1);
    assert.equal(Object.prototype.hasOwnProperty.call(res.json.customer, "password"), false);
  });

  it("404s for unknown customer ids and 400s for malformed ids", async () => {
    const missing = await adminGet("/api/admin/customers/2147483647");
    assert.equal(missing.status, 404);

    const malformed = await adminGet("/api/admin/customers/not-a-number");
    assert.equal(malformed.status, 400);
  });

  // ---------- analytics ----------
  it("agrees with direct database aggregates", async () => {
    const res = await adminGet("/api/admin/analytics/summary?days=30");
    assert.equal(res.status, 200, res.text);
    const data = res.json;

    const totalOrders = await Order.count();
    const nonCancelled = await Order.count({ where: { status: { [Op.ne]: "cancelled" } } });
    const nonCancelledValue = Number(
      (await Order.sum("grandTotal", { where: { status: { [Op.ne]: "cancelled" } } })) || 0
    );

    assert.equal(data.orders.total, totalOrders);
    assert.equal(data.orders.nonCancelledCount, nonCancelled);
    assert.equal(data.orders.grossOrderValue, Math.round(nonCancelledValue * 100) / 100);

    const statusTotal = Object.values(data.orders.byStatus).reduce((sum, n) => sum + n, 0);
    assert.equal(statusTotal, totalOrders, "status counts must partition all orders");

    // AOV is derived, never fetched separately.
    assert.equal(
      data.orders.averageOrderValue,
      nonCancelled === 0 ? 0 : Math.round((nonCancelledValue / nonCancelled) * 100) / 100
    );

    const productTotal = await Product.count();
    assert.equal(data.products.total, productTotal);
    const User = require("../models/user");
    assert.equal(data.customers.total, await User.count({ where: { role: "customer" } }));
    assert.ok(Array.isArray(data.revenueSeries));
    assert.ok(Array.isArray(data.topProducts));
    assert.ok(data.recentOrders.length <= 5);
  });

  it("reports top products from purchase snapshots, not the live catalog", async () => {
    const res = await adminGet("/api/admin/analytics/summary");
    assert.equal(res.status, 200, res.text);
    const top = res.json.topProducts.find((row) => row.name === product.name);
    assert.ok(top, "seeded product missing from top products");
    assert.equal(top.units, 3); // 2 + 1 sold
    assert.equal(top.revenue, 300);

    const lines = await OrderItem.sum("lineTotal", { where: { productId: product.id } });
    assert.equal(top.revenue, Number(lines));
  });

  it("validates the analytics range", async () => {
    assert.equal((await adminGet("/api/admin/analytics/summary?days=0")).status, 400);
    assert.equal((await adminGet("/api/admin/analytics/summary?days=366")).status, 400);
    assert.equal((await adminGet("/api/admin/analytics/summary?days=abc")).status, 400);
  });

  // ---------- order search ----------
  it("finds orders by order number, customer name and customer email", async () => {
    const byNumber = await adminGet(`/api/admin/orders?q=${encodeURIComponent(orderA.orderNumber)}`);
    assert.equal(byNumber.status, 200, byNumber.text);
    assert.equal(byNumber.json.orders.length, 1);
    assert.equal(byNumber.json.orders[0].id, orderA.id);

    const byName = await adminGet("/api/admin/orders?q=bilal");
    assert.equal(byName.status, 200, byName.text);
    assert.equal(byName.json.orders.length, 1);
    assert.equal(byName.json.orders[0].id, orderB.id);

    const byEmail = await adminGet(`/api/admin/orders?q=${encodeURIComponent(customerA.email)}`);
    assert.equal(byEmail.status, 200, byEmail.text);
    assert.equal(byEmail.json.orders.length, 1);
    assert.equal(byEmail.json.orders[0].id, orderA.id);
  });

  it("keeps pagination totals correct when search matches multiple orders", async () => {
    // Both orders belong to distinct customers, so a shared search term is the
    // order-number prefix "BO-".
    const res = await adminGet("/api/admin/orders?q=bo-&limit=1");
    assert.equal(res.status, 200, res.text);
    assert.equal(res.json.orders.length, 1);
    const totalOrders = await Order.count();
    assert.equal(res.json.pagination.total, totalOrders);
    assert.equal(res.json.pagination.totalPages, Math.ceil(totalOrders / 1));
  });

  it("combines search with the status filter and never matches on wildcards", async () => {
    const combined = await adminGet(`/api/admin/orders?q=${encodeURIComponent(orderA.orderNumber)}&status=cancelled`);
    assert.equal(combined.status, 200, combined.text);
    assert.equal(combined.json.orders.length, 0, "placed order must not match a cancelled filter");

    const wildcard = await adminGet("/api/admin/orders?q=%25%25");
    assert.equal(wildcard.status, 200, wildcard.text);
    assert.equal(wildcard.json.orders.length, 0);
  });
});
