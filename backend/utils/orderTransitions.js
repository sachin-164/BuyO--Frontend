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
const OrderItem = require("../models/orderItem");
const OrderStatusEvent = require("../models/orderStatusEvent");
const { HttpError } = require("./apiError");
const { ALLOWED_TRANSITIONS } = require("./orderStatus");

/**
 * Restores stock for every line of an order. Lines whose product was deleted
 * (productId === null, ON DELETE SET NULL) are skipped — there is nothing left
 * to restock, and the snapshot keeps the history readable.
 */
async function restockOrderItems(orderId, transaction) {
  const sequelize = Product.sequelize;
  const items = await OrderItem.findAll({
    where: { orderId },
    order: [["productId", "ASC"], ["id", "ASC"]],
    transaction
  });

  for (const item of items) {
    if (item.productId === null) continue;
    const qty = Number(item.qty);
    if (!Number.isInteger(qty) || qty < 1) {
      // Not user-triggerable: qty is a validated positive INT column.
      throw new Error(`Non-integer order item quantity during restock: ${item.qty}`);
    }
    await Product.update(
      { stock: sequelize.literal(stockDelta("+", qty)) },
      { where: { id: item.productId }, transaction }
    );
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
