// controllers/productController.js — catalog API (Phase 4)
// Public: list (search/filter/sort/pagination), lookup by id or slug.
// Admin: create / update / delete (routed with requireAuth + requireAdmin).
// The legacy free-text `category` string stays fully supported: it is always
// written, kept in sync with `categoryId` on create/update, and still works
// as a filter when no Categories row matches.
const { Op } = require("sequelize");
const fs = require("fs");
const sequelize = require("../config/db");
const Product = require("../models/product");
const ProductImage = require("../models/productImage");
const ProductVariant = require("../models/productVariant");
const CartItem = require("../models/cart");
const Category = require("../models/category");
const { resolveDialect } = require("../config/dbConnectionOptions");
const { slugify, uniqueSlug } = require("../utils/slugify");
const { uniqueConflictMessage } = require("../utils/uniqueErrors");
const { toMoney } = require("../utils/pricing");
// Phase 12: hosted-mode image verification (ledger + stored-object checks).
// Local mode is a byte-identical passthrough inside this helper.
const {
  resolveProductImageValue,
  bestEffortRemoveImage,
  getImageStore
} = require("../lib/imageStore");

const categoryInclude = [{ model: Category, as: "Category" }];
const imagesInclude = { model: ProductImage, as: "images" };
const imagesOrder = [
  [{ model: ProductImage, as: "images" }, "position", "ASC"],
  [{ model: ProductImage, as: "images" }, "id", "ASC"]
];

// Public catalog only ever exposes active variants. A product with no variants
// keeps using Products.stock exactly as before; `hasVariants` tells the
// storefront to require an option choice instead of one-click adding.
const variantsInclude = {
  model: ProductVariant,
  as: "variants",
  required: false,
  where: { isActive: true },
  attributes: ["id", "sku", "size", "color", "priceAdjustment", "stock", "isActive"]
};
const variantsOrder = [[{ model: ProductVariant, as: "variants" }, "id", "ASC"]];

/**
 * Public product JSON: adds the resolved unit price for each active variant
 * and a stable `hasVariants` flag. Existing fields are untouched so legacy
 * clients keep working.
 */
function serializePublicProduct(product) {
  const json = typeof product.toJSON === "function" ? product.toJSON() : product;
  const basePrice = Number(json.sellingPrice);
  const variants = (json.variants || [])
    .filter(Boolean)
    .map((variant) => ({
      ...variant,
      priceAdjustment: Number(variant.priceAdjustment),
      stock: Number(variant.stock),
      unitPrice: toMoney(basePrice + Number(variant.priceAdjustment || 0))
    }))
    .sort((a, b) => a.id - b.id);
  json.variants = variants;
  json.hasVariants = variants.length > 0;
  return json;
}

// Removes a file multer just wrote (only ever used on a failed request).
function removeUploadedFile(file) {
  if (!file || !file.path) return;
  try {
    fs.rmSync(file.path, { force: true });
  } catch (err) {
    console.error("⚠️ failed to remove uploaded file:", err.message);
  }
}

/**
 * Deletes a product image we host, but only when no other product still points
 * at it. Runs AFTER the database write committed, so a failed update can never
 * leave a product referencing a file that is already gone.
 *
 * External URLs and other drivers' references are left alone: they are not ours
 * to delete.
 */
async function releaseImageIfUnused(reference, exceptProductId) {
  if (!reference) return;
  try {
    const store = getImageStore();
    if (!store.isOwnReference(reference)) return;

    const stillUsed = await Product.count({
      where: {
        image: reference,
        ...(exceptProductId ? { id: { [Op.ne]: exceptProductId } } : {})
      }
    });
    // A gallery row of any product also owns the file.
    const usedInGallery = await ProductImage.count({ where: { url: reference } });
    if (stillUsed + usedInGallery > 0) return;

    if (store.driver === "supabase") {
      await store.removeImage({ path: store.objectPathFromOwnReference(reference) });
    } else {
      await store.removeImage({ reference });
    }
  } catch (err) {
    // Best effort: an orphaned file is harmless; a broken product is not.
    console.error("⚠️ replaced image cleanup failed:", err.message);
  }
}

const DEFAULT_SORT = "newest";
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

