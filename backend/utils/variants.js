// utils/variants.js — shared variant rules (checklist 20–22).
//
// One implementation for:
//   - SKU normalisation/validation (upper-case; DB uniqueness matches the
//     customer-visible rule on both MySQL and PostgreSQL),
//   - size/colour option validation,
//   - the variant unit price (base selling price + documented delta),
//   - the Products.stock aggregate cache used by list filters/analytics.
const Product = require("../models/product");
const ProductVariant = require("../models/productVariant");
const { toMoney } = require("./pricing");

const MAX_VARIANTS_PER_PRODUCT = 20;
const MAX_SKU_LENGTH = 64;
const MAX_OPTION_LENGTH = 40;
const MAX_STOCK = 1_000_000_000;
const MAX_PRICE_ADJUSTMENT = 1_000_000;
const SKU_PATTERN = /^[A-Z0-9][A-Z0-9._-]*$/;

function normalizeSku(value) {
  if (typeof value !== "string") return null;
  const sku = value.trim().toUpperCase();
  if (!sku || sku.length > MAX_SKU_LENGTH || !SKU_PATTERN.test(sku)) return null;
  return sku;
}

function normalizeOption(value, label, errors) {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    errors.push(`${label} must be a string`);
    return null;
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_OPTION_LENGTH) {
    errors.push(`${label} must be ${MAX_OPTION_LENGTH} characters or fewer`);
    return null;
  }
  return trimmed;
}

function parseBoolean(value, label, errors) {
  if (value === undefined) return undefined;
  if (typeof value === "boolean") return value;
  if (value === "true" || value === "1" || value === 1) return true;
  if (value === "false" || value === "0" || value === 0) return false;
  errors.push(`${label} must be a boolean`);
  return undefined;
}

/**
 * Validates a create/update payload against the base product price.
 * Returns { errors, values } — values contains only recognised fields.
 * For updates, pass the existing variant so omitted fields keep their value
 * and "at least one option" is evaluated against the merged result.
 */
function validateVariantInput(body, { basePrice, existing = null } = {}) {
  const input = body && typeof body === "object" && !Array.isArray(body) ? body : {};
  const errors = [];

  const size = input.size === undefined ? (existing ? existing.size : null) : normalizeOption(input.size, "Size", errors);
  const color = input.color === undefined ? (existing ? existing.color : null) : normalizeOption(input.color, "Colour", errors);

  let sku = existing ? existing.sku : null;
  if (input.sku !== undefined || !existing) {
    sku = normalizeSku(input.sku);
    if (!sku) {
      errors.push(
        `SKU is required, must be ${MAX_SKU_LENGTH} characters or fewer, and may contain only letters, numbers, dots, dashes and underscores`
      );
    }
  }

  let stock = existing ? existing.stock : 0;
  if (input.stock !== undefined) {
    stock = Number(input.stock);
    if (!Number.isInteger(stock) || stock < 0 || stock > MAX_STOCK) {
      errors.push(`Stock must be a whole number between 0 and ${MAX_STOCK}`);
    }
  }

  let priceAdjustment = existing ? Number(existing.priceAdjustment) : 0;
  if (input.priceAdjustment !== undefined) {
    priceAdjustment = Number(input.priceAdjustment);
    if (!Number.isFinite(priceAdjustment) || Math.abs(priceAdjustment) > MAX_PRICE_ADJUSTMENT) {
      errors.push(`Price adjustment must be a number between -${MAX_PRICE_ADJUSTMENT} and ${MAX_PRICE_ADJUSTMENT}`);
    } else {
      priceAdjustment = toMoney(priceAdjustment);
    }
  }

  const isActive = parseBoolean(input.isActive, "isActive", errors);
  const resolvedActive = isActive === undefined ? (existing ? Boolean(existing.isActive) : true) : isActive;

  if (!size && !color) {
    errors.push("A variant needs at least one of size or colour");
  }

  if (Number.isFinite(Number(basePrice)) && Number.isFinite(priceAdjustment)) {
    const unitPrice = toMoney(Number(basePrice) + priceAdjustment);
    if (unitPrice <= 0) {
      errors.push("The variant price (base price + adjustment) must be greater than 0");
    }
  }

  return {
    errors,
    values: {
      sku,
      size: size || null,
      color: color || null,
      stock,
      priceAdjustment,
      isActive: resolvedActive
    }
  };
}

function variantUnitPrice(basePrice, adjustment) {
  return toMoney(Number(basePrice) + Number(adjustment || 0));
}

/**
 * Recomputes Products.stock from the active variants. Callers must already
 * hold the product row lock (or otherwise serialize writes for that product)
 * inside the same transaction. Inactive variants keep their own stock for a
 * future reactivation but do not contribute to saleable inventory.
 */
async function syncProductStock(productId, transaction) {
  const total = await ProductVariant.sum("stock", {
    where: { productId, isActive: true },
    transaction
  });
  const stock = Number.isFinite(Number(total)) ? Number(total) : 0;
  await Product.update({ stock }, { where: { id: productId }, transaction });
  return stock;
}

module.exports = {
  MAX_VARIANTS_PER_PRODUCT,
  MAX_SKU_LENGTH,
  MAX_OPTION_LENGTH,
  MAX_STOCK,
  MAX_PRICE_ADJUSTMENT,
  normalizeSku,
  validateVariantInput,
  variantUnitPrice,
  syncProductStock
};
