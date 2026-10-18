// controllers/orderController.js — customer orders + checkout (Phase 6, COD)
//
// CHECKOUT (POST /api/orders) — single transaction:
//  1. Lock the user's row (SELECT ... FOR UPDATE) — serializes this user's
//     checkout and cart mutations (same pattern as Phase 5).
//  2. Idempotency: (userId, idempotencyKey) lookup (uq_orders_user_idem) —
//     a retry returns the existing order (200 + idempotentReplay), with NO
//     second insert, NO stock decrement and NO cart clearing. A true
//     concurrent duplicate loses the unique-index race, rolls back fully and
//     replays the winner's order.
//  3. Address must belong to the user (scoped lookup -> 404).
//  4. Cart is read under the lock; all stock/availability conflicts are
//     collected and reported together (409) BEFORE any write. Totals are
//     recomputed from live DB prices + per-category taxRate (tax-exclusive),
//     via utils/pricing.buildOrderTotals.
//  5. Order created; guarded atomic stock decrements run immediately in
//     ascending productId order (deadlock discipline): the guarded UPDATE
//     takes X locks on product rows BEFORE any other statement touches
//     products — this matters because the later OrderItems insert takes S
//     locks on the same rows via its FK check, and mixing those with a later
//     S->X upgrade deadlocks concurrent checkouts (verified via
//     SHOW ENGINE INNODB STATUS during Phase 6 development).
//     `WHERE stock >= qty`: 0 affected rows => lost a race => 409 + full
//     rollback (order row, items and stock all untouched after rollback).
//  6. OrderItems (purchase snapshots) + initial status event created; then
//     only the purchased cart lines are deleted (by line id) — items added
//     concurrently after this transaction's snapshot are never wiped.
// Failure anywhere => rollback => stock, cart and order tables untouched.
const crypto = require("crypto");
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const User = require("../models/user");
const CartItem = require("../models/cart");
const Product = require("../models/product");
const Category = require("../models/category");
const Address = require("../models/address");
const Order = require("../models/order");
const OrderItem = require("../models/orderItem");
const OrderStatusEvent = require("../models/orderStatusEvent");
const { buildOrderTotals } = require("../utils/pricing");
const { HttpError, parsePositiveId } = require("../utils/apiError");
const { STATUS_VALUES } = require("../utils/orderStatus");

const ORDER_NUMBER_ATTEMPTS = 5;
const categoryInclude = [{ model: Category, as: "Category" }];
const itemInclude = [{ model: OrderItem, as: "OrderItems", order: [["id", "ASC"]] }];
const eventInclude = [{ model: OrderStatusEvent, as: "OrderStatusEvents", order: [["id", "ASC"]] }];

// BO-<yyMMdd>-<6 base36 chars> — uniqueness enforced by uq_orders_number.
function generateOrderNumber() {
  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const stamp = `${String(now.getFullYear()).slice(2)}${pad(now.getMonth() + 1)}${pad(now.getDate())}`;
  const suffix = crypto.randomBytes(4).readUInt32BE(0).toString(36).toUpperCase().padStart(6, "0").slice(-6);
  return `BO-${stamp}-${suffix}`;
}

function serializeOrder(order) {
  return {
    id: order.id,
    orderNumber: order.orderNumber,
    status: order.status,
    paymentMethod: order.paymentMethod,
    subtotal: Number(order.subtotal),
    taxTotal: Number(order.taxTotal),
    grandTotal: Number(order.grandTotal),
    taxBreakdown: order.taxBreakdown,
    shippingAddress: order.shippingAddress,
    addressId: order.addressId,
    notes: order.notes,
    createdAt: order.createdAt,
    items: (order.OrderItems || []).map((item) => ({
      id: item.id,
      productId: item.productId,
      name: item.name,
      image: item.image,
      unitPrice: Number(item.unitPrice),
      qty: item.qty,
      lineTotal: Number(item.lineTotal),
      taxRate: Number(item.taxRate),
      taxAmount: Number(item.taxAmount),
      categoryName: item.categoryName
    })),
    statusEvents: (order.OrderStatusEvents || []).map((event) => ({
      id: event.id,
      fromStatus: event.fromStatus,
      toStatus: event.toStatus,
      note: event.note,
      createdAt: event.createdAt
    }))
  };
}

async function fetchOrderGraph(orderId, transaction) {
  const order = await Order.findByPk(orderId, {
    include: [...itemInclude, ...eventInclude],
    transaction
  });
  return serializeOrder(order);
}