// Whitelisted sort keys (value = Sequelize order). id as tiebreaker keeps
// pagination stable when createdAt collides (DATETIME is second-precision).
const SORTS = {
  newest: [["createdAt", "DESC"], ["id", "DESC"]],
  oldest: [["createdAt", "ASC"], ["id", "ASC"]],
  price_asc: [["sellingPrice", "ASC"], ["id", "ASC"]],
  price_desc: [["sellingPrice", "DESC"], ["id", "ASC"]],
  name_asc: [["name", "ASC"], ["id", "ASC"]],
  name_desc: [["name", "DESC"], ["id", "ASC"]]
};

// Escapes LIKE wildcards so user input matches literally.
function escapeLike(value) {
  return String(value).replace(/([\\%_])/g, "\\$1");
}

// Resolves the `category` query param to a where-group:
//   numeric        -> by categoryId (+ legacy name of that category, if it exists)
//   slug or name   -> by resolved categoryId OR legacy free-text match
//   no Categories  -> legacy free-text string match (backward compatible)
async function resolveCategoryFilter(param) {
  const trimmed = String(param).trim();

  if (/^\d+$/.test(trimmed)) {
    const id = Number(trimmed);
    if (!Number.isSafeInteger(id) || id <= 0 || id > 2147483647) return { categoryId: -1 };
    const row = await Category.findByPk(id, { attributes: ["id", "name"] });
    if (row) return { [Op.or]: [{ categoryId: row.id }, { category: row.name }] };
    return { categoryId: id };
  }

  const row = await Category.findOne({
    where: { [Op.or]: [{ slug: trimmed }, { name: trimmed }] },
    attributes: ["id", "name"]
  });
  if (row) return { [Op.or]: [{ categoryId: row.id }, { category: row.name }] };
  return { category: trimmed };
}

// ---------- Add Product (POST /api/products, admin-only; body pre-validated) ----------
const addProduct = async (req, res) => {
  // Set only after a direct upload passed verification — drives orphan
  // compensation if the database write then fails.
  let verifiedUploadPath = null;
  try {
    const { name, category, description, mrpPrice, sellingPrice, image, slug, stock, imageMeta, categoryId } = req.body;

    if (sellingPrice > mrpPrice) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["sellingPrice cannot be greater than mrpPrice"]
      });
    }

    const imageUrl = req.file ? `/uploads/${req.file.filename}` : (image || "");

    // Category relationship: explicit FK (existence validated below), explicit
    // null, or auto-link by exact legacy name when no FK was sent.
    let resolvedCategoryId = null;
    if (categoryId === undefined) {
      const matched = await Category.findOne({ where: { name: String(category).trim() } });
      resolvedCategoryId = matched ? matched.id : null;
    } else if (categoryId !== null) {
      const categoryRow = await Category.findByPk(categoryId);
      if (!categoryRow) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: ["categoryId must reference an existing category"]
        });
      }
      resolvedCategoryId = categoryRow.id;
    }

    // Slug: explicit (validated + uniqueness enforced) or generated from the name.
    let productSlug;
    if (slug) {
      const existing = await Product.findOne({ where: { slug }, attributes: ["id"] });
      if (existing) {
        return res.status(409).json({ success: false, message: "A product with that slug already exists" });
      }
      productSlug = slug;
    } else {
      productSlug = await uniqueSlug(Product, slugify(name), "product");
    }

    // Hosted storage (Phase 12): resolve/verify the image LAST, immediately
    // before the write — after every cheap validation (so a slug conflict
    // never consumes the upload) and before the DB write (verify-then-save).
    // Multipart uploads (req.file) skip this: their bytes are already on disk
    // and magic-verified. Local mode resolves to a passthrough.
    let resolvedImage = imageUrl;
    if (!req.file) {
      try {
        const resolved = await resolveProductImageValue(imageUrl, req.user.id);
        resolvedImage = resolved.value;
        verifiedUploadPath = resolved.cleanupPath;
      } catch (err) {
        if (err.exposeToClient) {
          return res.status(err.status).json({ success: false, message: err.publicMessage });
        }
        throw err;
      }
    }

    const product = await Product.create({
      name,
      category,
      description,
      mrpPrice,
      sellingPrice,
      image: resolvedImage,
      slug: productSlug,
      stock: stock === undefined ? 0 : stock,
      imageMeta: imageMeta === undefined ? null : imageMeta,
      categoryId: resolvedCategoryId
    });

    const withCategory = await Product.findByPk(product.id, {
      include: [...categoryInclude, imagesInclude, variantsInclude],
      order: [...imagesOrder, ...variantsOrder]
    });
    res.status(201).json({
      success: true,
      message: "✅ Product added successfully!",
      product: serializePublicProduct(withCategory)
    });
  } catch (error) {
    // DB write failed after a direct upload was verified: best-effort remove
    // the just-uploaded object so it cannot linger as an orphan.
    if (verifiedUploadPath) await bestEffortRemoveImage(verifiedUploadPath);
    // Same for a multipart file: it only becomes the product image on success.
    removeUploadedFile(req.file);
    const conflict = uniqueConflictMessage(error, "product");
    if (conflict) return res.status(409).json({ success: false, message: conflict });
    console.error("❌ Error adding product:", error);
    res.status(500).json({ success: false, message: "Error adding product" });
  }
};

