// controllers/adminCustomerController.js — Phase A: admin customer directory.
//
// SCOPE / SAFETY
// - Admin-only (guarded at the router by requireAuth + requireAdmin).
// - Only the whitelisted public fields are ever selected: `password` is never
//   loaded, so it cannot leak through a serializer mistake.
// - Search is case-insensitive on BOTH dialects: MySQL's default collation is
//   already case-insensitive, PostgreSQL is not, so the comparison is done on
//   LOWER(column) rather than relying on collation.
// - LIKE wildcards in the search term are stripped (not escaped), because a
//   literal `%` or `_` is never meaningful in a name or an email address and
//   stripping keeps the generated SQL portable across both dialects.
const { Op, fn, col, where: sqlWhere } = require("sequelize");
const User = require("../models/user");
const Address = require("../models/address");
const Order = require("../models/order");
const OrderItem = require("../models/orderItem");
const { HttpError, parsePositiveId } = require("../utils/apiError");
const { normalizeSearchTerm } = require("../utils/searchTerm");

const CUSTOMER_ATTRIBUTES = ["id", "name", "email", "isVerified", "role", "createdAt"];
const RECENT_ORDER_LIMIT = 20;

function searchWhere(term) {
  const like = `%${term.toLowerCase()}%`;
  return {
    [Op.or]: [
      sqlWhere(fn("LOWER", col("name")), { [Op.like]: like }),
      sqlWhere(fn("LOWER", col("email")), { [Op.like]: like })
    ]
  };
}

// One grouped query per page (grouped by userId + status) instead of N+1
// per-customer queries. Cancelled orders count toward `orderCount` but not
// toward `totalSpend`, matching the analytics definition of order value.
async function orderStatsByUser(userIds) {
  const stats = new Map();
  if (!userIds.length) return stats;

  const rows = await Order.findAll({
    attributes: [
      "userId",
      "status",
      [fn("COUNT", col("id")), "count"],
      [fn("SUM", col("grandTotal")), "total"],
      [fn("MAX", col("createdAt")), "lastOrderAt"]
    ],
    where: { userId: { [Op.in]: userIds } },
    group: ["userId", "status"],
    raw: true
  });

  for (const row of rows) {
    const entry = stats.get(row.userId) || {
      orderCount: 0,
      cancelledCount: 0,
      totalSpend: 0,
      lastOrderAt: null
    };
    const count = Number(row.count) || 0;
    entry.orderCount += count;
    if (row.status === "cancelled") {
      entry.cancelledCount += count;
    } else {
      entry.totalSpend += Number(row.total) || 0;
    }
    const last = row.lastOrderAt ? new Date(row.lastOrderAt) : null;
    if (last && (!entry.lastOrderAt || last > entry.lastOrderAt)) entry.lastOrderAt = last;
    stats.set(row.userId, entry);
  }

  for (const entry of stats.values()) {
    entry.totalSpend = Math.round(entry.totalSpend * 100) / 100;
  }
  return stats;
}

function withStats(user, stats) {
  const entry = stats.get(user.id) || {
    orderCount: 0,
    cancelledCount: 0,
    totalSpend: 0,
    lastOrderAt: null
  };
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    isVerified: user.isVerified,
    role: user.role,
    createdAt: user.createdAt,
    orderCount: entry.orderCount,
    cancelledCount: entry.cancelledCount,
    totalSpend: entry.totalSpend,
    lastOrderAt: entry.lastOrderAt
  };
}

// ---------- GET /api/admin/customers ----------
const listCustomers = async (req, res, next) => {
  try {
    const page = req.query.page === undefined ? 1 : req.query.page;
    const limit = req.query.limit === undefined ? 20 : req.query.limit;
    const rawQuery = req.query.q;
    const hasSearch = typeof rawQuery === "string" && rawQuery.trim() !== "";
    const term = hasSearch ? normalizeSearchTerm(rawQuery) : null;

    // A query made entirely of LIKE metacharacters is not "no filter" — it is a
    // search that matches nothing. Returning every customer would be a silent
    // privilege escalation of the result set (and a needless full scan).
    if (hasSearch && !term) {
      return res.json({
        success: true,
        count: 0,
        customers: [],
        pagination: { page, limit, total: 0, totalPages: 1, hasNext: false, hasPrev: false }
      });
    }

    const where = { role: "customer" };
    Object.assign(where, term ? searchWhere(term) : {});

    const { count, rows } = await User.findAndCountAll({
      where,
      attributes: CUSTOMER_ATTRIBUTES,
      order: [["createdAt", "DESC"], ["id", "DESC"]],
      limit,
      offset: (page - 1) * limit,
      distinct: true
    });

    const stats = await orderStatsByUser(rows.map((user) => user.id));
    const totalPages = Math.max(1, Math.ceil(count / limit));

    res.json({
      success: true,
      count: rows.length,
      customers: rows.map((user) => withStats(user, stats)),
      pagination: { page, limit, total: count, totalPages, hasNext: page < totalPages, hasPrev: page > 1 }
    });
  } catch (err) {
    next(err);
  }
};

// ---------- GET /api/admin/customers/:id ----------
const getCustomer = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "customer id");
    const user = await User.findByPk(id, { attributes: CUSTOMER_ATTRIBUTES });
    if (!user) throw new HttpError(404, "Customer not found");

    const [addresses, orders, stats] = await Promise.all([
      Address.findAll({ where: { userId: id }, order: [["isDefault", "DESC"], ["id", "ASC"]] }),
      Order.findAll({
        where: { userId: id },
        order: [["createdAt", "DESC"], ["id", "DESC"]],
        limit: RECENT_ORDER_LIMIT,
        attributes: ["id", "orderNumber", "status", "grandTotal", "createdAt"],
        include: [{ model: OrderItem, as: "OrderItems", attributes: ["id"] }]
      }),
      orderStatsByUser([id])
    ]);

    res.json({
      success: true,
      customer: {
        ...withStats(user, stats),
        addresses
      },
      orders: orders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        grandTotal: Number(order.grandTotal),
        createdAt: order.createdAt,
        itemCount: (order.OrderItems || []).length
      }))
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { listCustomers, getCustomer, normalizeSearchTerm, searchWhere };
