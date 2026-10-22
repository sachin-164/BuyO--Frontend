// utils/orderTransitions.js — the single transactional implementation of an
// order status change, shared by the customer cancellation endpoint and the
// admin status endpoint.
//
// WHY A SHARED MODULE
// Cancellation restocks inventory. If the admin path and the customer path each
// grew their own copy of that logic, one of them would eventually drift (miss a
// lock, restock twice, or restock outside the status-change transaction). There
// is exactly one implementation, and both callers own the transaction.
//
// INVARIANTS ENFORCED HERE
//  1. The caller has already locked the order row (SELECT ... FOR UPDATE), so
//     concurrent transitions on the same order serialize.
//  2. The transition is validated against ALLOWED_TRANSITIONS. Terminal states
//     allow none, which is what makes "cancel exactly once" true: a second
//     cancel gets 409 BEFORE any restock runs.
//  3. Status update + status event + restock all happen in the SAME transaction,
//     so they commit or roll back together.
//  4. Restock runs in ascending productId order, matching checkout's lock order,
//     so a cancellation can never deadlock a concurrent purchase.
const { stockDelta } = require("./sqlLiterals");
const Product = require("../models/product");
const ProductVariant = require("../models/productVariant");
const OrderItem = require("../models/orderItem");
const OrderStatusEvent = require("../models/orderStatusEvent");
const { syncProductStock } = require("./variants");
const { HttpError } = require("./apiError");
const { ALLOWED_TRANSITIONS } = require("./orderStatus");

/**
 * Restores stock for every line of an order.
 *
 * - Variant lines increment the variant row; Products.stock is then recomputed
 *   as SUM(active variant stock), because it is only a cache for products that
 *   have variants.
 * - A product with no variants still restocks its legacy Products.stock.
 * - Lines whose product was deleted are skipped. A line whose variant was
 *   deleted (variantId SET NULL, snapshot kept) is also skipped: there is no
 *   live row to restore, and restoring the base product would be wrong.
 *
 * Lock order is ascending productId, then ascending variantId — the same order
 * checkout uses — so cancellation can never deadlock a concurrent purchase.
 */
async function restockOrderItems(orderId, transaction) {
  const sequelize = Product.sequelize;
  const items = await OrderItem.findAll({
    where: { orderId },
    order: [["productId", "ASC"], ["id", "ASC"]],
    transaction
  });

  const itemsByProduct = new Map();
  for (const item of items) {
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1) {
      // Not user-triggerable: qty is a validated positive INT column.
      throw new Error(`Non-integer order item quantity during restock: ${item.qty}`);
    }
    if (item.productId === null) continue;
    if (!itemsByProduct.has(item.productId)) itemsByProduct.set(item.productId, []);
    itemsByProduct.get(item.productId).push(item);
  }

  for (const productId of [...itemsByProduct.keys()].sort((a, b) => a - b)) {
    const product = await Product.findByPk(productId, {
      transaction,
      lock: transaction.LOCK.UPDATE
    });
    if (!product) continue;

    const productItems = itemsByProduct.get(productId);
    const variantCount = await ProductVariant.count({ where: { productId }, transaction });

    if (variantCount > 0) {
      const qtyByVariant = new Map();
      for (const item of productItems) {
        if (item.variantId === null) continue; // deleted variant or legacy base line
        qtyByVariant.set(item.variantId, (qtyByVariant.get(item.variantId) || 0) + Number(item.qty));
      }
      for (const variantId of [...qtyByVariant.keys()].sort((a, b) => a - b)) {
        const qty = qtyByVariant.get(variantId);
        await ProductVariant.update(
          { stock: sequelize.literal(stockDelta("+", qty)) },
          { where: { id: variantId, productId }, transaction }
        );
      }
      await syncProductStock(productId, transaction);
      continue;
    }

    // No variants exist for this product: only legacy base lines restock the
    // product row. Variant snapshots without a live variant have no row to
    // restore and are intentionally skipped.
    const qty = productItems
      .filter((item) => item.variantId === null && !item.variantSku)
      .reduce((sum, item) => sum + Number(item.qty), 0);
    if (qty > 0) {
      await Product.update(
        { stock: sequelize.literal(stockDelta("+", qty)) },
        { where: { id: productId }, transaction }
      );
    }
  }
}

/**
 * Applies a validated status transition, records the history event, and
 * restocks on cancellation. Returns the previous status so the caller can
 * notify the customer with an accurate "from -> to".
 *
 * @param {object} order      locked Order instance (inside `transaction`)
 * @param {string} nextStatus one of STATUS_VALUES
 * @param {string|null} note  optional history note
 * @param {object} transaction open Sequelize transaction
 */
async function applyStatusTransition(order, nextStatus, note, transaction) {
  const allowed = ALLOWED_TRANSITIONS[order.status] || [];
  if (!allowed.includes(nextStatus)) {
    throw new HttpError(409, `Cannot change order status from '${order.status}' to '${nextStatus}'`);
  }

  const previous = order.status;
  await order.update({ status: nextStatus }, { transaction });
  await OrderStatusEvent.create(
    { orderId: order.id, fromStatus: previous, toStatus: nextStatus, note: note || null },
    { transaction }
  );

  if (nextStatus === "cancelled") {
    await restockOrderItems(order.id, transaction);
  }

  return previous;
}

/** True when the customer/admin may still cancel this order. */
function canCancel(status) {
  return (ALLOWED_TRANSITIONS[status] || []).includes("cancelled");
}

module.exports = { applyStatusTransition, restockOrderItems, canCancel };