// ---------- List Products (GET /api/products, public; query pre-validated) ----------
const getProducts = async (req, res) => {
  try {
    const { q, category, minPrice, maxPrice, inStock, sort } = req.query;
    const page = req.query.page === undefined ? 1 : req.query.page;
    const limit = req.query.limit === undefined ? DEFAULT_LIMIT : req.query.limit;

    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["minPrice must be less than or equal to maxPrice"]
      });
    }

    const conditions = [];
    if (q) {
      const like = `%${escapeLike(q)}%`;
      // MySQL's default utf8mb4 collation makes LIKE case-insensitive, while
      // PostgreSQL LIKE is case-sensitive. The public API contract is
      // case-insensitive substring search on both dialects, so PG uses ILIKE.
      const searchOp = resolveDialect() === "postgres" ? Op.iLike : Op.like;
      conditions.push({ [Op.or]: [{ name: { [searchOp]: like } }, { description: { [searchOp]: like } }] });
    }
    if (minPrice !== undefined || maxPrice !== undefined) {
      const price = {};
      if (minPrice !== undefined) price[Op.gte] = minPrice;
      if (maxPrice !== undefined) price[Op.lte] = maxPrice;
      conditions.push({ sellingPrice: price });
    }
    if (inStock === true) conditions.push({ stock: { [Op.gt]: 0 } });
    else if (inStock === false) conditions.push({ stock: { [Op.lte]: 0 } });
    if (category) conditions.push(await resolveCategoryFilter(category));

    const where = conditions.length ? { [Op.and]: conditions } : {};
    const offset = (page - 1) * limit;

    const { count, rows } = await Product.findAndCountAll({
      where,
      order: SORTS[sort || DEFAULT_SORT],
      limit,
      offset,
      distinct: true,
      include: [...categoryInclude, variantsInclude]
    });

    const totalPages = Math.max(1, Math.ceil(count / limit));
    res.json({
      success: true,
      count: rows.length, // rows on this page (legacy field kept)
      products: rows.map(serializePublicProduct),
      pagination: {
        page,
        limit,
        total: count,
        totalPages,
        hasNext: page < totalPages,
        hasPrev: page > 1
      }
    });
  } catch (error) {
    console.error("❌ Error fetching products:", error);
    res.status(500).json({ success: false, message: "Error fetching products" });
  }
};

// ---------- Get One Product (GET /api/products/:identifier — numeric id OR slug) ----------
// Shared by the detail page, suggestions callers and related-products lookups so
// id-vs-slug resolution can never drift between endpoints.
async function findProductByIdentifier(identifier, options = {}) {
  const value = String(identifier || "").trim();
  if (!value) return null;

  const numericId = /^\d+$/.test(value) ? Number(value) : null;
  if (numericId !== null && Number.isSafeInteger(numericId) && numericId > 0 && numericId <= 2147483647) {
    const byId = await Product.findByPk(numericId, options);
    if (byId) return byId;
  }
  if (value.length <= 160) {
    return Product.findOne({ where: { slug: value }, ...options });
  }
  return null;
}

const getProduct = async (req, res) => {
  try {
    const product = await findProductByIdentifier(req.params.identifier, {
      include: [...categoryInclude, imagesInclude, variantsInclude],
      order: [...imagesOrder, ...variantsOrder]
    });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, product: serializePublicProduct(product) });
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ success: false, message: "Error fetching product" });
  }
};

// ---------- Search suggestions (GET /api/products/suggestions?q=) ----------
// Bounded typeahead: a short query returns an empty list instead of scanning the
// catalog, and at most eight name matches come back. Only the fields a
// suggestion needs are selected.
const SUGGESTION_MIN_LENGTH = 2;
const SUGGESTION_LIMIT = 8;
const SUGGESTION_MAX_QUERY = 100;

