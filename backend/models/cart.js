// models/cart.js — MySQL (Sequelize)
// One row = one item in a user's cart (qty can grow on repeat adds)
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./user");
const ProductVariant = require("./productVariant");

const CartItem = sequelize.define("CartItem", {
  productId: {
    type: DataTypes.INTEGER,
    allowNull: true // allows "guest" items seeded from localStorage
  },
  // NULL = the legacy/base product line (only valid when the product has no
  // active variants). A variant line always belongs to the same product.
  variantId: {
    type: DataTypes.INTEGER,
    allowNull: true
  },
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  price: {
    type: DataTypes.FLOAT,
    defaultValue: 0
  },
  image: {
    type: DataTypes.STRING
  },
  qty: {
    type: DataTypes.INTEGER,
    defaultValue: 1
  }
}, {
  timestamps: true
});

User.hasMany(CartItem, { foreignKey: { allowNull: false }, onDelete: "CASCADE" });
CartItem.belongsTo(User);

// ON DELETE SET NULL: a cart line survives a removed variant but becomes
// invalid (the API flags it) instead of disappearing silently.
CartItem.belongsTo(ProductVariant, {
  foreignKey: { name: "variantId", allowNull: true },
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});

module.exports = CartItem;
