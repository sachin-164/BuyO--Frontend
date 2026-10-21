// controllers/adminAnalyticsController.js — Phase A: server-side dashboard
// aggregates.
//
// WHY THIS EXISTS
// The pre-Phase-A dashboard walked capped pages of /api/products and
// /api/admin/orders in the browser (2,500 products / 5,000 orders) and then
// summed the results client-side. Past those caps every figure silently became
// a partial number, and Revenue/AOV could never be trusted. This controller
// computes the same figures with SQL aggregates, so there is no cap and the
// numbers match the database exactly.
//
// PORTABILITY
// Only Sequelize model aggregates are used (no raw table names): the harness
// runs the same suite against MySQL and PostgreSQL, and quoted identifiers
// differ between them. Money columns are DECIMAL, which the drivers return as
// strings — every figure is normalised with Number() before it leaves here.
const { Op, fn, col } = require("sequelize");
const User = require("../models/user");
const Product = require("../models/product");
const Category = require("../models/category");
const Order = require("../models/order");
const OrderItem = require("../models/orderItem");
const { HttpError } = require("../utils/apiError");
const { STATUS_VALUES } = require("../utils/orderStatus");

const LOW_STOCK_THRESHOLD = 5;
const RECENT_ORDER_LIMIT = 5;
const TOP_PRODUCT_LIMIT = 5;
const DEFAULT_RANGE_DAYS = 30;
const MAX_RANGE_DAYS = 365;

function emptyStatusCounts() {
  return STATUS_VALUES.reduce((acc, status) => {
    acc[status] = 0;
    return acc;
  }, {});
}

function toNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function round2(value) {
  return Math.round(toNumber(value) * 100) / 100;
}

// Groups Orders by status server-side. A missing status in the result (no rows
// yet) keeps its zero from emptyStatusCounts().
async function fetchStatusCounts() {
  const rows = await Order.findAll({
    attributes: ["status", [fn("COUNT", col("id")), "count"]],
    group: ["status"],
    raw: true
  });
  const counts = emptyStatusCounts();
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(counts, row.status)) {
      counts[row.status] = toNumber(row.count);
    }
  }
  return counts;
}

function rangeStartDate(days) {
  const start = new Date();
  start.setUTCHours(0, 0, 0, 0);
  start.setUTCDate(start.getUTCDate() - (days - 1));
  return start;
}

// Daily revenue for non-cancelled orders. DATE() is supported by both dialects
// and returns a date-like value; it is normalised to YYYY-MM-DD for the client.
async function fetchRevenueSeries(startDate) {
  const rows = await Order.findAll({
    attributes: [
      [fn("DATE", col("createdAt")), "day"],
      [fn("SUM", col("grandTotal")), "revenue"],
      [fn("COUNT", col("id")), "orders"]
    ],
    where: {
      createdAt: { [Op.gte]: startDate },
      status: { [Op.ne]: "cancelled" }
    },
    group: [fn("DATE", col("createdAt"))],
    order: [[fn("DATE", col("createdAt")), "ASC"]],
    raw: true
  });
  return rows.map((row) => ({
    day: row.day instanceof Date ? row.day.toISOString().slice(0, 10) : String(row.day).slice(0, 10),
    revenue: round2(row.revenue),
    orders: toNumber(row.orders)
  }));
}

// Top products by revenue, computed from purchase snapshots so deleted
// products still report historically-correct figures. Cancelled orders are
// excluded by the required (INNER JOIN) Order include.
async function fetchTopProducts() {
  const rows = await OrderItem.findAll({
    attributes: [
      "productId",
      "name",
      [fn("SUM", col("OrderItem.lineTotal")), "revenue"],
      [fn("SUM", col("OrderItem.qty")), "units"]
    ],
    include: [
      {
        model: Order,
        attributes: [],
        required: true,
        where: { status: { [Op.ne]: "cancelled" } }
      }
    ],
    group: ["OrderItem.productId", "OrderItem.name"],
    order: [[fn("SUM", col("OrderItem.lineTotal")), "DESC"]],
    limit: TOP_PRODUCT_LIMIT,
    raw: true
  });
  return rows.map((row) => ({
    productId: row.productId,
    name: row.name,
    revenue: round2(row.revenue),
    units: toNumber(row.units)
  }));
}

