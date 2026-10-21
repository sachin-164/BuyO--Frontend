// controllers/adminOrderController.js — admin order management (Phase 6)
// Guarded by requireAuth + requireAdmin (DB-backed `Users.role = 'admin'`,
// verified email required — admin authorization fails closed).
//
// STATUS UPDATES — single transaction:
//  1. Lock the order row (SELECT ... FOR UPDATE): two concurrent cancels
//     serialize here, so exactly one of them can perform the transition.
//  2. Validate the transition against ALLOWED_TRANSITIONS; terminal states
//     (delivered, cancelled) allow none — a second cancel gets 409 BEFORE any
//     restock, guaranteeing stock is restored exactly once.
//  3. Update Orders.status + append an OrderStatusEvents row; on cancellation
//     restock every item (ascending productId) in the SAME transaction, so
//     status change + event + restock commit or roll back together.
// (No DB uniqueness on (orderId, toStatus): history must stay able to record
// future legitimate repeated statuses — see migration 004 header.)
const sequelize = require("../config/db");
const { Op, fn, col, where: sqlWhere } = require("sequelize");
const { stockDelta } = require("../utils/sqlLiterals");
const User = require("../models/user");
const Product = require("../models/product");
const Order = require("../models/order");
const OrderItem = require("../models/orderItem");
const OrderStatusEvent = require("../models/orderStatusEvent");
const { HttpError, parsePositiveId } = require("../utils/apiError");
const { ALLOWED_TRANSITIONS } = require("../utils/orderStatus");
const { normalizeSearchTerm } = require("../utils/searchTerm");

const itemInclude = [{ model: OrderItem, as: "OrderItems", order: [["id", "ASC"]] }];
const eventInclude = [{ model: OrderStatusEvent, as: "OrderStatusEvents", order: [["id", "ASC"]] }];
const userInclude = [{ model: User, as: "User", attributes: ["id", "name", "email"] }];

// Free-text search: matches the order number OR the owning customer's name /
// email. The customer match runs as an IN-subquery rather than a WHERE on the
// joined User row, so `limit`/`offset` and `distinct` counting keep operating
// on Orders alone (a join-level filter with subQuery:false can truncate pages
// mid-order when an order has many items).
function buildSearchCondition(term) {
  const like = `%${term.toLowerCase()}%`;
  const qg = sequelize.getQueryInterface().queryGenerator;
  const usersTable = qg.quoteTable(User.getTableName());
  const idCol = qg.quoteIdentifier("id");
  const nameCol = qg.quoteIdentifier("name");
  const emailCol = qg.quoteIdentifier("email");
  const escapedLike = sequelize.escape(like); // dialect-correct string literal

  return {
    [Op.or]: [
      sqlWhere(fn("LOWER", col("orderNumber")), { [Op.like]: like }),
      sqlWhere(col("userId"), {
        [Op.in]: sequelize.literal(
          `(SELECT ${idCol} FROM ${usersTable} WHERE ` +
            `LOWER(${nameCol}) LIKE ${escapedLike} OR LOWER(${emailCol}) LIKE ${escapedLike})`
        )
      })
    ]
  };
}

function serializeAdminOrder(order) {
  const base = require("./orderController").serializeOrder(order);
  return {
    ...base,
    userId: order.userId,
    user: order.User ? { id: order.User.id, name: order.User.name, email: order.User.email } : null
  };
}

// ---------- GET /api/admin/orders ----------
const listAdminOrders = async (req, res, next) => {
  try {
    const { status } = req.query;
    const page = req.query.page === undefined ? 1 : req.query.page;
    const limit = req.query.limit === undefined ? 20 : req.query.limit;
    const rawQuery = req.query.q;
    const hasSearch = typeof rawQuery === "string" && rawQuery.trim() !== "";
    const term = hasSearch ? normalizeSearchTerm(rawQuery) : null;

    // Wildcard-only queries match nothing rather than everything (see the
    // customer directory for the same reasoning).
    if (hasSearch && !term) {
      return res.json({
        success: true,
        count: 0,
        orders: [],
        pagination: { page, limit, total: 0, totalPages: 1, hasNext: false, hasPrev: false }
      });
    }

    const where = {};
    if (status) where.status = status;
    if (term) Object.assign(where, buildSearchCondition(term));

    // distinct:true counts DISTINCT Orders.id — without it the hasMany
    // OrderItems include multiplies rows (1 order with 3 items counted as 3),
    // inflating pagination.total and creating phantom trailing pages (P10-1,
    // reproduced + regression-tested in Phase 11).
    const { count, rows } = await Order.findAndCountAll({
      where,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true,
      include: [...itemInclude, ...userInclude]
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
        userId: order.userId,
        user: order.User ? { id: order.User.id, name: order.User.name, email: order.User.email } : null,
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

// ---------- GET /api/admin/orders/:id ----------
const getAdminOrder = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "order id");
    const order = await Order.findByPk(id, {
      include: [...itemInclude, ...eventInclude, ...userInclude]
    });
    if (!order) throw new HttpError(404, "Order not found");
    res.json({ success: true, order: serializeAdminOrder(order) });
  } catch (err) {
    next(err);
  }
};

// ---------- PUT /api/admin/orders/:id/status ----------
const updateOrderStatus = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "order id");
    const { status, note } = req.body;

    const orderId = await sequelize.transaction(async (transaction) => {
      // Lock the order row: concurrent status changes serialize here.
      const order = await Order.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
      if (!order) throw new HttpError(404, "Order not found");

      const allowed = ALLOWED_TRANSITIONS[order.status] || [];
      if (!allowed.includes(status)) {
        throw new HttpError(409, `Cannot change order status from '${order.status}' to '${status}'`);
      }

      const previous = order.status;
      await order.update({ status }, { transaction });
      await OrderStatusEvent.create(
        { orderId: order.id, fromStatus: previous, toStatus: status, note: note || null },
        { transaction }
      );

      // Cancellation restocks — same transaction as the status change.
      if (status === "cancelled") {
        const items = await OrderItem.findAll({
          where: { orderId: order.id },
          order: [["productId", "ASC"], ["id", "ASC"]],
          transaction
        });
        for (const item of items) {
          if (item.productId === null) continue; // product deleted -> nothing to restock
          const qty = Number(item.qty);
          if (!Number.isInteger(qty) || qty < 1) {
            throw new Error(`Non-integer order item quantity during restock: ${item.qty}`); // 500; not user-triggerable (DB INT)
          }
          await Product.update(
            { stock: sequelize.literal(stockDelta("+", qty)) },
            { where: { id: item.productId }, transaction }
          );
        }
      }

      return order.id;
    });

    const order = await Order.findByPk(orderId, {
      include: [...itemInclude, ...eventInclude, ...userInclude]
    });
    res.json({ success: true, message: `Order status changed to '${status}'`, order: serializeAdminOrder(order) });
  } catch (err) {
    next(err);
  }
};

module.exports = { listAdminOrders, getAdminOrder, updateOrderStatus };
