// controllers/cartController.js — server-authoritative cart (Phase 5 + items 20–22)
//
// DESIGN NOTES
// - Every route requires auth; all queries are scoped by UserId = req.user.id
//   so one user can never read or modify another user's cart (foreign or
//   missing items simply return 404 — never 403 with existence hints).
// - Duplicate lines are prevented transactionally: every mutation first locks
//   the user's row (SELECT ... FOR UPDATE on `users`), which serializes that
//   user's cart operations, then upserts inside the transaction. A line's
//   identity is (productId, variantId): a product without variants keeps the
//   legacy NULL variantId line, while each variant is its own line.
//   PostgreSQL additionally has a unique index on
//   (UserId, productId, variantId); MySQL stays app-level under the user lock.
// - Prices/taxes are always recomputed from Products + ProductVariants +
//   Categories via utils/pricing.js. The stored name/price/image columns on
//   cart rows remain write-time snapshots for legacy compatibility only.
// - A product that currently has active variants MUST be bought by variant.
//   A stale base line is kept visible but marked unavailable, never silently
//   converted or priced as the base product.
// - Guest carts stay client-side; merge replays these same rules and reports
//   skipped/clamped lines so the shopper can be told what changed.
const sequelize = require("../config/db");
const User = require("../models/user");
const CartItem = require("../models/cart");
const Product = require("../models/product");
const ProductVariant = require("../models/productVariant");
const Category = require("../models/category");
const { toMoney, buildTotals } = require("../utils/pricing");
const { variantUnitPrice } = require("../utils/variants");
const { HttpError, parsePositiveId } = require("../utils/apiError");

const MAX_LINE_QTY = 99;
const MAX_MERGE_ITEMS = 50;
const categoryInclude = [{ model: Category, as: "Category" }];

// Serializes this user's cart mutations for the duration of the transaction.
async function lockUserCart(userId, transaction) {
  await User.findByPk(userId, { transaction, lock: transaction.LOCK.UPDATE });
}

function variantInfo(variant) {
  return variant
    ? {
        id: variant.id,
        sku: variant.sku,
        size: variant.size || null,
        color: variant.color || null
      }
    : null;
}

/**
 * Builds the full cart response (items + authoritative totals) for a user.
 * Prices/stock always come from the live product/variant rows, never from the
 * stored snapshots, and stale variant lines are flagged instead of hidden.
 */