async function fetchLowStock() {
  const [outOfStock, lowStockCount] = await Promise.all([
    Product.count({ where: { stock: { [Op.lte]: 0 } } }),
    Product.count({ where: { stock: { [Op.gt]: 0, [Op.lte]: LOW_STOCK_THRESHOLD } } })
  ]);
  const lowStock = await Product.findAll({
    where: { stock: { [Op.gt]: 0, [Op.lte]: LOW_STOCK_THRESHOLD } },
    order: [["stock", "ASC"], ["id", "ASC"]],
    limit: 6,
    include: [{ model: Category, as: "Category", attributes: ["id", "name"] }]
  });
  return { outOfStock, lowStockCount, lowStock };
}

async function fetchRecentOrders() {
  return Order.findAll({
    order: [["createdAt", "DESC"], ["id", "DESC"]],
    limit: RECENT_ORDER_LIMIT,
    include: [
      { model: User, as: "User", attributes: ["id", "name", "email"] },
      { model: OrderItem, as: "OrderItems", attributes: ["id"] }
    ]
  });
}

// ---------- GET /api/admin/analytics/summary ----------
const getSummary = async (req, res, next) => {
  try {
    const days = req.query.days === undefined ? DEFAULT_RANGE_DAYS : req.query.days;
    if (!Number.isInteger(days) || days < 1 || days > MAX_RANGE_DAYS) {
      throw new HttpError(400, "Validation failed", [
        `days must be an integer between 1 and ${MAX_RANGE_DAYS}`
      ]);
    }
    const startDate = rangeStartDate(days);

    const [
      statusCounts,
      totalOrders,
      nonCancelledValue,
      nonCancelledCount,
      revenueSeries,
      topProducts,
      productTotal,
      categoryTotal,
      customerTotal,
      newCustomers,
      lowStock,
      recentOrders
    ] = await Promise.all([
      fetchStatusCounts(),
      Order.count(),
      Order.sum("grandTotal", { where: { status: { [Op.ne]: "cancelled" } } }),
      Order.count({ where: { status: { [Op.ne]: "cancelled" } } }),
      fetchRevenueSeries(startDate),
      fetchTopProducts(),
      Product.count(),
      Category.count(),
      User.count({ where: { role: "customer" } }),
      User.count({ where: { role: "customer", createdAt: { [Op.gte]: startDate } } }),
      fetchLowStock(),
      fetchRecentOrders()
    ]);

    const grossOrderValue = round2(nonCancelledValue);
    const averageOrderValue = nonCancelledCount > 0 ? round2(grossOrderValue / nonCancelledCount) : 0;

    res.json({
      success: true,
      generatedAt: new Date().toISOString(),
      range: { days, from: startDate.toISOString() },
      products: {
        total: productTotal,
        outOfStock: lowStock.outOfStock,
        lowStockCount: lowStock.lowStockCount,
        lowStockThreshold: LOW_STOCK_THRESHOLD,
        lowStock: lowStock.lowStock.map((product) => ({
          id: product.id,
          name: product.name,
          stock: product.stock,
          image: product.image,
          category: product.Category ? product.Category.name : product.category
        }))
      },
      categories: { total: categoryTotal },
      customers: { total: customerTotal, newInRange: newCustomers },
      orders: {
        total: totalOrders,
        byStatus: statusCounts,
        nonCancelledCount,
        grossOrderValue,
        averageOrderValue
      },
      revenueSeries,
      topProducts,
      recentOrders: recentOrders.map((order) => ({
        id: order.id,
        orderNumber: order.orderNumber,
        status: order.status,
        grandTotal: round2(order.grandTotal),
        createdAt: order.createdAt,
        itemCount: (order.OrderItems || []).length,
        user: order.User
          ? { id: order.User.id, name: order.User.name, email: order.User.email }
          : null
      }))
    });
  } catch (err) {
    next(err);
  }
};

module.exports = { getSummary, LOW_STOCK_THRESHOLD, DEFAULT_RANGE_DAYS, MAX_RANGE_DAYS };
