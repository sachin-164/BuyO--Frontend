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
// Phase 12: image constants + naming live in the storage adapter so the
// multipart path and the direct-upload path can never drift apart.
const {
  ALLOWED_IMAGE_TYPES,
  IMAGE_SIGNATURES,
  DEFAULT_MAX_IMAGE_BYTES,
  generateImageName,
  getImageStore,
  resolveStorageConfig
} = require("../lib/imageStore");

// Ensure the uploads folder exists (multer would fail with ENOENT otherwise).
// BOOT MUST NOT DEPEND ON A WRITABLE DISK: on serverless (Vercel) the
// function file system is read-only outside /tmp and backend/uploads/ is
// gitignored, so this mkdir threw EROFS at import there and took the WHOLE
// API down (every /api/* invocation died with FUNCTION_INVOCATION_FAILED —
// verified live; mechanism reproduced in
// test/deployReadiness.test.js). If the folder cannot be created, boot
// continues; only an actual local-disk upload fails later, with a handled
// error — local-disk uploads are a documented serverless limitation
// (docs/deployment.md; Supabase Storage activation plan in
// docs/storage-supabase.md).
const UPLOAD_DIR = path.join(__dirname, "..", "uploads");
try {
  fs.mkdirSync(UPLOAD_DIR, { recursive: true });
} catch (err) {
  console.warn(
    `[productRoutes] uploads dir not creatable (${err.code || "ERROR"}): ` +
      "continuing without local-disk uploads (expected on read-only serverless filesystems)"
  );
}

// Multer config (store files in /uploads with a server-generated name).
// SECURITY (Phase 11): the stored filename NEVER contains the client-supplied
// original name — it is timestamp + random hex + an extension derived from an
// allowlisted image mimetype. Combined with the magic-byte check below, a file
// that is not a real image can never land in /uploads (which is served
// statically), closing the stored-content/extension-spoofing vector.
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
  filename: (req, file, cb) => cb(null, generateImageName(file.mimetype))
});

// Size limit is configurable (MAX_IMAGE_BYTES, default = the historical 5 MB).
// Read at require time; a config error surfaces on first storage use (503),
// never as a boot crash.
let multerMaxBytes = DEFAULT_MAX_IMAGE_BYTES;
try {
  multerMaxBytes = resolveStorageConfig().maxImageBytes;
} catch {
  // storage misconfiguration is handled lazily with a 503 (no disk fallback)
}
const upload = multer({
  storage,
  limits: { fileSize: multerMaxBytes },
  fileFilter: (req, file, cb) => cb(null, Boolean(ALLOWED_IMAGE_TYPES[file.mimetype]))
});

// HOSTED STORAGE SAFETY (Phase 12): with STORAGE_DRIVER=supabase the multipart
// path must never land image bytes on the ephemeral function disk. Files are
// removed synchronously before the 409 — no silent local-disk fallback.
function rejectMultipartWhenHosted(req, res, next) {
  if (!req.file) return next();
  let store;
  try {
    store = getImageStore();
  } catch {
    return res.status(503).json({ success: false, message: "Storage is not configured" });
  }
  if (store.driver === "local") return next();
  fs.rmSync(req.file.path, { force: true });
  return res.status(409).json({
    success: false,
    code: "multipart-disabled",
    message:
      "Hosted storage mode does not accept multipart image uploads; use the direct upload flow (POST /api/uploads/authorize)"
  });
}

// Magic-byte verification (runs after multer stored the file): the first bytes
// must match the declared image type, otherwise the file is deleted and the
// request rejected with 400. Minimum discriminating prefixes are used so tiny
// synthetic test fixtures (e.g. a 4-byte PNG header) still validate.

function verifyImageFile(req, res, next) {
  if (!req.file) return next();
  const matches = IMAGE_SIGNATURES[req.file.mimetype];
  const fail = () => {
    // Synchronous removal: the file must be gone before the 400 response is
    // sent (an async unlink races with any immediate directory check).
    fs.rmSync(req.file.path, { force: true });
    return res.status(400).json({
      success: false,
      message: "Validation failed",
      errors: ["Uploaded file is not a valid image (content does not match its type)"]
    });
  };
  let buffer = Buffer.alloc(12);
  let read = 0;
  try {
    const fd = fs.openSync(req.file.path, "r");
    try {
      read = fs.readSync(fd, buffer, 0, 12, 0);
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return fail();
  }
  if (!matches || read < 4 || !matches(buffer.subarray(0, read))) return fail();
  next();
}

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
  rejectMultipartWhenHosted,
  verifyImageFile,
  validateBody(createProductSchema),
  addProduct
);

// Admin-only: partial update (JSON body; multipart image replacement comes later)
router.put("/:id", requireAuth, requireAdmin, validateBody(updateProductSchema), updateProduct);

// Admin-only
router.delete("/:id", requireAuth, requireAdmin, deleteProduct);

module.exports = router;