const getSuggestions = async (req, res) => {
  try {
    const raw = typeof req.query.q === "string" ? req.query.q.trim() : "";
    if (raw.length < SUGGESTION_MIN_LENGTH) {
      return res.json({ success: true, query: raw, count: 0, suggestions: [] });
    }

    const term = raw.slice(0, SUGGESTION_MAX_QUERY);
    const like = `%${escapeLike(term)}%`;
    const searchOp = resolveDialect() === "postgres" ? Op.iLike : Op.like;

    const rows = await Product.findAll({
      where: { name: { [searchOp]: like } },
      attributes: ["id", "slug", "name", "sellingPrice", "image"],
      order: [
        ["name", "ASC"],
        ["id", "ASC"]
      ],
      limit: SUGGESTION_LIMIT
    });

    res.json({
      success: true,
      query: term,
      count: rows.length,
      suggestions: rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        price: Number(row.sellingPrice),
        image: row.image || ""
      }))
    });
  } catch (error) {
    console.error("❌ Error fetching search suggestions:", error);
    res.status(500).json({ success: false, message: "Error fetching search suggestions" });
  }
};

// ---------- Related products (GET /api/products/:identifier/related) ----------
// Same-category siblings only: nothing is invented, a product without a
// category has no related section, and in-stock items are preferred. Ordering is
// deterministic (newest, id) so the same product page always shows the same set.
const RELATED_DEFAULT_LIMIT = 4;
const RELATED_MAX_LIMIT = 12;

const getRelatedProducts = async (req, res) => {
  try {
    const product = await findProductByIdentifier(req.params.identifier, {
      attributes: ["id", "category", "categoryId"]
    });
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const requested = Number(req.query.limit);
    const limit =
      Number.isInteger(requested) && requested > 0
        ? Math.min(requested, RELATED_MAX_LIMIT)
        : RELATED_DEFAULT_LIMIT;

    let categoryWhere;
    if (product.categoryId) {
      categoryWhere = { categoryId: product.categoryId };
    } else if (product.category && String(product.category).trim()) {
      // Legacy rows created before Categories existed still relate by name.
      categoryWhere = { category: String(product.category).trim() };
    } else {
      return res.json({ success: true, productId: product.id, count: 0, products: [] });
    }

    const base = { ...categoryWhere, id: { [Op.ne]: product.id } };
    const select = {
      include: [...categoryInclude, variantsInclude],
      order: [
        ["createdAt", "DESC"],
        ["id", "DESC"]
      ]
    };

    const rows = await Product.findAll({
      ...select,
      where: { ...base, stock: { [Op.gt]: 0 } },
      limit
    });

    if (rows.length < limit) {
      const remainder = await Product.findAll({
        ...select,
        where: {
          ...base,
          stock: { [Op.lte]: 0 },
          ...(rows.length ? { id: { [Op.ne]: product.id, [Op.notIn]: rows.map((row) => row.id) } } : {})
        },
        limit: limit - rows.length
      });
      rows.push(...remainder);
    }

    res.json({ success: true, productId: product.id, count: rows.length, products: rows.map(serializePublicProduct) });
  } catch (error) {
    console.error("❌ Error fetching related products:", error);
    res.status(500).json({ success: false, message: "Error fetching related products" });
  }
};

