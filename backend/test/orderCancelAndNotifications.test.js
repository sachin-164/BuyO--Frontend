// test/orderCancelAndNotifications.test.js — Phase B (checklist items 12, 18, 19)
//
// Covers:
//   POST /api/orders/:id/cancel  — owner-scoped cancellation with exactly-once
//                                  transactional restock
//   order lifecycle emails       — one receipt per real checkout (never per
//                                  idempotent replay), one mail per committed
//                                  status change, failures never fatal
//
// SAFETY: shared harness — scratch test DB only (buyoDB_ph2_test), dropped and
// recreated per run. Mail is captured in memory (NODE_ENV=test), never sent.

const { describe, it, before, after } = require("node:test");
const assert = require("node:assert/strict");
const helpers = require("./helpers");
const Product = require("../models/product");
const Order = require("../models/order");

describe("Order cancellation + notifications (Phase B)", () => {
  let ctx;
  let admin;
  let customerA;
  let customerB;
  let product;
  let seq = 0;

  const api = (path, options) => helpers.api(ctx.baseUrl, path, options);
  const nextKey = () => `phase-b-${Date.now()}-${(seq += 1)}`;

  async function stockOf(productId) {
    const row = await Product.findByPk(productId);
    return row.stock;
  }

  async function placeOrder(customer, qty = 2) {
    const address = await api("/api/addresses", {
      method: "POST",
      token: customer.token,
      body: {
        fullName: "Phase B Buyer",
        phone: "9876543210",
        line1: "4 Test Lane",
        city: "Pune",
        state: "Maharashtra",
        pincode: "411001"
      }
    });
    assert.equal(address.status, 201, address.text);

    const add = await api("/api/cart", {
      method: "POST",
      token: customer.token,
      body: { productId: product.id, qty }
    });
    assert.equal(add.status, 201, add.text);

    const key = nextKey();
    const res = await api("/api/orders", {
      method: "POST",
      token: customer.token,
      body: { addressId: address.json.address.id, idempotencyKey: key }
    });
    assert.equal(res.status, 201, res.text);
    return { order: res.json.order, idempotencyKey: key };
  }

  before(async () => {
    ctx = await helpers.startTestApp();
    admin = await helpers.createAdminUser(ctx.baseUrl);
    customerA = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Cancel Buyer" });
    customerB = await helpers.createVerifiedUser(ctx.baseUrl, { name: "Other Buyer" });

    const unique = `phase-b-${Date.now()}`;
    const created = await api("/api/products", {
      method: "POST",
      token: admin.token,
      body: {
        name: `Cancelable ${unique}`,
        category: `Cat ${unique}`,
        mrpPrice: 150,
        sellingPrice: 100,
        stock: 50
      }
    });
    assert.equal(created.status, 201, created.text);
    product = created.json.product;
  });

  after(async () => {
    await ctx.close();
  });

  // ---------- receipts ----------
  it("sends exactly one receipt per real checkout, never for an idempotent replay", async () => {
    helpers.clearOutbox();
    const { order, idempotencyKey } = await placeOrder(customerA, 2);

    const outbox = helpers.getOutbox().filter((mail) => mail.to === customerA.email);
    assert.equal(outbox.length, 1, "expected exactly one receipt");
    assert.match(outbox[0].subject, new RegExp(order.orderNumber));
    assert.match(outbox[0].html, /Cancelable/);
    assert.match(outbox[0].html, /Cash on Delivery/);
    assert.match(outbox[0].html, /4 Test Lane/);

    // Retry the same checkout: the order is replayed, no second email.
    const replay = await api("/api/orders", {
      method: "POST",
      token: customerA.token,
      body: { addressId: order.addressId, idempotencyKey }
    });
    assert.equal(replay.status, 200, replay.text);
    assert.equal(replay.json.idempotentReplay, true);

    const afterReplay = helpers.getOutbox().filter((mail) => mail.to === customerA.email);
    assert.equal(afterReplay.length, 1, "an idempotent replay must not re-send the receipt");
  });

  // ---------- cancellation ----------
  it("cancels an owned placed order and restores stock exactly once", async () => {
    const before = await stockOf(product.id);
    const { order } = await placeOrder(customerA, 2);
    assert.equal(await stockOf(product.id), before - 2);

    helpers.clearOutbox();
    const cancelled = await api(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      token: customerA.token
    });
    assert.equal(cancelled.status, 200, cancelled.text);
    assert.equal(cancelled.json.order.status, "cancelled");
    assert.equal(cancelled.json.order.canCancel, false);
    assert.equal(await stockOf(product.id), before, "stock must be fully restored");

    const events = cancelled.json.order.statusEvents;
    const last = events[events.length - 1];
    assert.equal(last.toStatus, "cancelled");
    assert.equal(last.fromStatus, "placed");
    assert.match(last.note, /customer/i);

    // Exactly one cancellation notification.
    const mails = helpers.getOutbox().filter((mail) => mail.to === customerA.email);
    assert.equal(mails.length, 1);
    assert.match(mails[0].subject, /cancelled/i);

    // A second cancel is a conflict, and MUST NOT restock again.
    const twice = await api(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      token: customerA.token
    });
    assert.equal(twice.status, 409, twice.text);
    assert.equal(await stockOf(product.id), before, "a rejected cancel must not restock");
    assert.equal(
      helpers.getOutbox().filter((mail) => mail.to === customerA.email).length,
      1,
      "a rejected cancel must not send mail"
    );
  });

  it("hides other customers' orders behind a 404", async () => {
    const { order } = await placeOrder(customerA, 1);
    const stockAfter = await stockOf(product.id);

    const foreign = await api(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      token: customerB.token
    });
    assert.equal(foreign.status, 404, foreign.text);

    const anonymous = await api(`/api/orders/${order.id}/cancel`, { method: "POST" });
    assert.equal(anonymous.status, 401);

    const malformed = await api("/api/orders/not-a-number/cancel", {
      method: "POST",
      token: customerA.token
    });
    assert.equal(malformed.status, 400);

    // Nothing changed for the real owner.
    const stillThere = await api(`/api/orders/${order.id}`, { token: customerA.token });
    assert.equal(stillThere.json.order.status, "placed");
    assert.equal(await stockOf(product.id), stockAfter);
  });

  it("refuses to cancel an order that already shipped past the cancellable states", async () => {
    const { order } = await placeOrder(customerA, 1);

    for (const status of ["confirmed", "shipped", "delivered"]) {
      const res = await api(`/api/admin/orders/${order.id}/status`, {
        method: "PUT",
        token: admin.token,
        body: { status }
      });
      assert.equal(res.status, 200, res.text);
    }

    const stockAtDelivery = await stockOf(product.id);
    const res = await api(`/api/orders/${order.id}/cancel`, {
      method: "POST",
      token: customerA.token
    });
    assert.equal(res.status, 409, res.text);
    assert.equal(await stockOf(product.id), stockAtDelivery, "delivered stock must not be restocked");

    const detail = await api(`/api/orders/${order.id}`, { token: customerA.token });
    assert.equal(detail.json.order.canCancel, false);
  });

  it("serialises two concurrent cancels into one winner and one restock", async () => {
    const before = await stockOf(product.id);
    const { order } = await placeOrder(customerA, 3);
    assert.equal(await stockOf(product.id), before - 3);

    const [first, second] = await Promise.all([
      api(`/api/orders/${order.id}/cancel`, { method: "POST", token: customerA.token }),
      api(`/api/orders/${order.id}/cancel`, { method: "POST", token: customerA.token })
    ]);

    const statuses = [first.status, second.status].sort();
    assert.deepEqual(statuses, [200, 409]);
    assert.equal(await stockOf(product.id), before, "stock restored exactly once");

    const dbOrder = await Order.findByPk(order.id);
    assert.equal(dbOrder.status, "cancelled");
  });

  // ---------- admin status notifications ----------
  it("notifies the customer once per admin status transition", async () => {
    const { order } = await placeOrder(customerB, 1);
    helpers.clearOutbox();

    for (const status of ["confirmed", "shipped"]) {
      const res = await api(`/api/admin/orders/${order.id}/status`, {
        method: "PUT",
        token: admin.token,
        body: { status }
      });
      assert.equal(res.status, 200, res.text);
    }

    const mails = helpers.getOutbox().filter((mail) => mail.to === customerB.email);
    assert.equal(mails.length, 2, "one mail per committed transition");
    assert.match(mails[0].subject, /confirmed/i);
    assert.match(mails[1].subject, /shipped/i);
    assert.match(mails[1].text, new RegExp(order.orderNumber));
    assert.match(mails[1].html, /Previous status: Confirmed/);

    // A rejected transition sends nothing.
    const rejected = await api(`/api/admin/orders/${order.id}/status`, {
      method: "PUT",
      token: admin.token,
      body: { status: "confirmed" }
    });
    assert.equal(rejected.status, 409);
    assert.equal(helpers.getOutbox().filter((mail) => mail.to === customerB.email).length, 2);
  });

  // ---------- mail failure isolation ----------
  it("never fails checkout or cancellation when the mail transport is down", async () => {
    const previous = process.env.MAIL_TRANSPORT;
    process.env.MAIL_TRANSPORT = "fail";
    const errors = [];
    const originalError = console.error;
    console.error = (...args) => errors.push(args.join(" "));

    try {
      const before = await stockOf(product.id);
      const { order } = await placeOrder(customerA, 1);
      assert.equal(order.status, "placed");

      const cancelled = await api(`/api/orders/${order.id}/cancel`, {
        method: "POST",
        token: customerA.token
      });
      assert.equal(cancelled.status, 200, cancelled.text);
      assert.equal(cancelled.json.order.status, "cancelled");
      assert.equal(await stockOf(product.id), before, "restock still happens");

      assert.ok(
        errors.some((line) => line.includes("[order-mail]")),
        "mail failures are logged, not surfaced"
      );
    } finally {
      console.error = originalError;
      if (previous === undefined) delete process.env.MAIL_TRANSPORT;
      else process.env.MAIL_TRANSPORT = previous;
    }
  });
});
