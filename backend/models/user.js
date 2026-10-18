const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");

const User = sequelize.define("User", {
  name: {
    type: DataTypes.STRING,
    allowNull: false
  },
  email: {
    type: DataTypes.STRING,
    unique: true,
    allowNull: false
  },
  password: {
    type: DataTypes.STRING,
    allowNull: false
  },
  isVerified: {
    type: DataTypes.BOOLEAN,
    defaultValue: false
  },
  // Phase 3: database-backed authorization role. Public signup always creates
  // "customer"; admins are granted ONLY via the audited provisioning script
  // (scripts/admin-role.js) — never through the API.
  role: {
    type: DataTypes.ENUM("customer", "admin"),
    allowNull: false,
    defaultValue: "customer"
  }
}, {
  timestamps: true
});

module.exports = User;
