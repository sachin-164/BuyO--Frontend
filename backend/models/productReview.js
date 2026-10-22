// models/productReview.js — moderated customer reviews (checklist 23–25).
//
// - Every review starts `pending`; the API forces this and ignores any status
//   supplied by the customer.
// - Only `approved` rows may be read by public endpoints or included in rating
//   aggregates (enforced in controllers, never by trusting a client filter).
// - (userId, productId) is unique at the database level: one review per
//   customer per product, so a retry cannot create a second row even under a
//   race. Customers have no edit/delete endpoint.
// - moderatedBy/moderatedAt record the administrator and time of the most
//   recent moderation decision.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const Product = require("./product");
const User = require("./user");

const REVIEW_STATUS_VALUES = ["pending", "approved", "rejected"];

const ProductReview = sequelize.define(
  "ProductReview",
  {
    productId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    userId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    rating: {
      // SMALLINT keeps the physical type identical on MySQL and PostgreSQL.
      type: DataTypes.SMALLINT,
      allowNull: false
    },
    title: {
      type: DataTypes.STRING(120),
      allowNull: true
    },
    body: {
      type: DataTypes.TEXT,
      allowNull: false
    },
    status: {
      type: DataTypes.ENUM(...REVIEW_STATUS_VALUES),
      allowNull: false,
      defaultValue: "pending"
    },
    moderatedBy: {
      type: DataTypes.INTEGER,
      allowNull: true
    },
    moderatedAt: {
      type: DataTypes.DATE,
      allowNull: true
    }
  },
  {
    timestamps: true,
    indexes: [
      // Mirrors migration 011: one review per customer per product.
      { name: "uq_product_reviews_user_product", unique: true, fields: ["userId", "productId"] },
      // Public list / moderation queue access path.
      { name: "idx_product_reviews_product_status", fields: ["productId", "status", "createdAt"] }
    ]
  }
);

Product.hasMany(ProductReview, {
  foreignKey: { name: "productId", allowNull: false },
  as: "reviews",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
ProductReview.belongsTo(Product, {
  foreignKey: { name: "productId", allowNull: false },
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});

User.hasMany(ProductReview, {
  foreignKey: { name: "userId", allowNull: false },
  as: "reviews",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
ProductReview.belongsTo(User, {
  foreignKey: { name: "userId", allowNull: false },
  as: "User",
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});

ProductReview.belongsTo(User, {
  foreignKey: { name: "moderatedBy", allowNull: true },
  as: "Moderator",
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});

ProductReview.REVIEW_STATUS_VALUES = REVIEW_STATUS_VALUES;

module.exports = ProductReview;
