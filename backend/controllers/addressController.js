// controllers/addressController.js — per-user address book (Phase 6)
// - Every query is scoped by userId = req.user.id; foreign/missing addresses
//   return 404 (no existence disclosure).
// - "One default per user" is enforced inside a transaction that locks the
//   user's row (same serialization pattern as the cart), because MySQL has no
//   partial unique indexes for a per-user default flag.
// - Phone numbers are stored normalized (spaces/hyphens stripped); all other
//   fields are stored exactly as validated (trimmed by validate.js).
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const User = require("../models/user");
const Address = require("../models/address");
const { HttpError, parsePositiveId } = require("../utils/apiError");

async function lockUser(userId, transaction) {
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
}

function findOwnedAddress(id, userId, transaction) {
  return Address.findOne({ where: { id, userId }, transaction });
}

async function demoteOtherDefaults(userId, keepId, transaction) {
  const where = { userId, isDefault: true };
  if (keepId !== null) where.id = { [Op.ne]: keepId };
  await Address.update({ isDefault: false }, { where, transaction });
}

function normalizePhone(phone) {
  return String(phone).replace(/[\s-]/g, "");
}

const ADDRESS_FIELDS = ["label", "fullName", "phone", "line1", "line2", "city", "state", "pincode"];

// ---------- GET /api/addresses ----------
const getAddresses = async (req, res, next) => {
  try {
    const addresses = await Address.findAll({
      where: { userId: req.user.id },
      order: [["isDefault", "DESC"], ["id", "ASC"]]
    });
    res.json({ success: true, count: addresses.length, addresses });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/addresses ----------
const createAddress = async (req, res, next) => {
  try {
    const body = { ...req.body };
    body.phone = normalizePhone(body.phone);

    const address = await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const existingCount = await Address.count({ where: { userId: req.user.id }, transaction });
      // Explicit isDefault wins; otherwise the FIRST address becomes default.
      const makeDefault = body.isDefault === undefined ? existingCount === 0 : body.isDefault === true;
      if (makeDefault) await demoteOtherDefaults(req.user.id, null, transaction);

      return Address.create(
        { userId: req.user.id, ...body, isDefault: makeDefault },
        { transaction }
      );
    });

    res.status(201).json({ success: true, message: "Address saved", address });
  } catch (err) {
    next(err);
  }
};

// ---------- PUT /api/addresses/:id ----------
const updateAddress = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "address id");
    const body = { ...req.body };
    if (body.phone !== undefined) body.phone = normalizePhone(body.phone);

    const address = await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const row = await findOwnedAddress(id, req.user.id, transaction);
      if (!row) throw new HttpError(404, "Address not found");

      // Un-defaulting the only default is refused; set another one instead.
      if (body.isDefault === false && row.isDefault) {
        throw new HttpError(400, "Validation failed", ["Set another address as default first"]);
      }
      if (body.isDefault === true) await demoteOtherDefaults(req.user.id, row.id, transaction);

      const updates = {};
      for (const field of ADDRESS_FIELDS) {
        if (body[field] !== undefined) updates[field] = body[field];
      }
      if (body.isDefault !== undefined) updates.isDefault = body.isDefault;

      await row.update(updates, { transaction });
      return row;
    });

    res.json({ success: true, message: "Address updated", address });
  } catch (err) {
    next(err);
  }
};

// ---------- DELETE /api/addresses/:id ----------
const deleteAddress = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "address id");

    await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const row = await findOwnedAddress(id, req.user.id, transaction);
      if (!row) throw new HttpError(404, "Address not found");
      const wasDefault = row.isDefault;
      await row.destroy({ transaction });

      // Keep exactly one default when the default address is deleted.
      if (wasDefault) {
        const nextDefault = await Address.findOne({
          where: { userId: req.user.id },
          order: [["id", "ASC"]],
          transaction
        });
        if (nextDefault) await nextDefault.update({ isDefault: true }, { transaction });
      }
    });

    res.json({ success: true, message: "Address deleted" });
  } catch (err) {
    next(err);
  }
};

// ---------- PUT /api/addresses/:id/default ----------
const setDefaultAddress = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "address id");

    const address = await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const row = await findOwnedAddress(id, req.user.id, transaction);
      if (!row) throw new HttpError(404, "Address not found");

      await demoteOtherDefaults(req.user.id, row.id, transaction);
      await row.update({ isDefault: true }, { transaction });
      return row;
    });

    res.json({ success: true, message: "Default address updated", address });
  } catch (err) {
    next(err);
  }
};

module.exports = { getAddresses, createAddress, updateAddress, deleteAddress, setDefaultAddress };
