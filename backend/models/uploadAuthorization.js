// models/uploadAuthorization.js — durable single-use upload authorization.
//
// One row authorizes ONE server-generated object path for ONE admin, with the
// validated mimetype/size and a hard expiry. The row is DELETED on the first
// consumption attempt (successful or not), so a path can never be replayed,
// used by another admin, or used after expiry.
//
// Why the database: Vercel is multi-instance and the previous in-memory ledger
// was per-process — an authorize call could land on instance A while the
// product create landed on instance B. A shared row removes that failure mode
// and survives process restarts. Consumption uses SELECT ... FOR UPDATE plus a
// DELETE inside one transaction, which serializes concurrent take() calls.
const { DataTypes } = require("sequelize");
const sequelize = require("../config/db");
const User = require("./user");

const UploadAuthorization = sequelize.define(
  "UploadAuthorization",
  {
    objectPath: {
      type: DataTypes.STRING(255),
      allowNull: false
    },
    adminId: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    mimetype: {
      type: DataTypes.STRING(100),
      allowNull: false
    },
    size: {
      type: DataTypes.INTEGER,
      allowNull: false
    },
    expiresAt: {
      type: DataTypes.DATE,
      allowNull: false
    }
  },
  {
    tableName: "UploadAuthorizations",
    timestamps: true,
    indexes: [
      // Mirrors migration 012 so a sync-built database matches a
      // migration-built one exactly (unique index, not a table constraint).
      { name: "uq_upload_authorizations_object_path", unique: true, fields: ["objectPath"] },
      { name: "idx_upload_authorizations_expires", fields: ["expiresAt"] }
    ]
  }
);

// Deleting an admin also invalidates any upload they authorized but did not
// use yet. On update stays CASCADE to match the other models.
User.hasMany(UploadAuthorization, {
  foreignKey: { name: "adminId", allowNull: false },
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});
UploadAuthorization.belongsTo(User, {
  foreignKey: { name: "adminId", allowNull: false },
  onDelete: "CASCADE",
  onUpdate: "CASCADE"
});

module.exports = UploadAuthorization;
