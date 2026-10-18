// models/address.js — Phase 6: per-user shipping addresses.
// FK column is explicitly `userId` (matches migration 004); index names are
// explicit so sync-built test DBs and the migrated DB stay equivalent.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./user");

const Address = sequelize.define("Address", {
  label: { type: DataTypes.STRING(50), allowNull: true },
  fullName: { type: DataTypes.STRING(100), allowNull: false },
  phone: { type: DataTypes.STRING(15), allowNull: false },
  line1: { type: DataTypes.STRING(255), allowNull: false },
  line2: { type: DataTypes.STRING(255), allowNull: true },
  city: { type: DataTypes.STRING(100), allowNull: false },
  state: { type: DataTypes.STRING(100), allowNull: false },
  pincode: { type: DataTypes.STRING(10), allowNull: false },
  // "One default per user" is enforced app-level inside a transaction
  // (MySQL has no partial unique indexes).
  isDefault: { type: DataTypes.BOOLEAN, allowNull: false, defaultValue: false }
}, {
  tableName: "Addresses",
  timestamps: true,
  indexes: [{ name: "idx_addresses_user", fields: ["userId"] }]
});

User.hasMany(Address, { foreignKey: { name: "userId", allowNull: false }, onDelete: "CASCADE" });
Address.belongsTo(User, { foreignKey: { name: "userId", allowNull: false } });

module.exports = Address;
