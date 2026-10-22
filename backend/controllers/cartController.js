// controllers/cartController.js — server-authoritative cart (Phase 5)
//
// DESIGN NOTES
// - Every route requires auth; all queries are scoped by UserId = req.user.id
//   so one user can never read or modify another user's cart (foreign or
//   missing items simply return 404 — never 403 with existence hints).
// - The schema has NO unique index on (UserId, productId) and Phase 5 forbids
//   schema changes, so duplicates are prevented transactionally: every
//   mutation first locks the user's row (SELECT ... FOR UPDATE on `users`),
//   which serializes that user's cart operations, then upserts inside the
//   transaction. Any legacy duplicate rows are merged (and the extras
//   deleted) on the next add — self-healing without a migration.
//   (A composite unique index on (UserId, productId) is a good future
//   migration once schema changes are allowed again.)
// - Prices/taxes are always recomputed from Products + Categories via
//   utils/pricing.js. The stored name/price/image columns on cart rows are
//   kept as write-time snapshots for legacy compatibility, never for totals.
// - Guest carts: NO guest-token system. The browser keeps the guest cart in
//   localStorage (as today) and, after login, the client will send those
//   items to a future merge endpoint that replays these same upserts.
//   See docs/guest-cart-merge.md.
const sequelize = require("../config/db");
const User = require("../models/user");
const CartItem = require("../models/cart");
const Product = require("../models/product");
const Category = require("../models/category");
const { toMoney, buildTotals } = require("../utils/pricing");
const { HttpError, parsePositiveId } = require("../utils/apiError");

const MAX_LINE_QTY = 99;
const MAX_MERGE_ITEMS = 50;
const categoryInclude = [{ model: Category, as: "Category" }];

// Serializes this user's cart mutations for the duration of the transaction.
async function lockUserCart(userId, transaction) {
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
}

// Builds the full cart response (items + authoritative totals) for a user.
async function buildCartResponse(userId) {
  const rows = await CartItem.findAll({ where: { UserId: userId }, order: [["id", "ASC"]] });

  const productIds = [...new Set(rows.map((row) => row.productId).filter((id) => id !== null))];
  const products = productIds.length
    ? await Product.findAll({ where: { id: productIds }, include: categoryInclude })
    : [];
  const productById = new Map(products.map((product) => [product.id, product]));

  const items = [];
  const totalLines = [];

  for (const row of rows) {
    const product = row.productId === null ? null : (productById.get(row.productId) || null);

    if (!product) {
      // Product deleted (or legacy guest row): keep the line visible but
      // exclude it from totals and flag it for the UI.
      items.push({
        id: row.id,
        productId: row.productId,
        qty: row.qty,
        name: row.name,
        price: null,
        image: row.image,
        lineTotal: 0,
        stock: null,
        stockExceeded: false,
        unavailable: true
      });
      continue;
    }

    const unitPrice = Number(product.sellingPrice);
    items.push({
      id: row.id,
      productId: product.id,
      qty: row.qty,
      name: product.name,
      price: toMoney(unitPrice),
      image: product.image,
      lineTotal: toMoney(unitPrice * row.qty),
      stock: product.stock,
      stockExceeded: row.qty > product.stock,
      unavailable: false
    });
    totalLines.push({
      unitPrice,
      qty: row.qty,
      categoryId: product.categoryId,
      categoryName: product.Category ? product.Category.name : null,
      taxRate: product.Category ? Number(product.Category.taxRate) : 0
    });
  }

  return {
    count: items.length,
    items,
    totals: buildTotals(totalLines),
    totalsNotice: "Preview only — final totals (including applicable GST) are calculated server-side at checkout."
  };
}

