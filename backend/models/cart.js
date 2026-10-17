// models/cart.js — MySQL (Sequelize)
// One row = one item in a user's cart (qty can grow on repeat adds)
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./user");

const CartItem = sequelize.define("CartItem", {
  productId: {
    type: DataTypes.INTEGER,
    allowNull: true // allows "guest" items seeded from localStorage
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

module.exports = CartItem;
