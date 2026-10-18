// controllers/wishlistController.js — wishlist (Phase 5)
//
// DESIGN NOTES
// - Every route requires auth; all queries are scoped by UserId = req.user.id,
//   so users can never see or modify each other's wishlists (foreign items
//   simply 404).
// - Dedup: the schema has NO unique index on (UserId, productId), so add
//   toggles run inside a transaction that first locks the user's row
//   (SELECT ... FOR UPDATE) — serializing this user's wishlist mutations —
//   then checks for an existing row before inserting. Add is idempotent:
//   a repeat add returns 200 "Already in wishlist" without a second row.
// - Rows keep the legacy name/price/image snapshot columns (updated at write
//   time), but list responses always prefer the live product values.
const sequelize = require("../config/db");
const User = require("../models/user");
const WishlistItem = require("../models/wishlist");
const Product = require("../models/product");
const { toMoney } = require("../utils/pricing");
const { HttpError, parsePositiveId } = require("../utils/apiError");

async function lockUser(userId, transaction) {
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
}

async function requireProduct(productId, transaction) {
  const product = await Product.findByPk(productId, { transaction });
  if (!product) throw new HttpError(400, "Validation failed", ["productId must reference an existing product"]);
  return product;
}

// ---------- GET /api/wishlist ----------
const getWishlist = async (req, res, next) => {
  try {
    const rows = await WishlistItem.findAll({ where: { UserId: req.user.id }, order: [["id", "ASC"]] });

    const productIds = [...new Set(rows.map((row) => row.productId).filter((id) => id !== null))];
    const products = productIds.length ? await Product.findAll({ where: { id: productIds } }) : [];
    const productById = new Map(products.map((product) => [product.id, product]));

    const items = rows.map((row) => {
      const product = row.productId === null ? null : (productById.get(row.productId) || null);
      if (!product) {
        return {
          id: row.id,
          productId: row.productId,
          name: row.name,
          price: null,
          image: row.image,
          inStock: false,
          unavailable: true
        };
      }
      return {
        id: row.id,
        productId: product.id,
        name: product.name,
        price: toMoney(product.sellingPrice),
        image: product.image,
        inStock: product.stock > 0,
        unavailable: false
      };
    });

    res.json({ success: true, count: items.length, items });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/wishlist — add (idempotent) ----------
const addToWishlist = async (req, res, next) => {
  try {
    const { productId } = req.body;

    const { item, created } = await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const existing = await WishlistItem.findOne({
        where: { UserId: req.user.id, productId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (existing) return { item: existing, created: false };

      const product = await requireProduct(productId, transaction);
      const wishlistItem = await WishlistItem.create(
        {
          UserId: req.user.id,
          productId,
          name: product.name,
          price: toMoney(product.sellingPrice),
          image: product.image
        },
        { transaction }
      );
      return { item: wishlistItem, created: true };
    });

    res.status(created ? 201 : 200).json({
      success: true,
      message: created ? "Added to wishlist" : "Already in wishlist",
      inWishlist: true,
      item
    });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/wishlist/toggle — add or remove ----------
const toggleWishlist = async (req, res, next) => {
  try {
    const { productId } = req.body;

    const added = await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const existing = await WishlistItem.findOne({
        where: { UserId: req.user.id, productId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (existing) {
        await existing.destroy({ transaction });
        return false;
      }

      const product = await requireProduct(productId, transaction);
      await WishlistItem.create(
        {
          UserId: req.user.id,
          productId,
          name: product.name,
          price: toMoney(product.sellingPrice),
          image: product.image
        },
        { transaction }
      );
      return true;
    });

    const count = await WishlistItem.count({ where: { UserId: req.user.id } });
    res.json({ success: true, inWishlist: added, count });
  } catch (err) {
    next(err);
  }
};

// ---------- DELETE /api/wishlist/:productId — remove ----------
const removeFromWishlist = async (req, res, next) => {
  try {
    const productId = parsePositiveId(req.params.productId, "product id");

    await sequelize.transaction(async (transaction) => {
      await lockUser(req.user.id, transaction);

      const existing = await WishlistItem.findOne({
        where: { UserId: req.user.id, productId },
        transaction
      });
      if (!existing) throw new HttpError(404, "Item not in wishlist");
      await existing.destroy({ transaction });
    });

    res.json({ success: true, message: "Removed from wishlist", inWishlist: false });
  } catch (err) {
    next(err);
  }
};

// ---------- GET /api/wishlist/products/:productId — membership check ----------
const checkWishlist = async (req, res, next) => {
  try {
    const productId = parsePositiveId(req.params.productId, "product id");
    const item = await WishlistItem.findOne({ where: { UserId: req.user.id, productId } });
    res.json({ success: true, productId, inWishlist: Boolean(item) });
  } catch (err) {
    next(err);
  }
};

module.exports = { getWishlist, addToWishlist, toggleWishlist, removeFromWishlist, checkWishlist };