function isIdempotencyConflict(error) {
  if (!error || error.name !== "SequelizeUniqueConstraintError") return false;
  const keys = Object.keys(error.fields || {});
  return keys.some((key) => /idem/i.test(key)) || /uq_orders_user_idem/i.test(error.message || "");
}

function isOrderNumberConflict(error) {
  if (!error || error.name !== "SequelizeUniqueConstraintError") return false;
  const keys = Object.keys(error.fields || {});
  return keys.some((key) => /orderNumber/i.test(key)) || /uq_orders_number/i.test(error.message || "");
}

// ---------- POST /api/orders — checkout (COD, idempotent) ----------
const createOrder = async (req, res, next) => {
  try {
    const { addressId, idempotencyKey, notes } = req.body;

    const outcome = await sequelize.transaction(async (transaction) => {
      // Serialize this user's checkout/cart mutations.
      await User.findByPk(req.user.id, { transaction, lock: transaction.LOCK.UPDATE });

      // Idempotent replay (sequential retries land here).
      const replay = await Order.findOne({
        where: { userId: req.user.id, idempotencyKey },
        transaction
      });
      if (replay) return { replayId: replay.id };

      const address = await Address.findOne({
        where: { id: addressId, userId: req.user.id },
        transaction
      });
      if (!address) throw new HttpError(404, "Address not found");

      const cartRows = await CartItem.findAll({
        where: { UserId: req.user.id },
        order: [["id", "ASC"]],
        transaction
      });
      if (!cartRows.length) throw new HttpError(400, "Validation failed", ["Your cart is empty"]);

      const productIds = [...new Set(cartRows.map((row) => row.productId).filter((id) => id !== null))];
      const products = productIds.length
        ? await Product.findAll({ where: { id: productIds }, include: categoryInclude, transaction })
        : [];
      const productById = new Map(products.map((product) => [product.id, product]));

      // Validation pass: collect ALL conflicts before writing anything.
      const conflicts = [];
      const lines = [];
      for (const row of cartRows) {
        const product = row.productId === null ? null : (productById.get(row.productId) || null);
        if (!product) {
          conflicts.push({ productId: row.productId, name: row.name, requested: row.qty, available: 0, reason: "no longer available" });
          continue;
        }
        if (product.stock < row.qty) {
          conflicts.push({ productId: product.id, name: product.name, requested: row.qty, available: product.stock, reason: "insufficient stock" });
          continue;
        }
        lines.push({ row, product });
      }
      if (conflicts.length) {
        throw new HttpError(409, "Some items in your cart changed — review and try again", conflicts);
      }

      // Server-authoritative totals (current prices + configured taxRate).
      const totals = buildOrderTotals(
        lines.map(({ row, product }) => ({
          unitPrice: Number(product.sellingPrice),
          qty: row.qty,
          categoryId: product.categoryId,
          categoryName: product.Category ? product.Category.name : null,
          taxRate: product.Category ? Number(product.Category.taxRate) : 0
        }))
      );

      // Order number with collision retries; exhaustion rolls everything back.
      let order = null;
      for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS && !order; attempt += 1) {
        try {
          order = await Order.create(
            {
              userId: req.user.id,
              orderNumber: generateOrderNumber(),
              idempotencyKey,
              status: "placed",
              paymentMethod: "cod",
              subtotal: totals.subtotal,
              taxTotal: totals.taxTotal,
              grandTotal: totals.grandTotal,
              taxBreakdown: totals.taxBreakdown,
              shippingAddress: {
                label: address.label,
                fullName: address.fullName,
                phone: address.phone,
                line1: address.line1,
                line2: address.line2,
                city: address.city,
                state: address.state,
                pincode: address.pincode
              },
              addressId: address.id,
              notes: notes || null
            },
            { transaction }
          );
        } catch (err) {
          if (isOrderNumberConflict(err)) continue;
          throw err;
        }
      }
      if (!order) {
        throw new HttpError(503, "Could not allocate an order number. Please retry.");
      }

      // Guarded atomic stock decrements FIRST, ascending productId (deadlock
      // discipline). Model-level update: WHERE stock >= qty makes the
      // decrement all-or-nothing per line; 0 affected rows means another
      // transaction won the race -> full rollback (the order row above rolls
      // back with it). Taking the X locks here, before OrderItems, prevents
      // the FK-check S locks from deadlocking concurrent checkouts (see
      // controller header).
      const qtyByProduct = new Map();
      for (const { row, product } of lines) {
        qtyByProduct.set(product.id, (qtyByProduct.get(product.id) || 0) + row.qty);
      }
      for (const productId of [...qtyByProduct.keys()].sort((a, b) => a - b)) {
        const qty = Number(qtyByProduct.get(productId));
        if (!Number.isInteger(qty) || qty < 1) {
          throw new Error(`Non-integer cart quantity during checkout: ${qtyByProduct.get(productId)}`); // 500; not user-triggerable (DB INT)
        }
        const [affected] = await Product.update(
          { stock: sequelize.literal(`\`stock\` - ${qty}`) },
          { where: { id: productId, stock: { [Op.gte]: qty } }, transaction }
        );
        if (affected === 0) {
          const product = productById.get(productId);
          throw new HttpError(409, "Some items in your cart changed — review and try again", [
            { productId, name: product ? product.name : "item", requested: qty, available: product ? product.stock : 0, reason: "insufficient stock" }
          ]);
        }
      }

      // Purchase snapshots (per-line taxes sum exactly to taxTotal).
      await OrderItem.bulkCreate(
        lines.map(({ row, product }, index) => ({
          orderId: order.id,
          productId: product.id,
          name: product.name,
          image: product.image,
          unitPrice: totals.lines[index].unitPrice,
          qty: row.qty,
          lineTotal: totals.lines[index].lineTotal,
          taxRate: totals.lines[index].taxRate,
          taxAmount: totals.lines[index].taxAmount,
          categoryName: totals.lines[index].categoryName
        })),
        { transaction }
      );
      await OrderStatusEvent.create(
        { orderId: order.id, fromStatus: null, toStatus: "placed" },
        { transaction }
      );

      // Clear ONLY the purchased lines (concurrent additions survive).
      await CartItem.destroy({
        where: { id: lines.map(({ row }) => row.id), UserId: req.user.id },
        transaction
      });

      return { orderId: order.id };
    });

    if (outcome.replayId) {
      const order = await fetchOrderGraph(outcome.replayId);
      return res.status(200).json({ success: true, idempotentReplay: true, order });
    }
    const order = await fetchOrderGraph(outcome.orderId);
    return res.status(201).json({ success: true, message: "Order placed (Cash on Delivery)", order });
  } catch (err) {
    // Concurrent duplicate (unique-index race): rollback already happened —
    // return the winner's order as a replay.
    if (isIdempotencyConflict(err)) {
      try {
        const existing = await Order.findOne({ where: { userId: req.user.id, idempotencyKey } });
        if (existing) {
          const order = await fetchOrderGraph(existing.id);
          return res.status(200).json({ success: true, idempotentReplay: true, order });
        }
      } catch (replayErr) {
        return next(replayErr);
      }
    }
    next(err);
  }
};

