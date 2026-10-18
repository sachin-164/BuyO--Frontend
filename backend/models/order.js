// models/order.js — Phase 6: COD orders with purchase snapshots + idempotency.
// - Totals + taxBreakdown (JSON) are snapshotted at purchase time.
// - shippingAddress (JSON) snapshots the full address at checkout; addressId
//   is provenance only (ON DELETE SET NULL).
// - uq_orders_user_idem (userId, idempotencyKey) makes checkout retries
//   return the existing order instead of creating a duplicate.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./user");
const Address = require("./address");
const OrderItem = require("./orderItem");
const OrderStatusEvent = require("./orderStatusEvent");
const { STATUS_VALUES } = require("../utils/orderStatus");

const Order = sequelize.define("Order", {
  orderNumber: { type: DataTypes.STRING(20), allowNull: false },
  idempotencyKey: { type: DataTypes.STRING(64), allowNull: false },
  status: { type: DataTypes.ENUM(...STATUS_VALUES), allowNull: false, defaultValue: "placed" },
  paymentMethod: { type: DataTypes.ENUM("cod"), allowNull: false, defaultValue: "cod" },
  subtotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  taxTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0.0 },
  grandTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  taxBreakdown: { type: DataTypes.JSON, allowNull: true },
  shippingAddress: { type: DataTypes.JSON, allowNull: false },
  addressId: { type: DataTypes.INTEGER, allowNull: true },
  notes: { type: DataTypes.STRING(500), allowNull: true }
}, {
  tableName: "Orders",
  timestamps: true,
  indexes: [
    { name: "uq_orders_number", unique: true, fields: ["orderNumber"] },
    { name: "uq_orders_user_idem", unique: true, fields: ["userId", "idempotencyKey"] },
    { name: "idx_orders_user", fields: ["userId", "createdAt"] },
    { name: "idx_orders_status", fields: ["status"] },
    { name: "idx_orders_address", fields: ["addressId"] }
  ]
});

User.hasMany(Order, { foreignKey: { name: "userId", allowNull: false }, onDelete: "CASCADE" });
Order.belongsTo(User, { foreignKey: { name: "userId", allowNull: false } });
Address.hasMany(Order, { foreignKey: { name: "addressId", allowNull: true }, onDelete: "SET NULL" });
Order.belongsTo(Address, { foreignKey: { name: "addressId", allowNull: true } });

Order.hasMany(OrderItem, { foreignKey: { name: "orderId", allowNull: false }, onDelete: "CASCADE" });
OrderItem.belongsTo(Order, { foreignKey: { name: "orderId", allowNull: false } });
Order.hasMany(OrderStatusEvent, { foreignKey: { name: "orderId", allowNull: false }, onDelete: "CASCADE" });
OrderStatusEvent.belongsTo(Order, { foreignKey: { name: "orderId", allowNull: false } });

module.exports = Order;
