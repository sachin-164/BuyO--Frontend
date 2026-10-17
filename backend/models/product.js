// models/product.js — MySQL (Sequelize), unified with the rest of the backend
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Product = sequelize.define("Product", {
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  category: {
    type: DataTypes.STRING,
    allowNull: false
  },
  description: {
    type: DataTypes.TEXT
  },
  mrpPrice: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  sellingPrice: {
    type: DataTypes.FLOAT,
    allowNull: false
  },
  image: {
    type: DataTypes.STRING // URL or /uploads/<filename>
  }
}, {
  timestamps: true
});

module.exports = Product;