// ---------- Update Product (PUT /api/products/:id, admin-only; body pre-validated) ----------
const updateProduct = async (req, res) => {
  // Set only after a direct upload passed verification — drives orphan
  // compensation if the database write then fails.
  let verifiedUploadPath = null;
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }
    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const updates = { ...req.body };
    const has = (field) => Object.prototype.hasOwnProperty.call(updates, field);

    // A multipart file is the new image. It already passed the mimetype
    // allowlist + magic-byte check in the route, so it skips the hosted-upload
    // resolver (which is for storage objects, not local disk).
    if (req.file) updates.image = `/uploads/${req.file.filename}`;

    if (!Object.keys(updates).length) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["No fields to update"]
      });
    }

    // Prices are validated against the FINAL values (partial updates allowed).
    const finalMrp = has("mrpPrice") ? updates.mrpPrice : product.mrpPrice;
    const finalSelling = has("sellingPrice") ? updates.sellingPrice : product.sellingPrice;
    if (finalSelling > finalMrp) {
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: ["sellingPrice cannot be greater than mrpPrice"]
      });
    }

    // Variant-managed inventory: Products.stock is a server-maintained cache.
    // Refuse direct edits rather than silently desynchronising the variants,
    // and keep every resulting variant price positive when the base price moves.
    const variantCount = await ProductVariant.count({ where: { productId: id } });
    if (has("stock") && variantCount > 0) {
      return res.status(409).json({
        success: false,
        code: "STOCK_MANAGED_BY_VARIANTS",
        message: "Stock is managed by this product's variants. Update variant stock instead."
      });
    }
    if (has("sellingPrice") && variantCount > 0) {
      const lowestAdjustment = await ProductVariant.min("priceAdjustment", { where: { productId: id } });
      if (Number(finalSelling) + Number(lowestAdjustment || 0) <= 0) {
        return res.status(400).json({
          success: false,
          message: "Validation failed",
          errors: ["sellingPrice would make a variant price zero or negative"]
        });
      }
    }

    // Explicit slug change must not collide (empty string = no change).
    if (has("slug")) {
      if (!updates.slug) delete updates.slug;
      else {
        const clash = await Product.findOne({ where: { slug: updates.slug }, attributes: ["id"] });
        if (clash && clash.id !== product.id) {
          return res.status(409).json({ success: false, message: "A product with that slug already exists" });
        }
      }
    }

    // Category relationship: explicit FK (or null to unlink) wins; otherwise a
    // changed legacy `category` string re-links by exact name (null if none).
    if (has("categoryId")) {
      if (updates.categoryId !== null) {
        const categoryRow = await Category.findByPk(updates.categoryId);
        if (!categoryRow) {
          return res.status(400).json({
            success: false,
            message: "Validation failed",
            errors: ["categoryId must reference an existing category"]
          });
        }
      }
    } else if (has("category")) {
      const matched = await Category.findOne({ where: { name: String(updates.category).trim() } });
      updates.categoryId = matched ? matched.id : null;
    }

    // Hosted storage (Phase 12): an image CHANGE must be a verified direct
    // upload (or an external URL). Re-sending the product's current image
    // value is a no-op and never consumes an authorization; local mode is a
    // passthrough. Verification runs right before the write (verify-then-save).
    // A multipart file needs none of this: its bytes are already on disk and
    // magic-verified, exactly like create.
    if (!req.file && has("image") && updates.image !== product.image) {
      try {
        const resolved = await resolveProductImageValue(updates.image || "", req.user.id);
        updates.image = resolved.value;
        verifiedUploadPath = resolved.cleanupPath;
      } catch (err) {
        if (err.exposeToClient) {
          return res.status(err.status).json({ success: false, message: err.publicMessage });
        }
        throw err;
      }
    }

    const previousImage = product.image;
    await product.update(updates);
    // Keep an existing gallery consistent with the primary image: row 0 mirrors
    // Products.image (or is removed when the image is cleared).
    if (previousImage !== product.image) {
      await syncGalleryWithLegacyImage(product, product.image);
      // The old file is deleted only now that the row committed. If another
      // product or gallery still uses the same reference it is kept.
      await releaseImageIfUnused(previousImage, product.id);
    }
    const refreshed = await Product.findByPk(product.id, {
      include: [...categoryInclude, imagesInclude, variantsInclude],
      order: [...imagesOrder, ...variantsOrder]
    });
    res.json({ success: true, message: "Product updated", product: serializePublicProduct(refreshed) });
  } catch (error) {
    // DB write failed after a direct upload was verified: best-effort remove
    // the just-uploaded object so it cannot linger as an orphan.
    if (verifiedUploadPath) await bestEffortRemoveImage(verifiedUploadPath);
    removeUploadedFile(req.file);
    const conflict = uniqueConflictMessage(error, "product");
    if (conflict) return res.status(409).json({ success: false, message: conflict });
    console.error("❌ Error updating product:", error);
    res.status(500).json({ success: false, message: "Error updating product" });
  }
};

