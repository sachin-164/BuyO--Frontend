// models/wishlist.js — MySQL (Sequelize)
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./user");

const WishlistItem = sequelize.define("WishlistItem", {
  productId: {
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
  }
}, {
  timestamps: true
});

User.hasMany(WishlistItem, { foreignKey: { allowNull: false }, onDelete: "CASCADE" });
WishlistItem.belongsTo(User);

module.exports = WishlistItem;
