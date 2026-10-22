// controllers/variantController.js — admin variant management (items 20–22).
//
// All routes are mounted under /api/products/:id/variants and guarded by
// requireAuth + requireAdmin. Public storefront reads only the active variants
// embedded in GET /api/products/:identifier (never this controller).
//
// INVARIANTS
// - Every write runs in a transaction that first locks the parent product row,
//   so concurrent variant writes and checkouts serialize per product.
// - After every create/update/deactivation Products.stock is recomputed as
//   SUM(active variant stock) via utils/variants.syncProductStock.
// - SKUs are normalised to upper-case and uniquely constrained by the DB. A
//   duplicate maps to 409 + code DUPLICATE_SKU.
// - Variants are deactivated, not destroyed: order history keeps its snapshots.
const { Op } = require("sequelize");
const sequelize = require("../config/db");
const Product = require("../models/product");
const ProductVariant = require("../models/productVariant");
const { HttpError, parsePositiveId } = require("../utils/apiError");
const {
  MAX_VARIANTS_PER_PRODUCT,
  validateVariantInput,
  variantUnitPrice,
  syncProductStock
} = require("../utils/variants");

function serializeVariant(variant, basePrice) {
  return {
    id: variant.id,
    productId: variant.productId,
    sku: variant.sku,
    size: variant.size,
    color: variant.color,
    priceAdjustment: Number(variant.priceAdjustment),
    unitPrice: variantUnitPrice(basePrice, variant.priceAdjustment),
    stock: Number(variant.stock),
    isActive: Boolean(variant.isActive),
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt
  };
}

async function loadProduct(productId, transaction, lock = false) {
  const product = await Product.findByPk(productId, {
    transaction,
    ...(lock ? { lock: transaction.LOCK.UPDATE } : {})
  });
  if (!product) throw new HttpError(404, "Product not found");
  return product;
}

function validationError(errors) {
  return new HttpError(400, "Validation failed", errors);
}

function duplicateSkuError() {
  const error = new HttpError(409, "A variant with that SKU already exists", [
    "SKU must be unique across the entire catalog"
  ]);
  error.body.code = "DUPLICATE_SKU";
  return error;
}

function isSkuConflict(error) {
  if (!error || error.name !== "SequelizeUniqueConstraintError") return false;
  const fields = Object.keys(error.fields || {});
  return fields.some((field) => /sku/i.test(field)) || /ProductVariants_sku_key|uq_product_variants_sku|sku/i.test(error.message || "");
}

// ---------- GET /api/products/:id/variants (admin: includes inactive) ----------
const listVariants = async (req, res, next) => {
  try {
    const productId = parsePositiveId(req.params.id, "product id");
    const product = await loadProduct(productId);
    const variants = await ProductVariant.findAll({
      where: { productId },
      order: [["isActive", "DESC"], ["id", "ASC"]]
    });
    res.json({
      success: true,
      productId,
      count: variants.length,
      variants: variants.map((variant) => serializeVariant(variant, product.sellingPrice))
    });
  } catch (err) {
    next(err);
  }
};

// ---------- POST /api/products/:id/variants ----------
const createVariant = async (req, res, next) => {
  try {
    const productId = parsePositiveId(req.params.id, "product id");

    const variant = await sequelize.transaction(async (transaction) => {
      const product = await loadProduct(productId, transaction, true);
      const count = await ProductVariant.count({ where: { productId }, transaction });
      if (count >= MAX_VARIANTS_PER_PRODUCT) {
        throw validationError([`A product may have at most ${MAX_VARIANTS_PER_PRODUCT} variants`]);
      }

      const { errors, values } = validateVariantInput(req.body, {
        basePrice: Number(product.sellingPrice)
      });
      if (errors.length) throw validationError(errors);

      const existingSku = await ProductVariant.findOne({ where: { sku: values.sku }, transaction });
      if (existingSku) throw duplicateSkuError();

      const created = await ProductVariant.create({ productId, ...values }, { transaction });
      await syncProductStock(productId, transaction);
      return { created, basePrice: Number(product.sellingPrice) };
    });

    res.status(201).json({
      success: true,
      message: "Variant added",
      variant: serializeVariant(variant.created, variant.basePrice)
    });
  } catch (err) {
    if (isSkuConflict(err)) return next(duplicateSkuError());
    next(err);
  }
};

// ---------- PUT /api/products/:id/variants/:variantId ----------
const updateVariant = async (req, res, next) => {
  try {
    const productId = parsePositiveId(req.params.id, "product id");
    const variantId = parsePositiveId(req.params.variantId, "variant id");

    const outcome = await sequelize.transaction(async (transaction) => {
      const product = await loadProduct(productId, transaction, true);
      const existing = await ProductVariant.findOne({
        where: { id: variantId, productId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!existing) throw new HttpError(404, "Variant not found");

      const { errors, values } = validateVariantInput(req.body, {
        basePrice: Number(product.sellingPrice),
        existing
      });
      if (errors.length) throw validationError(errors);

      if (values.sku !== existing.sku) {
        const conflict = await ProductVariant.findOne({
          where: { sku: values.sku, id: { [Op.ne]: existing.id } },
          transaction
        });
        if (conflict) throw duplicateSkuError();
      }

      await existing.update(values, { transaction });
      await syncProductStock(productId, transaction);
      return { variant: existing, basePrice: Number(product.sellingPrice) };
    });

    res.json({
      success: true,
      message: "Variant updated",
      variant: serializeVariant(outcome.variant, outcome.basePrice)
    });
  } catch (err) {
    if (isSkuConflict(err)) return next(duplicateSkuError());
    next(err);
  }
};

// ---------- DELETE /api/products/:id/variants/:variantId (soft deactivate) ----------
const deactivateVariant = async (req, res, next) => {
  try {
    const productId = parsePositiveId(req.params.id, "product id");
    const variantId = parsePositiveId(req.params.variantId, "variant id");

    const outcome = await sequelize.transaction(async (transaction) => {
      const product = await loadProduct(productId, transaction, true);
      const variant = await ProductVariant.findOne({
        where: { id: variantId, productId },
        transaction,
        lock: transaction.LOCK.UPDATE
      });
      if (!variant) throw new HttpError(404, "Variant not found");
      if (variant.isActive) {
        await variant.update({ isActive: false }, { transaction });
        await syncProductStock(productId, transaction);
      }
      return { variant, basePrice: Number(product.sellingPrice) };
    });

    res.json({
      success: true,
      message: outcome.variant.isActive ? "Variant is already inactive" : "Variant deactivated",
      variant: serializeVariant(outcome.variant, outcome.basePrice)
    });
  } catch (err) {
    next(err);
  }
};

module.exports = {
  listVariants,
  createVariant,
  updateVariant,
  deactivateVariant,
  serializeVariant
};