// ---------- GET /api/orders — own list (paginated, optional status filter) ----------
const listOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const page = req.query.page === undefined ? 1 : req.query.page;
    const limit = req.query.limit === undefined ? 20 : req.query.limit;

    const where = { userId: req.user.id };
    if (status) where.status = status;

    const { count, rows } = await Order.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      include: itemInclude
    });

    const totalPages = Math.max(1, Math.ceil(count / limit));
    res.json({
      success: true,
      count: rows.length,
      orders: rows.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        paymentMethod: order.paymentMethod,
        subtotal: Number(order.subtotal),
        taxTotal: Number(order.taxTotal),
        grandTotal: Number(order.grandTotal),
        createdAt: order.createdAt,
        items: (order.OrderItems || []).map((item) => ({
          id: item.id,
          productId: item.productId,
          name: item.name,
          unitPrice: Number(item.unitPrice),
          qty: item.qty,
          lineTotal: Number(item.lineTotal)
        }))
      })),
      pagination: { page, limit, total: count, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
    });
  } catch (err) {
    next(err);
  }
};

// ---------- GET /api/orders/:id — own order detail ----------
const getOrder = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "order id");
    const order = await Order.findOne({
      where: { id, userId: req.user.id },
      include: [...itemInclude, ...eventInclude]
    });
    if (!order) throw new HttpError(404, "Order not found");
    res.json({ success: true, order: serializeOrder(order) });
  } catch (err) {
    next(err);
  }
};

module.exports = { createOrder, listOrders, getOrder, serializeOrder, fetchOrderGraph, STATUS_VALUES };
