// lib/uploadLedger.js — durable single-use upload-authorization ledger.
//
// When an admin calls POST /api/uploads/authorize, the server records the
// validated facts of ONE pending upload (object path, admin id, authorized
// mimetype + size, expiry) in the database. The product create/update handler
// only accepts an image that carries such a row: take() is atomic and
// single-use, so a path can never be replayed, reused by another admin, or
// used after expiry.
//
// The state is shared through PostgreSQL/MySQL, not process memory: Vercel may
// run several instances, and an authorize request can be served by a different
// instance than the product write. The row also survives cold starts.
"use strict";

const { Op } = require("sequelize");
const sequelize = require("../config/db");
const UploadAuthorization = require("../models/uploadAuthorization");

const DEFAULT_MAX_ENTRIES = 500;

class UploadLedger {
  constructor({ maxEntries = DEFAULT_MAX_ENTRIES, model = UploadAuthorization } = {}) {
    this.maxEntries = maxEntries;
    this.model = model;
  }

  // Returns { status: "ok" | "full", expiresAt? }. "full" refuses new
  // authorizations instead of growing without bound. The cap is a safety
  // valve, not a security boundary; a rare cross-instance race may exceed it
  // by a few rows, which the next prune removes.
  async put(objectPath, { adminId, mimetype, size, ttlMs, now = Date.now() }) {
    const expiresAt = new Date(now + ttlMs);
    const nowDate = new Date(now);

    await this.model.destroy({ where: { expiresAt: { [Op.lte]: nowDate } } });
    const active = await this.model.count({ where: { expiresAt: { [Op.gt]: nowDate } } });
    if (active >= this.maxEntries) return { status: "full" };

    await this.model.create({ objectPath, adminId, mimetype, size, expiresAt });
    return { status: "ok", expiresAt };
  }

  // Atomic single-use consumption. The row is removed on EVERY take, even
  // when rejected (expired / wrong admin) — a failed attempt can never leave a
  // reusable credential behind. SELECT ... FOR UPDATE serializes two instances
  // racing to consume the same path.
  async take(objectPath, adminId, now = Date.now()) {
    const nowDate = new Date(now);
    return sequelize.transaction(async (transaction) => {
      const row = await this.model.findOne({
        where: { objectPath },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!row) return { status: "missing" };

      const entry = {
        adminId: Number(row.adminId),
        mimetype: row.mimetype,
        size: Number(row.size),
        expiresAt: row.expiresAt
      };
      await row.destroy({ transaction });

      if (entry.expiresAt.getTime() <= nowDate.getTime()) return { status: "expired" };
      if (entry.adminId !== Number(adminId)) return { status: "forbidden", entry };
      return { status: "ok", entry };
    });
  }

  // Test/maintenance helpers. Production code never calls these.
  async clear() {
    await this.model.destroy({ where: {} });
  }

  async size() {
    return this.model.count();
  }
}

// Shared instance used by the routes/controller. The state itself lives in the
// database, so separate processes see the same authorizations.
const uploadLedger = new UploadLedger();

module.exports = { UploadLedger, uploadLedger };
