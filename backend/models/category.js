// models/category.js — MySQL (Sequelize), Phase 3 schema v1
//
// Categories are the canonical product taxonomy: Products.categoryId -> Categories.id.
// taxRate is the configurable per-category tax percentage (e.g. GST) — never hardcoded.
// Legacy free-text Products.category strings are backfilled into this table by
// migration 003; the legacy column itself is kept for backward compatibility.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const Category = sequelize.define("Category", {
  name: {
    type: DataTypes.STRING(100),
    allowNull: false,
    unique: true
  },
  slug: {
    type: DataTypes.STRING(160),
    allowNull: false,
    unique: true
  },
  description: {
    type: DataTypes.TEXT
  },
  taxRate: {
    type: DataTypes.DECIMAL(5, 2), // percentage, e.g. 18.00 — max 999.99
    allowNull: false,
    defaultValue: 0.0
  },
  // Optional self-reference for the taxonomy tree (Phase G). NULL = root.
  // The API enforces a maximum depth and rejects cycles (a plain FK cannot).
  parentId: {
    type: DataTypes.INTEGER,
    allowNull: true
  }
}, {
  timestamps: true
});

// Self-association: one query can load the whole hierarchy; the FK is
// ON DELETE SET NULL so deleting a parent promotes its children to roots
// instead of deleting or orphaning them.
Category.belongsTo(Category, {
  as: "parent",
  foreignKey: { name: "parentId", allowNull: true },
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});
Category.hasMany(Category, {
  as: "children",
  foreignKey: { name: "parentId", allowNull: true },
  onDelete: "SET NULL",
  onUpdate: "CASCADE"
});

module.exports = Category;
