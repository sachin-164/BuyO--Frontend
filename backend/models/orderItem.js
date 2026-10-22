// models/orderItem.js — Phase 6: per-line purchase snapshots.
// name/image/unitPrice/taxRate/taxAmount/categoryName are frozen at purchase
// time so historical orders never change when the catalog does.
// productId is ON DELETE SET NULL (order history outlives products).
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Product = require("./product");
const ProductVariant = require("./productVariant");

const OrderItem = sequelize.define("OrderItem", {
  productId: { type: DataTypes.INTEGER, allowNull: true },
  variantId: { type: DataTypes.INTEGER, allowNull: true },
  // Frozen variant snapshots: the product/variant may change or be deactivated
  // later, but the order must keep showing exactly what was bought.
  variantSku: { type: DataTypes.STRING(64), allowNull: true },
  variantSize: { type: DataTypes.STRING(40), allowNull: true },
  variantColor: { type: DataTypes.STRING(40), allowNull: true },
  variantPriceAdjustment: { type: DataTypes.DECIMAL(10, 2), allowNull: true },
  name: { type: DataTypes.STRING(200), allowNull: false },
  image: { type: DataTypes.STRING(500), allowNull: true },
  unitPrice: { type: DataTypes.DECIMAL(10, 2), allowNull: false },
  qty: { type: DataTypes.INTEGER, allowNull: false },
  lineTotal: { type: DataTypes.DECIMAL(12, 2), allowNull: false },
  taxRate: { type: DataTypes.DECIMAL(5, 2), allowNull: false, defaultValue: 0.0 },
  taxAmount: { type: DataTypes.DECIMAL(12, 2), allowNull: false, defaultValue: 0.0 },
  categoryName: { type: DataTypes.STRING(100), allowNull: true }
}, {
  tableName: "OrderItems",
  timestamps: true,
  indexes: [
    { name: "idx_order_items_order", fields: ["orderId"] },
    { name: "idx_order_items_product", fields: ["productId"] }
  ]
});

OrderItem.belongsTo(Product, { foreignKey: { name: "productId", allowNull: true }, onDelete: "SET NULL" });
OrderItem.belongsTo(ProductVariant, {
  foreignKey: { name: "variantId", allowNull: true },
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});

module.exports = OrderItem;
