// controllers/productController.js — catalog API (Phase 4)
// Public: list (search/filter/sort/pagination), lookup by id or slug.
// Admin: create / update / delete (routed with requireAuth + requireAdmin).
// The legacy free-text `category` string stays fully supported: it is always
// written, kept in sync with `categoryId` on create/update, and still works
// as a filter when no Categories row matches.
const { Op } = require("sequelize");
const Product = require("../models/product");
const Category = require("../models/category");
const { resolveDialect } = require("../config/dbConnectionOptions");
const { slugify, uniqueSlug } = require("../utils/slugify");
const { uniqueConflictMessage } = require("../utils/uniqueErrors");
// Phase 12: hosted-mode image verification (ledger + stored-object checks).
// Local mode is a byte-identical passthrough inside this helper.
const { resolveProductImageValue, bestEffortRemoveImage } = require("../lib/imageStore");

const categoryInclude = [{ model: Category, as: "Category" }];

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

    const withCategory = await Product.findByPk(product.id, { include: categoryInclude });
    res.status(201).json({ success: true, message: "✅ Product added successfully!", product: withCategory });
  } catch (error) {
    // DB write failed after a direct upload was verified: best-effort remove
    // the just-uploaded object so it cannot linger as an orphan.
    if (verifiedUploadPath) await bestEffortRemoveImage(verifiedUploadPath);
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
      include: categoryInclude
    });

    const totalPages = Math.max(1, Math.ceil(count / limit));
    res.json({
      success: true,
      count: rows.length, // rows on this page (legacy field kept)
      products: rows,
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
const getProduct = async (req, res) => {
  try {
    const identifier = String(req.params.identifier || "").trim();
    if (!identifier) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    let product = null;
    const numericId = /^\d+$/.test(identifier) ? Number(identifier) : null;
    if (numericId !== null && Number.isSafeInteger(numericId) && numericId > 0 && numericId <= 2147483647) {
      product = await Product.findByPk(numericId, { include: categoryInclude });
    }
    if (!product && identifier.length <= 160) {
      product = await Product.findOne({ where: { slug: identifier }, include: categoryInclude });
    }
    if (!product) {
      return res.status(404).json({ success: false, message: "Product not found" });
    }

    res.json({ success: true, product });
  } catch (error) {
    console.error("❌ Error fetching product:", error);
    res.status(500).json({ success: false, message: "Error fetching product" });
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
    if (has("image") && updates.image !== product.image) {
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

    await product.update(updates);
    const refreshed = await Product.findByPk(product.id, { include: categoryInclude });
    res.json({ success: true, message: "Product updated", product: refreshed });
  } catch (error) {
    // DB write failed after a direct upload was verified: best-effort remove
    // the just-uploaded object so it cannot linger as an orphan.
    if (verifiedUploadPath) await bestEffortRemoveImage(verifiedUploadPath);
    const conflict = uniqueConflictMessage(error, "product");
    if (conflict) return res.status(409).json({ success: false, message: conflict });
    console.error("❌ Error updating product:", error);
    res.status(500).json({ success: false, message: "Error updating product" });
  }
};

// ---------- Delete Product (DELETE /api/products/:id, admin-only) ----------
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
    await product.destroy();
    res.json({ success: true, message: "Product deleted" });
  } catch (error) {
    console.error("❌ Error deleting product:", error);
    res.status(500).json({ success: false, message: "Error deleting product" });
  }
};

module.exports = {
  addProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  DEFAULT_LIMIT,
  MAX_LIMIT
};
