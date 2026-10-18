// models/orderStatusEvent.js — Phase 6: append-only order status history.
// NO uniqueness on (orderId, toStatus) by design (see migration 004 header):
// duplicate-cancellation protection lives in the locked order row + validated
// transitions + one transaction, and the table must be able to represent
// future legitimate repeated statuses.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const { STATUS_VALUES } = require("../utils/orderStatus");

const OrderStatusEvent = sequelize.define("OrderStatusEvent", {
  fromStatus: { type: DataTypes.ENUM(...STATUS_VALUES), allowNull: true },
  toStatus: { type: DataTypes.ENUM(...STATUS_VALUES), allowNull: false },
  note: { type: DataTypes.STRING(500), allowNull: true }
}, {
  tableName: "OrderStatusEvents",
  timestamps: true,
  indexes: [{ name: "idx_status_events_order", fields: ["orderId", "createdAt"] }]
});

module.exports = OrderStatusEvent;