// ---------- GET /api/cart ----------
const getCart = async (req, res, next) => {
  try {
    const cart = await buildCartResponse(req.user.id);
    res.json({ success: true, ...cart });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/cart — add (or increment) a product ----------
const addToCart = async (req, res, next) => {
  try {
    const { productId, qty = 1 } = req.body;

    const item = await sequelize.transaction(async (transaction) => {
      await lockUserCart(req.user.id, transaction);

      const product = await Product.findByPk(productId, { transaction });
      if (!product) {
        throw new HttpError(400, "Validation failed", ["productId must reference an existing product"]);
      }
      if (product.stock <= 0) {
        throw new HttpError(400, "Validation failed", ["This product is out of stock"]);
      }

      const rows = await CartItem.findAll({
        where: { UserId: req.user.id, productId },
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const existingQty = rows.reduce((sum, row) => sum + row.qty, 0);

      if (existingQty + qty > product.stock) {
        throw new HttpError(400, "Validation failed", [
          `Only ${product.stock} unit(s) of this product are in stock` +
            (existingQty ? ` — you already have ${existingQty} in your cart` : "")
        ]);
      }

      // Refresh the legacy snapshot columns from the authoritative product row.
      const snapshot = { name: product.name, price: toMoney(product.sellingPrice), image: product.image };

      if (!rows.length) {
        return CartItem.create({ UserId: req.user.id, productId, qty, ...snapshot }, { transaction });
      }

      // Merge legacy duplicates (self-heal) and increment the primary row.
      const [primary, ...duplicates] = rows;
      for (const duplicate of duplicates) {
        await duplicate.destroy({ transaction });
      }
      await primary.update({ qty: existingQty + qty, ...snapshot }, { transaction });
      return primary;
    });

    const cart = await buildCartResponse(req.user.id);
    res.status(201).json({ success: true, message: "Item added to cart", item, ...cart });
  } catch (err) {
    next(err);
  }
};

// ---------- PUT /api/cart/:id — update quantity ----------
const updateCartItem = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "cart item id");
    const { qty } = req.body;

    const item = await sequelize.transaction(async (transaction) => {
      await lockUserCart(req.user.id, transaction);

      // Scoped by UserId: other users' items 404 (no existence disclosure).
      const cartItem = await CartItem.findOne({
        where: { id, UserId: req.user.id },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!cartItem) throw new HttpError(404, "Cart item not found");
      if (cartItem.productId === null) {
        throw new HttpError(400, "Validation failed", ["This cart item has no linked product"]);
      }

      const product = await Product.findByPk(cartItem.productId, { transaction });
      if (!product) throw new HttpError(400, "Validation failed", ["This product is no longer available"]);
      if (qty > product.stock) {
        throw new HttpError(400, "Validation failed", [`Only ${product.stock} unit(s) of this product are in stock`]);
      }

      await cartItem.update(
        { qty, name: product.name, price: toMoney(product.sellingPrice), image: product.image },
        { transaction }
      );
      return cartItem;
    });

    const cart = await buildCartResponse(req.user.id);
    res.json({ success: true, message: "Cart updated", item, ...cart });
  } catch (err) {
    next(err);
  }
};

// ---------- DELETE /api/cart/:id — remove one line ----------
const removeFromCart = async (req, res, next) => {
  try {
    const id = parsePositiveId(req.params.id, "cart item id");

    await sequelize.transaction(async (transaction) => {
      await lockUserCart(req.user.id, transaction);

      const cartItem = await CartItem.findOne({ where: { id, UserId: req.user.id }, transaction });
      if (!cartItem) throw new HttpError(404, "Cart item not found");
      await cartItem.destroy({ transaction });
    });

    const cart = await buildCartResponse(req.user.id);
    res.json({ success: true, message: "Item removed from cart", ...cart });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/cart/merge — absorb the browser's guest cart ----------
// Items are replayed through the same locked upsert as addToCart:
//   - duplicate productIds in one payload are summed
//   - quantities are clamped to available stock, never exceeded
//   - products that no longer exist (or are out of stock) are skipped and
//     reported, so the client can tell the shopper what was dropped
// Re-submitting an empty list is a no-op, which makes the client flow safe to
// retry after a partial failure.
const mergeCart = async (req, res, next) => {
  try {
    const raw = req.body.items;
    if (!Array.isArray(raw)) {
      throw new HttpError(400, "Validation failed", ["items must be an array"]);
    }
    if (raw.length > MAX_MERGE_ITEMS) {
      throw new HttpError(400, "Validation failed", [`items may contain at most ${MAX_MERGE_ITEMS} entries`]);
    }

    const wanted = new Map();
    for (let index = 0; index < raw.length; index += 1) {
      const entry = raw[index];
      if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
        throw new HttpError(400, "Validation failed", [`items[${index}] must be an object`]);
      }
      const productId = Number(entry.productId);
      if (!Number.isInteger(productId) || productId <= 0 || productId > 2147483647) {
        throw new HttpError(400, "Validation failed", [`items[${index}].productId must be a positive integer`]);
      }
      const qty = entry.qty === undefined ? 1 : Number(entry.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY) {
        throw new HttpError(400, "Validation failed", [
          `items[${index}].qty must be an integer between 1 and ${MAX_LINE_QTY}`
        ]);
      }
      // Two guest lines for the same product (possible after a tab race) are
      // one cart line once merged.
      wanted.set(productId, Math.min(MAX_LINE_QTY, (wanted.get(productId) || 0) + qty));
    }

    const skipped = [];
    const clamped = [];
    const merged = [];

    await sequelize.transaction(async (transaction) => {
      await lockUserCart(req.user.id, transaction);

      for (const [productId, guestQty] of wanted) {
        const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!product) {
          skipped.push({ productId, reason: "not_found" });
          continue;
        }
        if (product.stock <= 0) {
          skipped.push({ productId, reason: "out_of_stock" });
          continue;
        }

        const rows = await CartItem.findAll({
          where: { UserId: req.user.id, productId },
          order: [["id", "ASC"]],
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        const existingQty = rows.reduce((sum, row) => sum + row.qty, 0);
        const requested = existingQty + guestQty;
        const targetQty = Math.min(requested, product.stock, MAX_LINE_QTY);

        if (requested > targetQty) {
          clamped.push({ productId, available: Math.min(product.stock, MAX_LINE_QTY), requested });
        }
        if (targetQty <= existingQty) {
          // Already at the ceiling: keep the cart line as it is.
          continue;
        }

        const snapshot = { name: product.name, price: toMoney(product.sellingPrice), image: product.image };
        if (!rows.length) {
          await CartItem.create({ UserId: req.user.id, productId, qty: targetQty, ...snapshot }, { transaction });
        } else {
          const [primary, ...duplicates] = rows;
          for (const duplicate of duplicates) {
            await duplicate.destroy({ transaction });
          }
          await primary.update({ qty: targetQty, ...snapshot }, { transaction });
        }
        merged.push({ productId, qty: targetQty, added: targetQty - existingQty });
      }
    });

    const cart = await buildCartResponse(req.user.id);
    res.json({ success: true, message: "Cart merged", merged, skipped, clamped, ...cart });
  } catch (err) {
    next(err);
  }
};

module.exports = { getCart, addToCart, updateCartItem, removeFromCart, mergeCart, MAX_LINE_QTY, MAX_MERGE_ITEMS };