// ---------- Delete Product (DELETE /api/products/:id, admin-only) ----------
//
// Deleting a product cascades ProductVariants and sets CartItems.variantId to
// NULL (the cart line survives as unavailable). PostgreSQL's cart identity is
// UNIQUE (UserId, productId, COALESCE(variantId, 0)), so a user with several
// variant lines for the same product would otherwise collide during the
// cascade with 23505. Before the delete we lock the product and the cart rows,
// then keep ONE line per user (the legacy base line if present, otherwise the
// oldest variant line) and drop only the extra variant lines. Order history is
// untouched: OrderItems keep their own snapshots and their productId/variantId
// become NULL. Wishlist rows also remain (and are shown as unavailable).
async function prepareCartLinesForProductDelete(productId, transaction) {
  const rows = await CartItem.findAll({
    where: { productId },
    order: [["id", "ASC"]],
    transaction,
    lock: transaction.LOCK.UPDATE
  });
  if (!rows.length) return;

  const byUser = new Map();
  for (const row of rows) {
    const key = String(row.UserId);
    if (!byUser.has(key)) byUser.set(key, { base: null, variants: [] });
    const group = byUser.get(key);
    if (row.variantId === null) group.base = row;
    else group.variants.push(row);
  }

  const removeIds = [];
  for (const group of byUser.values()) {
    if (group.base) {
      // The base line survives the cascade; variant lines would all become a
      // second NULL line and collide with it.
      removeIds.push(...group.variants.map((row) => row.id));
    } else if (group.variants.length > 1) {
      // No base line: keep the oldest variant line as the single unavailable
      // line and remove the rest.
      removeIds.push(...group.variants.slice(1).map((row) => row.id));
    }
  }

  if (removeIds.length) {
    await CartItem.destroy({ where: { id: { [Op.in]: removeIds } }, transaction });
  }
}

function isVariantCartUniqueViolation(error) {
  const text = [error && error.message, error && error.original && error.original.message]
    .filter(Boolean)
    .join(" | ");
  return /uq_cartitems_user_product_variant|23505/i.test(text);
}

const deleteProduct = async (req, res) => {
  try {
    const id = Number(req.params.id);
    if (!Number.isInteger(id) || id <= 0) {
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }
    const product = await Product.findByPk(id);
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }
    const gallery = await ProductImage.findAll({ where: { productId: id } });

    // Two attempts: if a cart write lands between our cleanup and the cascade,
    // the unique violation aborts the transaction and a retry re-runs the
    // cleanup against the now-visible row. The product is only destroyed once.
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        await sequelize.transaction(async (transaction) => {
          const locked = await Product.findByPk(id, { transaction, lock: transaction.LOCK.UPDATE });
          if (!locked) throw new Error("Product disappeared during delete");
          await prepareCartLinesForProductDelete(id, transaction);
          await locked.destroy({ transaction });
        });
        break;
      } catch (error) {
        if (attempt === 0 && isVariantCartUniqueViolation(error)) continue;
        throw error;
      }
    }

    // Row is gone before the files are: deleting first would leave a product
    // pointing at a missing image if the DELETE then failed. Gallery rows are
    // removed by the ON DELETE CASCADE constraint.
    for (const candidate of [product.image, ...gallery.map((row) => row.url)]) {
      await releaseImageIfUnused(candidate, null);
    }
    res.json({ success: true, message: "Product deleted" });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ success: false, message: "Error deleting product" });
  }
};

// ---------- Product gallery (items 32–33) ----------

// Products.image stays the primary for compatibility, so every gallery write
// mirrors row 0 into it (and clears it when the gallery becomes empty).
async function syncPrimaryImage(product, images, transaction) {
  const primary = images[0] || null;
  const meta =
    product.imageMeta && typeof product.imageMeta === "object" && !Array.isArray(product.imageMeta)
      ? { ...product.imageMeta }
      : {};
  if (primary && primary.alt) meta.alt = primary.alt;
  else delete meta.alt;

  await product.update(
    { image: primary ? primary.url : "", imageMeta: Object.keys(meta).length ? meta : null },
    { transaction }
  );
}

// An edit through the legacy `image` field must not leave a disagreeing
// gallery behind: row 0 follows the primary (and is dropped when it clears).
async function syncGalleryWithLegacyImage(product, image) {
  const rows = await ProductImage.findAll({
    where: { productId: product.id },
    order: [
      ["position", "ASC"],
      ["id", "ASC"]
    ]
  });
  if (!rows.length) return;

  if (image) {
    if (rows[0].url !== image) await rows[0].update({ url: image });
    return;
  }

  await rows[0].destroy();
  const rest = rows.slice(1);
  for (let index = 0; index < rest.length; index += 1) {
    if (rest[index].position !== index) await rest[index].update({ position: index });
  }
  if (rest.length) {
    await syncPrimaryImage(
      product,
      rest.map((row) => ({ url: row.url, alt: row.alt }))
    );
  }
}

