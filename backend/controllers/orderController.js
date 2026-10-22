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
const { Op, Transaction } = require("sequelize");
const sequelize = require("../config/db");
const { resolveDialect } = require("../config/dbConnectionOptions");
const { stockDelta } = require("../utils/sqlLiterals");
const User = require("../models/user");
const CartItem = require("../models/cart");
const Product = require("../models/product");
const ProductVariant = require("../models/productVariant");
const Category = require("../models/category");
const Address = require("../models/address");
const Order = require("../models/order");
const OrderItem = require("../models/orderItem");
const OrderStatusEvent = require("../models/orderStatusEvent");
const { buildOrderTotals } = require("../utils/pricing");
const { variantUnitPrice, syncProductStock } = require("../utils/variants");
const { HttpError, parsePositiveId } = require("../utils/apiError");
const { STATUS_VALUES } = require("../utils/orderStatus");
const { applyStatusTransition, canCancel } = require("../utils/orderTransitions");
const { notifyOrderPlaced, notifyOrderStatus } = require("../utils/orderMailer");

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

function serializeOrderItem(item) {
  return {
    id: item.id,
    productId: item.productId,
    variantId: item.variantId ?? null,
    variantSku: item.variantSku || null,
    variantSize: item.variantSize || null,
    variantColor: item.variantColor || null,
    variantPriceAdjustment:
      item.variantPriceAdjustment === null || item.variantPriceAdjustment === undefined
        ? null
        : Number(item.variantPriceAdjustment),
    name: item.name,
    image: item.image,
    unitPrice: Number(item.unitPrice),
    qty: item.qty,
    lineTotal: Number(item.lineTotal),
    taxRate: Number(item.taxRate),
    taxAmount: Number(item.taxAmount),
    categoryName: item.categoryName
  };
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
    // Server-derived so the storefront never re-implements the lifecycle rules
    // (utils/orderStatus ALLOWED_TRANSITIONS is the single source of truth).
    canCancel: canCancel(order.status),
    items: (order.OrderItems || []).map(serializeOrderItem),
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
      const variantIds = [...new Set(cartRows.map((row) => row.variantId).filter((id) => id !== null))];
      const [products, rowVariants, activeVariants] = await Promise.all([
        productIds.length
          ? Product.findAll({ where: { id: productIds }, include: categoryInclude, transaction })
          : [],
        variantIds.length ? ProductVariant.findAll({ where: { id: variantIds }, transaction }) : [],
        productIds.length
          ? ProductVariant.findAll({ where: { productId: productIds, isActive: true }, transaction })
          : []
      ]);
      const productById = new Map(products.map((product) => [product.id, product]));
      const variantById = new Map(rowVariants.map((variant) => [variant.id, variant]));
      const activeByProduct = new Map();
      for (const variant of activeVariants) {
        if (!activeByProduct.has(variant.productId)) activeByProduct.set(variant.productId, []);
        activeByProduct.get(variant.productId).push(variant);
      }

      // Validation pass: collect ALL conflicts before writing anything.
      // Variant identity is mandatory once a product has active variants; a
      // stale base line must fail rather than silently buying the base price.
      const conflicts = [];
      const lines = [];
      const requestedByVariant = new Map();
      for (const row of cartRows) {
        const product = row.productId === null ? null : (productById.get(row.productId) || null);
        if (!product) {
          conflicts.push({
            productId: row.productId,
            variantId: row.variantId,
            name: row.name,
            requested: row.qty,
            available: 0,
            reason: "no longer available"
          });
          continue;
        }

        let variant = null;
        if (row.variantId !== null) {
          variant = variantById.get(row.variantId) || null;
          if (!variant || variant.productId !== product.id || !variant.isActive) {
            conflicts.push({
              productId: product.id,
              variantId: row.variantId,
              name: product.name,
              requested: row.qty,
              available: 0,
              reason: "selected variant is no longer available"
            });
            continue;
          }
          const key = `v:${variant.id}`;
          const requested = (requestedByVariant.get(key) || 0) + row.qty;
          requestedByVariant.set(key, requested);
          if (Number(variant.stock) < requested) {
            conflicts.push({
              productId: product.id,
              variantId: variant.id,
              name: product.name,
              requested,
              available: Number(variant.stock),
              reason: "insufficient stock"
            });
            continue;
          }
        } else {
          if ((activeByProduct.get(product.id) || []).length > 0) {
            conflicts.push({
              productId: product.id,
              variantId: null,
              name: product.name,
              requested: row.qty,
              available: 0,
              reason: "size/colour selection required"
            });
            continue;
          }
          const key = `p:${product.id}`;
          const requested = (requestedByVariant.get(key) || 0) + row.qty;
          requestedByVariant.set(key, requested);
          if (Number(product.stock) < requested) {
            conflicts.push({
              productId: product.id,
              variantId: null,
              name: product.name,
              requested,
              available: Number(product.stock),
              reason: "insufficient stock"
            });
            continue;
          }
        }

        lines.push({
          row,
          product,
          variant,
          unitPrice: variant
            ? variantUnitPrice(product.sellingPrice, variant.priceAdjustment)
            : Number(product.sellingPrice)
        });
      }
      if (conflicts.length) {
        throw new HttpError(409, "Some items in your cart changed — review and try again", conflicts);
      }

      // Server-authoritative totals (variant-aware price + configured taxRate).
      const totals = buildOrderTotals(
        lines.map(({ row, product, unitPrice }) => ({
          unitPrice,
          qty: row.qty,
          categoryId: product.categoryId,
          categoryName: product.Category ? product.Category.name : null,
          taxRate: product.Category ? Number(product.Category.taxRate) : 0
        }))
      );

      // Order number with collision retries; exhaustion rolls everything back.
      // MySQL/InnoDB tolerates a failed INSERT inside an open transaction, but
      // PostgreSQL ABORTS the whole transaction on any failed statement
      // ("current transaction is aborted"), which would poison the checkout
      // above. On PG every attempt therefore runs inside a SAVEPOINT: a
      // collision rolls back only to the savepoint and the outer checkout
      // transaction stays usable. MySQL keeps the original inline create.
      const createOrderRow = (tx) => Order.create(
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
        { transaction: tx }
      );
      let order = null;
      for (let attempt = 0; attempt < ORDER_NUMBER_ATTEMPTS && !order; attempt += 1) {
        try {
          order = resolveDialect() === "postgres"
            ? await sequelize.transaction(
                { transaction, type: Transaction.TYPES.SAVEPOINT },
                (savepoint) => createOrderRow(savepoint)
              )
            : await createOrderRow(transaction);
        } catch (err) {
          if (isOrderNumberConflict(err)) continue;
          throw err;
        }
      }
      if (!order) {
        throw new HttpError(503, "Could not allocate an order number. Please retry.");
      }

      // Inventory write, ascending productId (deadlock discipline), locking the
      // parent rows BEFORE touching variants or inserting OrderItems (whose FK
      // checks take shared locks). A second validation under these locks closes
      // the window where a variant is deactivated or a base product becomes
      // variant-managed between the validation pass and the decrement.
      const sortedProductIds = [...new Set(lines.map(({ product }) => product.id))].sort((a, b) => a - b);
      const lockedProducts = await Product.findAll({
        where: { id: sortedProductIds },
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const lockedProductById = new Map(lockedProducts.map((product) => [product.id, product]));
      if (lockedProducts.length !== sortedProductIds.length) {
        throw new HttpError(409, "Some items in your cart changed — review and try again", [
          { productId: null, name: "item", requested: 1, available: 0, reason: "no longer available" }
        ]);
      }

      for (const productId of sortedProductIds) {
        const product = lockedProductById.get(productId);
        const productLines = lines.filter((line) => line.product.id === productId);
        const lockedVariants = await ProductVariant.findAll({
          where: { productId, isActive: true },
          order: [["id", "ASC"]],
          transaction,
          lock: transaction.LOCK.UPDATE
        });

        if (lockedVariants.length > 0) {
          const baseLine = productLines.find((line) => !line.variant);
          if (baseLine) {
            throw new HttpError(409, "Some items in your cart changed — review and try again", [
              {
                productId,
                variantId: null,
                name: product.name,
                requested: baseLine.row.qty,
                available: 0,
                reason: "size/colour selection required"
              }
            ]);
          }

          const variantQty = new Map();
          for (const line of productLines) {
            variantQty.set(line.variant.id, (variantQty.get(line.variant.id) || 0) + line.row.qty);
          }
          for (const variantId of [...variantQty.keys()].sort((a, b) => a - b)) {
            const qty = Number(variantQty.get(variantId));
            const variant = lockedVariants.find((candidate) => candidate.id === variantId);
            if (!variant) {
              throw new HttpError(409, "Some items in your cart changed — review and try again", [
                {
                  productId,
                  variantId,
                  name: product.name,
                  requested: qty,
                  available: 0,
                  reason: "selected variant is no longer available"
                }
              ]);
            }
            const [affected] = await ProductVariant.update(
              { stock: sequelize.literal(stockDelta("-", qty)) },
              {
                where: {
                  id: variantId,
                  productId,
                  isActive: true,
                  stock: { [Op.gte]: qty }
                },
                transaction
              }
            );
            if (affected === 0) {
              throw new HttpError(409, "Some items in your cart changed — review and try again", [
                {
                  productId,
                  variantId,
                  name: product.name,
                  requested: qty,
                  available: Number(variant.stock),
                  reason: "insufficient stock"
                }
              ]);
            }
          }

          // Products.stock stays the SUM(active variant stock) cache.
          await syncProductStock(productId, transaction);
          continue;
        }

        // No active variants: only legacy base lines are valid.
        if (productLines.some((line) => line.variant)) {
          throw new HttpError(409, "Some items in your cart changed — review and try again", [
            {
              productId,
              variantId: productLines.find((line) => line.variant).variant.id,
              name: product.name,
              requested: 1,
              available: 0,
              reason: "selected variant is no longer available"
            }
          ]);
        }

        const qty = productLines.reduce((sum, line) => sum + line.row.qty, 0);
        if (!Number.isInteger(qty) || qty < 1) {
          throw new Error(`Non-integer cart quantity during checkout: ${qty}`); // 500; not user-triggerable (DB INT)
        }
        const [affected] = await Product.update(
          { stock: sequelize.literal(stockDelta("-", qty)) },
          {
            where: { id: productId, stock: { [Op.gte]: qty } },
            transaction
          }
        );
        if (affected === 0) {
          throw new HttpError(409, "Some items in your cart changed — review and try again", [
            {
              productId,
              variantId: null,
              name: product.name,
              requested: qty,
              available: Number(product.stock),
              reason: "insufficient stock"
            }
          ]);
        }
      }

      // Purchase snapshots (per-line taxes sum exactly to taxTotal). Variant
      // identity/SKU/options are frozen here; later edits never rewrite history.
      await OrderItem.bulkCreate(
        lines.map(({ row, product, variant }, index) => ({
          orderId: order.id,
          productId: product.id,
          variantId: variant ? variant.id : null,
          variantSku: variant ? variant.sku : null,
          variantSize: variant ? variant.size : null,
          variantColor: variant ? variant.color : null,
          variantPriceAdjustment: variant ? Number(variant.priceAdjustment) : null,
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
    // Exactly one receipt per real checkout: idempotent replays above never
    // reach this line, so a retried POST cannot send a second email.
    await notifyOrderPlaced(order, req.user);
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

    // distinct:true counts DISTINCT Orders.id — the hasMany OrderItems include
    // would otherwise inflate the total by the number of item rows per order
    // (same P10-1 defect fixed on the admin list in Phase 11).
    const { count, rows } = await Order.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
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
        canCancel: canCancel(order.status),
        items: (order.OrderItems || []).map(serializeOrderItem)
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

// ---------- POST /api/orders/:id/cancel — customer cancellation ----------
// Owner-scoped (a foreign order id is a 404, never a 403 — no existence
// disclosure). Same transaction/lock/restock discipline as the admin path via
// utils/orderTransitions, so a customer cancel and an admin cancel racing on the
// same order produce exactly one success and exactly one restock.
const cancelOrder = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "order id");

    const outcome = await sequelize.transaction(async (transaction) => {
      const order = await Order.findOne({
        where: { id, userId: req.user.id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!order) throw new HttpError(404, "Order not found");

      const previous = await applyStatusTransition(
        order,
        "cancelled",
        "Cancelled by customer",
        transaction
      );
      return { orderId: order.id, previous };
    });

    const order = await fetchOrderGraph(outcome.orderId);
    await notifyOrderStatus(order, req.user, outcome.previous, "cancelled");
    res.json({ success: true, message: "Order cancelled", order });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  createOrder,
  listOrders,
  getOrder,
  cancelOrder,
  serializeOrder,
  fetchOrderGraph,
  STATUS_VALUES
};