async function buildCartResponse(userId) {
  const rows = await CartItem.findAll({ where: { UserId: userId }, order: [["id", "ASC"]] });

  const productIds = [...new Set(rows.map((row) => row.productId).filter((id) => id !== null))];
  const variantIds = [...new Set(rows.map((row) => row.variantId).filter((id) => id !== null))];

  const [products, rowVariants, activeVariants] = await Promise.all([
    productIds.length
      ? Product.findAll({ where: { id: productIds }, include: categoryInclude })
      : [],
    variantIds.length ? ProductVariant.findAll({ where: { id: variantIds } }) : [],
    productIds.length
      ? ProductVariant.findAll({ where: { productId: productIds, isActive: true } })
      : []
  ]);

  const productById = new Map(products.map((product) => [product.id, product]));
  const variantById = new Map(rowVariants.map((variant) => [variant.id, variant]));
  const activeByProduct = new Map();
  for (const variant of activeVariants) {
    if (!activeByProduct.has(variant.productId)) activeByProduct.set(variant.productId, []);
    activeByProduct.get(variant.productId).push(variant);
  }

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
        variantId: row.variantId,
        variant: variantInfo(variantById.get(row.variantId)),
        qty: row.qty,
        name: row.name,
        price: null,
        image: row.image,
        lineTotal: 0,
        stock: null,
        stockExceeded: false,
        unavailable: true,
        unavailableReason: "product_unavailable"
      });
      continue;
    }

    let variant = null;
    let unavailableReason = null;

    if (row.variantId !== null) {
      variant = variantById.get(row.variantId) || null;
      if (!variant || variant.productId !== product.id) {
        variant = null;
        unavailableReason = "variant_unavailable";
      } else if (!variant.isActive) {
        unavailableReason = "variant_inactive";
      }
    } else if ((activeByProduct.get(product.id) || []).length > 0) {
      // The product now requires a size/colour choice; this old base line must
      // not be bought at the base price.
      unavailableReason = "variant_required";
    }

    if (unavailableReason) {
      items.push({
        id: row.id,
        productId: product.id,
        variantId: row.variantId,
        variant: variantInfo(variant),
        qty: row.qty,
        name: product.name,
        price: null,
        image: product.image,
        lineTotal: 0,
        stock: null,
        stockExceeded: false,
        unavailable: true,
        unavailableReason
      });
      continue;
    }

    const unitPrice =
      row.variantId !== null
        ? variantUnitPrice(product.sellingPrice, variant.priceAdjustment)
        : Number(product.sellingPrice);
    const stock = row.variantId !== null ? Number(variant.stock) : Number(product.stock);

    items.push({
      id: row.id,
      productId: product.id,
      variantId: row.variantId,
      variant: variantInfo(variant),
      qty: row.qty,
      name: product.name,
      price: toMoney(unitPrice),
      image: product.image,
      lineTotal: toMoney(unitPrice * row.qty),
      stock,
      stockExceeded: row.qty > stock,
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

async function loadActiveVariants(productId, transaction, lock = false) {
  return ProductVariant.findAll({
    where: { productId, isActive: true },
    order: [["id", "ASC"]],
    ...(transaction ? { transaction } : {}),
    ...(lock ? { lock: transaction.LOCK.UPDATE } : {})
  });
}

/**
 * Resolves the purchasable line for a product/variant pair.
 * - variantId provided: it must exist, belong to this product and be active.
 * - variantId absent: only valid when the product has no active variants.
 * Returns { variant, stock, unitPrice }.
 */
async function resolveSellableLine(product, variantId, activeVariants) {
  if (variantId !== null && variantId !== undefined) {
    const variant = activeVariants.find((candidate) => candidate.id === variantId);
    if (!variant) {
      const exists = await ProductVariant.findOne({
        where: { id: variantId, productId: product.id }
      });
      throw new HttpError(400, "Validation failed", [
        exists
          ? "The selected size/colour is no longer available"
          : "The selected size/colour does not belong to this product"
      ]);
    }
    if (Number(variant.stock) <= 0) {
      throw new HttpError(400, "Validation failed", ["The selected size/colour is out of stock"]);
    }
    return {
      variant,
      stock: Number(variant.stock),
      unitPrice: variantUnitPrice(product.sellingPrice, variant.priceAdjustment)
    };
  }

  if (activeVariants.length > 0) {
    throw new HttpError(400, "Validation failed", [
      "Select a size or colour option for this product"
    ]);
  }
  if (Number(product.stock) <= 0) {
    throw new HttpError(400, "Validation failed", ["This product is out of stock"]);
  }
  return { variant: null, stock: Number(product.stock), unitPrice: Number(product.sellingPrice) };
}

function snapshotFor(product, variant, unitPrice) {
  return {
    name: product.name,
    price: toMoney(unitPrice),
    image: product.image,
    variantId: variant ? variant.id : null
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

// ---------- POST /api/cart — add (or increment) a product/variant ----------
const addToCart = async (req, res, next) => {
  try {
    const { productId, qty = 1 } = req.body;
    const variantId = req.body.variantId === undefined ? null : req.body.variantId;

    const item = await sequelize.transaction(async (transaction) => {
      await lockUserCart(req.user.id, transaction);

      const product = await Product.findByPk(productId, { transaction });
      if (!product) {
        throw new HttpError(400, "Validation failed", ["productId must reference an existing product"]);
      }

      const activeVariants = await loadActiveVariants(productId, transaction, true);
      const line = await resolveSellableLine(product, variantId, activeVariants);

      // A line is (UserId, productId, variantId); NULL = base product line.
      const rows = await CartItem.findAll({
        where: { UserId: req.user.id, productId, variantId: line.variant ? line.variant.id : null },
        order: [["id", "ASC"]],
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      const existingQty = rows.reduce((sum, row) => sum + row.qty, 0);

      if (existingQty + qty > line.stock) {
        throw new HttpError(400, "Validation failed", [
          `Only ${line.stock} unit(s) of this item are in stock` +
            (existingQty ? ` — you already have ${existingQty} in your cart` : "")
        ]);
      }

      const snapshot = snapshotFor(product, line.variant, line.unitPrice);

      if (!rows.length) {
        return CartItem.create(
          { UserId: req.user.id, productId, ...snapshot, qty },
          { transaction }
        );
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

      const activeVariants = await loadActiveVariants(cartItem.productId, transaction, true);
      let variant = null;
      if (cartItem.variantId !== null) {
        variant = activeVariants.find((candidate) => candidate.id === cartItem.variantId) || null;
        if (!variant) {
          throw new HttpError(400, "Validation failed", [
            "The selected size/colour is no longer available. Remove this line and choose another."
          ]);
        }
      } else if (activeVariants.length > 0) {
        throw new HttpError(400, "Validation failed", [
          "This product now requires a size/colour choice. Remove this line and choose an option."
        ]);
      }

      const stock = variant ? Number(variant.stock) : Number(product.stock);
      if (qty > stock) {
        throw new HttpError(400, "Validation failed", [`Only ${stock} unit(s) of this item are in stock`]);
      }

      await cartItem.update(
        { qty, ...snapshotFor(product, variant, variant ? variantUnitPrice(product.sellingPrice, variant.priceAdjustment) : product.sellingPrice) },
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
//   - duplicate (productId, variantId) pairs in one payload are summed
//   - quantities are clamped to available variant/product stock, never exceeded
//   - products/variants that no longer exist (or are out of stock) are skipped
//     and reported, so the client can tell the shopper what was dropped
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
      let variantId = null;
      if (entry.variantId !== undefined && entry.variantId !== null) {
        variantId = Number(entry.variantId);
        if (!Number.isInteger(variantId) || variantId <= 0 || variantId > 2147483647) {
          throw new HttpError(400, "Validation failed", [
            `items[${index}].variantId must be a positive integer or null`
          ]);
        }
      }
      const qty = entry.qty === undefined ? 1 : Number(entry.qty);
      if (!Number.isInteger(qty) || qty < 1 || qty > MAX_LINE_QTY) {
        throw new HttpError(400, "Validation failed", [
          `items[${index}].qty must be an integer between 1 and ${MAX_LINE_QTY}`
        ]);
      }
      // Two guest lines for the same exact identity (possible after a tab race)
      // are one cart line once merged.
      const key = `${productId}:${variantId === null ? 0 : variantId}`;
      const current = wanted.get(key);
      wanted.set(key, {
        productId,
        variantId,
        qty: Math.min(MAX_LINE_QTY, (current ? current.qty : 0) + qty)
      });
    }

    const skipped = [];
    const clamped = [];
    const merged = [];

    // Ascending productId then variantId keeps lock order deterministic (same
    // discipline as checkout/restock) so concurrent merges cannot deadlock.
    const entries = [...wanted.values()].sort(
      (a, b) => a.productId - b.productId || (a.variantId || 0) - (b.variantId || 0)
    );

    await sequelize.transaction(async (transaction) => {
      await lockUserCart(req.user.id, transaction);

      for (const entry of entries) {
        const { productId, variantId, qty: guestQty } = entry;
        const product = await Product.findByPk(productId, { transaction, lock: transaction.LOCK.UPDATE });
        if (!product) {
          skipped.push({ productId, variantId, reason: "not_found" });
          continue;
        }

        const activeVariants = await loadActiveVariants(productId, transaction, true);
        let variant = null;
        if (variantId !== null) {
          variant = activeVariants.find((candidate) => candidate.id === variantId) || null;
          if (!variant) {
            skipped.push({ productId, variantId, reason: "variant_unavailable" });
            continue;
          }
          if (Number(variant.stock) <= 0) {
            skipped.push({ productId, variantId, reason: "out_of_stock" });
            continue;
          }
        } else if (activeVariants.length > 0) {
          skipped.push({ productId, variantId: null, reason: "variant_required" });
          continue;
        } else if (Number(product.stock) <= 0) {
          skipped.push({ productId, variantId: null, reason: "out_of_stock" });
          continue;
        }

        const available = variant ? Number(variant.stock) : Number(product.stock);
        const unitPrice = variant
          ? variantUnitPrice(product.sellingPrice, variant.priceAdjustment)
          : Number(product.sellingPrice);

        const rows = await CartItem.findAll({
          where: { UserId: req.user.id, productId, variantId: variant ? variant.id : null },
          order: [["id", "ASC"]],
          transaction,
          lock: transaction.LOCK.UPDATE
        });
        const existingQty = rows.reduce((sum, row) => sum + row.qty, 0);
        const requested = existingQty + guestQty;
        const targetQty = Math.min(requested, available, MAX_LINE_QTY);

        if (requested > targetQty) {
          clamped.push({
            productId,
            variantId: variant ? variant.id : null,
            available: Math.min(available, MAX_LINE_QTY),
            requested
          });
        }
        if (targetQty <= existingQty) {
          // Already at the ceiling: keep the cart line as it is.
          continue;
        }

        const snapshot = snapshotFor(product, variant, unitPrice);
        if (!rows.length) {
          await CartItem.create(
            { UserId: req.user.id, productId, ...snapshot, qty: targetQty },
            { transaction }
          );
        } else {
          const [primary, ...duplicates] = rows;
          for (const duplicate of duplicates) {
            await duplicate.destroy({ transaction });
          }
          await primary.update({ qty: targetQty, ...snapshot }, { transaction });
        }
        merged.push({
          productId,
          variantId: variant ? variant.id : null,
          qty: targetQty,
          added: targetQty - existingQty
        });
      }
    });

    const cart = await buildCartResponse(req.user.id);
    res.json({ success: true, message: "Cart merged", merged, skipped, clamped, ...cart });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  getCart,
  addToCart,
  updateCartItem,
  removeFromCart,
  mergeCart,
  MAX_LINE_QTY,
  MAX_MERGE_ITEMS
};
