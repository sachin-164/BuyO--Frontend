// routes/productRoutes.js — catalog products (Phase 4)
// Public: GET / (search/filter/sort/pagination), GET /:identifier (id or slug).
// Admin:  POST /, PUT /:id, DELETE /:id.
const express = require("express");
const router = express.Router();
const path = require("path");
const fs = require("fs");
const multer = require("multer");
const {
  addProduct,
  getProducts,
  getProduct,
  updateProduct,
  deleteProduct,
  MAX_LIMIT
} = require("../controllers/productController");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { validateBody, validateQuery } = require("../middleware/validate");
const { isValidSlug } = require("../utils/slugify");

// Ensure the uploads folder exists (multer would fail with ENOENT otherwise)
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

// Multer config (store files in /uploads with timestamped original name)
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, Date.now() + "-" + file.originalname.replace(/\s+/g, "-"))
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 }, // 5 MB max
  fileFilter: (req, file, cb) => cb(null, file.mimetype.startsWith("image/"))
});

// ---------- validation schemas ----------
const VALID_SORTS = ["newest", "oldest", "price_asc", "price_desc", "name_asc", "name_desc"];

const listQuerySchema = {
  q: { type: "string", maxLength: 100 },
  category: { type: "string", maxLength: 160 },
  minPrice: { type: "number", min: 0, max: 100000000 },
  maxPrice: { type: "number", min: 0, max: 100000000 },
  inStock: { type: "boolean" },
  sort: {
    type: "string",
    maxLength: 32,
    validate: (value) => (VALID_SORTS.includes(value) ? null : `sort must be one of: ${VALID_SORTS.join(", ")}`)
  },
  page: { type: "integer", min: 1, max: 100000000 },
  limit: { type: "integer", min: 1, max: MAX_LIMIT }
};

function validateSlugField(value) {
  return isValidSlug(value) ? null : "slug must contain only lowercase letters, numbers and hyphens";
}

// imageMeta: { alt?, width?, height? } — strict shape so junk never lands in JSON.
function validateImageMeta(value) {
  const allowed = ["alt", "width", "height"];
  const unknown = Object.keys(value).find((key) => !allowed.includes(key));
  if (unknown) return `imageMeta only supports ${allowed.join(", ")} (unknown: ${unknown})`;
  if (value.alt !== undefined && (typeof value.alt !== "string" || value.alt.trim() === "" || value.alt.length > 255)) {
    return "imageMeta.alt must be a non-empty string of at most 255 characters";
  }
  for (const dim of ["width", "height"]) {
    if (value[dim] !== undefined && (!Number.isInteger(value[dim]) || value[dim] < 0 || value[dim] > 100000)) {
      return `imageMeta.${dim} must be an integer between 0 and 100000`;
    }
  }
  return null;
}

const imageMetaRule = { type: "object", validate: validateImageMeta };
const categoryIdRule = { type: "integer", min: 1, max: 2147483647, nullable: true };
const stockRule = { type: "integer", min: 0, max: 1000000000 };
const slugRule = { type: "string", maxLength: 160, validate: validateSlugField };

// POST: create (name/category/prices required; stock/imageMeta/slug/categoryId optional)
const createProductSchema = {
  name: { required: true, type: "string", minLength: 1, maxLength: 200 },
  category: { required: true, type: "string", minLength: 1, maxLength: 100 }, // legacy free-text (kept in sync with categoryId)
  description: { type: "string", maxLength: 5000 },
  mrpPrice: { required: true, type: "number", min: 0.01, max: 100000000 },
  sellingPrice: { required: true, type: "number", min: 0.01, max: 100000000 },
  image: { type: "string", maxLength: 500 },
  slug: slugRule,
  stock: stockRule,
  imageMeta: imageMetaRule,
  categoryId: categoryIdRule
};

// PUT: same rules, everything optional (empty body -> 400 "No fields to update")
// NOTE: copy each rule object — sharing references would strip `required` from
// the create schema too.
const updateProductSchema = Object.fromEntries(
  Object.entries(createProductSchema).map(([field, rules]) => [field, { ...rules }])
);
for (const field of ["name", "category", "mrpPrice", "sellingPrice"]) {
  delete updateProductSchema[field].required;
}
// categoryId: null explicitly unlinks the product from its category (legacy string kept)

// ---------- routes ----------
router.get("/", validateQuery(listQuerySchema), getProducts); // GET /api/products (public)
router.get("/:identifier", getProduct);                       // GET /api/products/:id or :slug (public)

// Admin-only: multipart "image" field OR JSON body.
// Multer runs before validation because multipart text fields only exist after parsing.
router.post(
  "/",
  requireAuth,
  requireAdmin,
  upload.single("image"),
  validateBody(createProductSchema),
  addProduct
);

// Admin-only: partial update (JSON body; multipart image replacement comes later)
router.put("/:id", requireAuth, requireAdmin, validateBody(updateProductSchema), updateProduct);

// Admin-only
router.delete("/:id", requireAuth, requireAdmin, deleteProduct);

module.exports = router;
