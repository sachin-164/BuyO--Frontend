// models/productImage.js — ordered product gallery (checklist item 32).
//
// The legacy Products.image column stays the PRIMARY image for compatibility:
// it is always kept equal to the first gallery row (position 0). Galleries are
// optional — a product with no rows renders from Products.image alone.
//
// ON DELETE CASCADE is enforced by the database, so removing a product can
// never leave orphaned image rows behind.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Product = require("./product");

const ProductImage = sequelize.define(
  "ProductImage",
  {
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    url: {
      type: DataTypes.STRING(500),
      allowNull: false
    },
    alt: {
      type: DataTypes.STRING(255),
      allowNull: true
    },
    position: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0
    }
  },
  {
    timestamps: true,
    indexes: [
      // Mirrors index `idx_product_images_product_position` in migration 008 so
      // a sync-built database matches a migration-built one.
      { name: "idx_product_images_product_position", fields: ["productId", "position"] }
    ]
  }
);

// `as: "images"` is the public API shape (product.images).
Product.hasMany(ProductImage, {
  foreignKey: { name: "productId", allowNull: false },
  as: "images",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
ProductImage.belongsTo(Product, {
  foreignKey: { name: "productId", allowNull: false },
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});

ProductImage.MAX_IMAGES = 8;

module.exports = ProductImage;
