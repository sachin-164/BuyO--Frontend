// models/productVariant.js — size/colour SKUs for a product (checklist 20–22).
//
// DESIGN
// - Products without variants keep the legacy Products.stock column and behave
//   exactly as before.
// - Once a product has variants, the variant rows own the inventory. The
//   legacy Products.stock column is maintained as an aggregate cache
//   (SUM of active variant stock) so existing list filters, analytics and
//   quick-add checks keep working. utils/variants.syncProductStock is the only
//   writer of that cache.
// - SKUs are stored upper-cased by the API and uniquely constrained by the
//   database, so MySQL's case-insensitive collation and PostgreSQL's
//   case-sensitive one enforce the same customer-visible rule.
// - Variants are deactivated (isActive = false), never hard-deleted; historical
//   order items keep their own snapshots.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Product = require("./product");

const ProductVariant = sequelize.define(
  "ProductVariant",
  {
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    sku: {
      type: DataTypes.STRING(64),
      allowNull: false,
      unique: true
    },
    size: {
      type: DataTypes.STRING(40),
      allowNull: true
    },
    color: {
      type: DataTypes.STRING(40),
      allowNull: true
    },
    priceAdjustment: {
      type: DataTypes.DECIMAL(10, 2),
      allowNull: false,
      defaultValue: 0
    },
    stock: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    },
    isActive: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true
    }
  },
  {
    timestamps: true,
    indexes: [
      // Mirrors idx_product_variants_product in migration 010 so a sync-built
      // database matches a migration-built one.
      { name: "idx_product_variants_product", fields: ["productId", "isActive"] }
    ]
  }
);

Product.hasMany(ProductVariant, {
  foreignKey: { name: "productId", allowNull: false },
  as: "variants",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
ProductVariant.belongsTo(Product, {
  foreignKey: { name: "productId", allowNull: false },
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});

ProductVariant.MAX_VARIANTS_PER_PRODUCT = 20;

module.exports = ProductVariant;