function parseImagesPayload(raw) {
  if (!Array.isArray(raw)) return { error: "images must be an array" };
  if (raw.length > ProductImage.MAX_IMAGES) {
    return { error: `images may contain at most ${ProductImage.MAX_IMAGES} entries` };
  }

  const seen = new Set();
  const images = [];
  for (let index = 0; index < raw.length; index += 1) {
    const entry = raw[index];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return { error: `images[${index}] must be an object` };
    }
    const url = typeof entry.url === "string" ? entry.url.trim() : "";
    if (!url) return { error: `images[${index}].url is required` };
    if (url.length > 500) return { error: `images[${index}].url must be at most 500 characters` };
    if (seen.has(url)) return { error: "images must not contain duplicate urls" };
    seen.add(url);

    const rawAlt = entry.alt === undefined || entry.alt === null ? "" : String(entry.alt).trim();
    if (rawAlt.length > 255) {
      return { error: `images[${index}].alt must be at most 255 characters` };
    }
    images.push({ url, alt: rawAlt || null });
  }
  return { images };
}

async function loadProductWithImages(id) {
  return Product.findByPk(id, {
    include: [...categoryInclude, imagesInclude, variantsInclude],
    order: [...imagesOrder, ...variantsOrder]
  });
}

const productIdParam = (raw) => {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
};

// PUT /api/products/:id/images — replace the ordered gallery in one request.
const replaceProductImages = async (req, res) => {
  const cleanupPaths = [];
  try {
    const id = productIdParam(req.params.id);
    if (!id) return res.status(400).json({ success: false, message: "Invalid product id" });

    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const parsed = parseImagesPayload(req.body.images);
    if (parsed.error) {
      return res.status(400).json({ success: false, message: "Validation failed", errors: [parsed.error] });
    }

    const current = await ProductImage.findAll({
      where: { productId: id },
      order: [
        ["position", "ASC"],
        ["id", "ASC"]
      ]
    });
    // Re-sending an already stored value must not consume a second upload
    // authorization: only genuinely new references are resolved.
    const known = new Set(current.map((row) => row.url));

    const resolved = [];
    try {
      for (const entry of parsed.images) {
        if (known.has(entry.url)) {
          resolved.push(entry);
          continue;
        }
        const value = await resolveProductImageValue(entry.url, req.user.id);
        if (value.cleanupPath) cleanupPaths.push(value.cleanupPath);
        resolved.push({ url: value.value, alt: entry.alt });
      }
    } catch (err) {
      for (const cleanup of cleanupPaths) await bestEffortRemoveImage(cleanup);
      if (err.exposeToClient) {
        return res.status(err.status).json({ success: false, message: err.publicMessage });
      }
      throw err;
    }

    await sequelize.transaction(async (transaction) => {
      await ProductImage.destroy({ where: { productId: id }, transaction });
      if (resolved.length) {
        await ProductImage.bulkCreate(
          resolved.map((entry, position) => ({
            productId: id,
            url: entry.url,
            alt: entry.alt,
            position
          })),
          { transaction }
        );
      }
      await syncPrimaryImage(product, resolved, transaction);
    });

    // Files are only released after the rows committed, and only when no other
    // product — primary position or gallery — still references them.
    const kept = new Set(resolved.map((entry) => entry.url));
    for (const row of current) {
      if (!kept.has(row.url)) await releaseImageIfUnused(row.url, null);
    }

    const refreshed = await loadProductWithImages(id);
    res.json({ success: true, message: "Product images updated", product: serializePublicProduct(refreshed) });
  } catch (error) {
    console.error("❌ Error updating product images:", error);
    res.status(500).json({ success: false, message: "Error updating product images" });
  }
};

// POST /api/products/:id/images — append one image (JSON url, or one uploaded
// file in local storage mode). Appending keeps positions and clients simple.
const appendProductImage = async (req, res) => {
  let cleanupPath = null;
  try {
    const id = productIdParam(req.params.id);
    if (!id) {
      removeUploadedFile(req.file);
      return res.status(400).json({ success: false, message: "Invalid product id" });
    }

    const product = await Product.findByPk(id);
    if (!product) {
      removeUploadedFile(req.file);
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    const count = await ProductImage.count({ where: { productId: id } });
    if (count >= ProductImage.MAX_IMAGES) {
      removeUploadedFile(req.file);
      return res.status(400).json({
        success: false,
        message: "Validation failed",
        errors: [`A product can have at most ${ProductImage.MAX_IMAGES} images`]
      });
    }

    const rawAlt = req.body.alt === undefined || req.body.alt === null ? "" : String(req.body.alt).trim();
    if (rawAlt.length > 255) {
      removeUploadedFile(req.file);
      return res.status(400).json({ success: false, message: "Validation failed", errors: ["alt must be at most 255 characters"] });
    }
    const alt = rawAlt || null;

    let url;
    if (req.file) {
      url = `/uploads/${req.file.filename}`;
    } else {
      url = typeof req.body.url === "string" ? req.body.url.trim() : "";
      if (!url) {
        return res.status(400).json({ success: false, message: "Validation failed", errors: ["url is required"] });
      }
      if (url.length > 500) {
        return res.status(400).json({ success: false, message: "Validation failed", errors: ["url must be at most 500 characters"] });
      }
      try {
        const value = await resolveProductImageValue(url, req.user.id);
        url = value.value;
        cleanupPath = value.cleanupPath;
      } catch (err) {
        if (err.exposeToClient) {
          return res.status(err.status).json({ success: false, message: err.publicMessage });
        }
        throw err;
      }
    }

    try {
      await sequelize.transaction(async (transaction) => {
        const highest = await ProductImage.max("position", {
          where: { productId: id },
          transaction
        });
        await ProductImage.create(
          {
            productId: id,
            url,
            alt,
            position: Number.isFinite(highest) ? highest + 1 : 0
          },
          { transaction }
        );
        const rows = await ProductImage.findAll({
          where: { productId: id },
          order: [
            ["position", "ASC"],
            ["id", "ASC"]
          ],
          transaction
        });
        // First image appended to a product becomes its primary.
        await syncPrimaryImage(
          product,
          rows.map((row) => ({ url: row.url, alt: row.alt })),
          transaction
        );
      });
    } catch (err) {
      // The row did not commit, so neither reference is owned by the catalog.
      if (cleanupPath) await bestEffortRemoveImage(cleanupPath);
      removeUploadedFile(req.file);
      throw err;
    }

    const refreshed = await loadProductWithImages(id);
    res.status(201).json({ success: true, message: "Product image added", product: serializePublicProduct(refreshed) });
  } catch (error) {
    removeUploadedFile(req.file);
    console.error("❌ Error adding product image:", error);
    res.status(500).json({ success: false, message: "Error adding product image" });
  }
};

// DELETE /api/products/:id/images/:imageId — remove one image and re-index.
const deleteProductImage = async (req, res) => {
  try {
    const id = productIdParam(req.params.id);
    const imageId = productIdParam(req.params.imageId);
    if (!id || !imageId) {
      return res.status(400).json({ success: false, message: "Invalid product image id" });
    }

    const product = await Product.findByPk(id);
    if (!product) return res.status(404).json({ success: false, message: "Product not found" });

    const row = await ProductImage.findOne({ where: { id: imageId, productId: id } });
    if (!row) return res.status(404).json({ success: false, message: "Product image not found" });

    const removedUrl = row.url;
    await sequelize.transaction(async (transaction) => {
      await row.destroy({ transaction });
      const rows = await ProductImage.findAll({
        where: { productId: id },
        order: [
          ["position", "ASC"],
          ["id", "ASC"]
        ],
        transaction
      });
      for (let index = 0; index < rows.length; index += 1) {
        if (rows[index].position !== index) await rows[index].update({ position: index }, { transaction });
      }
      await syncPrimaryImage(
        product,
        rows.map((entry) => ({ url: entry.url, alt: entry.alt })),
        transaction
      );
    });

    // Released only after the transaction committed.
    await releaseImageIfUnused(removedUrl, null);
    const refreshed = await loadProductWithImages(id);
    res.json({ success: true, message: "Product image removed", product: serializePublicProduct(refreshed) });
  } catch (error) {
    console.error("❌ Error deleting product image:", error);
    res.status(500).json({ success: false, message: "Error removing product image" });
  }
};

module.exports = {
  addProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  replaceProductImages,
  appendProductImage,
  deleteProductImage,
  getSuggestions,
  getRelatedProducts,
  findProductByIdentifier,
  serializePublicProduct,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
